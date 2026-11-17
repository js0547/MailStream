"""MailStream sender Lambda.

Triggered by S3 when campaigns/<id>/recipients.csv is uploaded. It reads the
CSV, renders the campaign's HTML template for every row, sends each email
through Amazon SES and records the results in DynamoDB.

CSV format: a header row with at least an `email` column. Every other column
(name, company, ...) can be used in the template as {{column_name}}.
"""

import csv
import html
import io
import os
import re
import time
import urllib.parse
from datetime import datetime, timezone

import boto3
from botocore.exceptions import ClientError

TABLE_NAME = os.environ["TABLE_NAME"]
SENDER_EMAIL = os.environ["SENDER_EMAIL"]
MAX_RECIPIENTS = int(os.environ.get("MAX_RECIPIENTS", "500"))
PROGRESS_EVERY = 5
MAX_STORED_RESULTS = 500

EMAIL_RE = re.compile(r"^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$")
PLACEHOLDER_RE = re.compile(r"\{\{\s*([A-Za-z0-9_]+)\s*\}\}")
TAG_RE = re.compile(r"<[^>]+>")

s3 = boto3.client("s3")
ses = boto3.client("sesv2")
table = boto3.resource("dynamodb").Table(TABLE_NAME)


def now():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def update_campaign(campaign_id, **fields):
    fields["updated_at"] = now()
    names = {f"#{k}": k for k in fields}
    values = {f":{k}": v for k, v in fields.items()}
    table.update_item(
        Key={"campaign_id": campaign_id},
        UpdateExpression="SET " + ", ".join(f"#{k} = :{k}" for k in fields),
        ExpressionAttributeNames=names,
        ExpressionAttributeValues=values,
    )


def render(template, row, escape):
    """Replace {{column}} with the row's value. Unknown placeholders become ''."""
    def substitute(match):
        value = row.get(match.group(1).lower(), "")
        return html.escape(value) if escape else value
    return PLACEHOLDER_RE.sub(substitute, template)


def html_to_text(markup):
    text = re.sub(r"(?i)<br\s*/?>|</p>|</div>|</h[1-6]>|</li>", "\n", markup)
    text = html.unescape(TAG_RE.sub("", text))
    return re.sub(r"\n\s*\n+", "\n\n", text).strip()


def read_recipients(bucket, key):
    raw = s3.get_object(Bucket=bucket, Key=key)["Body"].read()
    text = raw.decode("utf-8-sig")  # tolerate the BOM Excel adds
    reader = csv.DictReader(io.StringIO(text))
    if not reader.fieldnames:
        raise ValueError("CSV is empty")

    reader.fieldnames = [(f or "").strip().lower() for f in reader.fieldnames]
    if "email" not in reader.fieldnames:
        raise ValueError("CSV must have an 'email' column")

    rows, seen = [], set()
    for row in reader:
        clean = {k: (v or "").strip() for k, v in row.items() if k}
        email = clean.get("email", "").lower()
        if not email or email in seen:
            continue
        seen.add(email)
        clean["email"] = email
        rows.append(clean)
    return rows


def send_one(to_address, subject, body_html):
    """Send one email, retrying a few times if SES throttles us."""
    for attempt in range(4):
        try:
            ses.send_email(
                FromEmailAddress=SENDER_EMAIL,
                Destination={"ToAddresses": [to_address]},
                Content={
                    "Simple": {
                        "Subject": {"Data": subject, "Charset": "UTF-8"},
                        "Body": {
                            "Html": {"Data": body_html, "Charset": "UTF-8"},
                            "Text": {"Data": html_to_text(body_html), "Charset": "UTF-8"},
                        },
                    }
                },
            )
            return None
        except ClientError as exc:
            code = exc.response["Error"]["Code"]
            if code in ("Throttling", "TooManyRequestsException") and attempt < 3:
                time.sleep(2 ** attempt)
                continue
            return f"{code}: {exc.response['Error'].get('Message', '')}"
    return "Throttled by SES"


def process(bucket, key):
    campaign_id = key.split("/")[1]
    campaign = table.get_item(Key={"campaign_id": campaign_id}).get("Item")
    if not campaign:
        raise ValueError(f"No campaign record for {campaign_id}")
    if campaign.get("status") not in ("AWAITING_UPLOAD", None):
        print(f"Campaign {campaign_id} already {campaign['status']}, ignoring duplicate event")
        return

    template = s3.get_object(Bucket=bucket, Key=f"campaigns/{campaign_id}/template.html")["Body"].read().decode("utf-8")

    try:
        rows = read_recipients(bucket, key)
    except ValueError as exc:
        update_campaign(campaign_id, status="FAILED", error=str(exc))
        print(f"Campaign {campaign_id} rejected: {exc}")
        return

    rows = rows[:MAX_RECIPIENTS]
    update_campaign(campaign_id, status="SENDING", total=len(rows), started_at=now())

    # Stay under the account's SES send rate (1/second in the sandbox).
    rate = ses.get_account().get("SendQuota", {}).get("MaxSendRate") or 1
    interval = 1.0 / float(rate)

    sent = failed = skipped = 0
    results = []
    for index, row in enumerate(rows, start=1):
        email = row["email"]
        if not EMAIL_RE.match(email):
            skipped += 1
            results.append({"email": email, "status": "SKIPPED", "detail": "Invalid email address"})
        else:
            started = time.monotonic()
            subject = render(campaign["subject"], row, escape=False)
            error = send_one(email, subject, render(template, row, escape=True))
            if error:
                failed += 1
                results.append({"email": email, "status": "FAILED", "detail": error})
                print(f"FAILED {email}: {error}")
            else:
                sent += 1
                results.append({"email": email, "status": "SENT", "detail": ""})
            wait = interval - (time.monotonic() - started)
            if wait > 0:
                time.sleep(wait)

        if index % PROGRESS_EVERY == 0:
            update_campaign(campaign_id, sent=sent, failed=failed, skipped=skipped)

    status = "COMPLETED" if failed == 0 else ("FAILED" if sent == 0 else "PARTIAL")
    update_campaign(
        campaign_id,
        status=status,
        sent=sent,
        failed=failed,
        skipped=skipped,
        finished_at=now(),
        results=results[:MAX_STORED_RESULTS],
    )
    print(f"Campaign {campaign_id}: {status} sent={sent} failed={failed} skipped={skipped}")


def lambda_handler(event, context):
    for record in event.get("Records", []):
        bucket = record["s3"]["bucket"]["name"]
        key = urllib.parse.unquote_plus(record["s3"]["object"]["key"])
        print(f"Processing s3://{bucket}/{key}")
        # Unexpected errors propagate so Lambda reports them and the
        # CloudWatch alarm fires.
        process(bucket, key)
    return {"ok": True}
