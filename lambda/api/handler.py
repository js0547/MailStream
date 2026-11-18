"""MailStream API Lambda.

Sits behind API Gateway (HTTP API) and serves the dashboard:

  POST /campaigns        create a campaign, store its template, return a
                         pre-signed URL the browser uses to upload the CSV
  GET  /campaigns        list campaigns (newest first)
  GET  /campaigns/{id}   one campaign with its delivery results
  GET  /config           sender address and SES sandbox info for the UI
"""

import json
import os
import re
import uuid
from datetime import datetime, timezone
from decimal import Decimal

import boto3
from botocore.config import Config

UPLOAD_BUCKET = os.environ["UPLOAD_BUCKET"]
TABLE_NAME = os.environ["TABLE_NAME"]
SENDER_EMAIL = os.environ["SENDER_EMAIL"]
REGION = os.environ["AWS_REGION"]  # set automatically by Lambda
URL_EXPIRY_SECONDS = 300
MAX_TEMPLATE_BYTES = 200_000

# SES rejects messages over 10 MB. Attachments are base64-encoded (~1.37x),
# so cap the raw total at 7 MB to leave room for the HTML body and headers.
MAX_ATTACHMENTS = 5
MAX_ATTACHMENT_TOTAL_BYTES = 7 * 1024 * 1024
ATTACHMENT_TYPES = {
    ".pdf": "application/pdf",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
}
SAFE_NAME_RE = re.compile(r"[^A-Za-z0-9._-]+")

# Use the regional endpoint so pre-signed URLs don't hit the global endpoint
# and get a 307 redirect (browsers fail the CORS check on that redirect).
s3 = boto3.client(
    "s3",
    region_name=REGION,
    endpoint_url=f"https://s3.{REGION}.amazonaws.com",
    config=Config(signature_version="s3v4", s3={"addressing_style": "virtual"}),
)
ses = boto3.client("sesv2")
table = boto3.resource("dynamodb").Table(TABLE_NAME)


def _json_default(value):
    if isinstance(value, Decimal):
        return int(value) if value == value.to_integral_value() else float(value)
    raise TypeError(f"Cannot serialise {type(value).__name__}")


def respond(status, body):
    return {
        "statusCode": status,
        "headers": {"Content-Type": "application/json"},
        "body": json.dumps(body, default=_json_default),
    }


def create_campaign(event):
    try:
        body = json.loads(event.get("body") or "{}")
    except json.JSONDecodeError:
        return respond(400, {"error": "Request body must be JSON"})

    name = (body.get("name") or "").strip()
    subject = (body.get("subject") or "").strip()
    template = body.get("template") or ""

    if not name or not subject or not template.strip():
        return respond(400, {"error": "name, subject and template are required"})
    if len(name) > 100 or len(subject) > 200:
        return respond(400, {"error": "name or subject is too long"})
    if len(template.encode("utf-8")) > MAX_TEMPLATE_BYTES:
        return respond(400, {"error": "template is larger than 200 KB"})

    attachments, error = validate_attachments(body.get("attachments") or [])
    if error:
        return respond(400, {"error": error})

    campaign_id = uuid.uuid4().hex[:12]
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")

    s3.put_object(
        Bucket=UPLOAD_BUCKET,
        Key=f"campaigns/{campaign_id}/template.html",
        Body=template.encode("utf-8"),
        ContentType="text/html; charset=utf-8",
    )

    table.put_item(
        Item={
            "campaign_id": campaign_id,
            "name": name,
            "subject": subject,
            "status": "AWAITING_UPLOAD",
            "created_at": now,
            "updated_at": now,
            "total": 0,
            "sent": 0,
            "failed": 0,
            "skipped": 0,
            "attachments": attachments,
        }
    )

    # Attachments must be uploaded before the CSV: the CSV upload is what
    # triggers sending (S3 notification on the recipients.csv suffix).
    attachment_urls = [
        {
            "name": a["name"],
            "upload_url": presign(f"campaigns/{campaign_id}/attachments/{a['name']}", a["content_type"]),
            "content_type": a["content_type"],
        }
        for a in attachments
    ]

    return respond(
        201,
        {
            "campaign_id": campaign_id,
            "upload_url": presign(f"campaigns/{campaign_id}/recipients.csv", "text/csv"),
            "attachments": attachment_urls,
        },
    )


def presign(key, content_type):
    return s3.generate_presigned_url(
        "put_object",
        Params={"Bucket": UPLOAD_BUCKET, "Key": key, "ContentType": content_type},
        ExpiresIn=URL_EXPIRY_SECONDS,
    )


def validate_attachments(items):
    """Check the attachment list sent by the UI. Returns (clean_list, error)."""
    if not isinstance(items, list):
        return None, "attachments must be a list"
    if len(items) > MAX_ATTACHMENTS:
        return None, f"at most {MAX_ATTACHMENTS} attachments are allowed"

    clean, names, total = [], set(), 0
    for item in items:
        if not isinstance(item, dict):
            return None, "invalid attachment entry"
        raw_name = str(item.get("name") or "").strip()
        name = SAFE_NAME_RE.sub("_", os.path.basename(raw_name))[:100]
        ext = os.path.splitext(name)[1].lower()
        if not name or ext not in ATTACHMENT_TYPES:
            return None, f"'{raw_name}' is not allowed. Use PDF, PNG or JPG files."
        if name.lower() in names:
            return None, f"duplicate attachment name '{name}'"
        size = item.get("size")
        if not isinstance(size, int) or size <= 0:
            return None, f"'{raw_name}' has an invalid size"
        total += size
        names.add(name.lower())
        clean.append({"name": name, "size": size, "content_type": ATTACHMENT_TYPES[ext]})

    if total > MAX_ATTACHMENT_TOTAL_BYTES:
        return None, "attachments must be 7 MB or smaller in total"
    return clean, None


def list_campaigns():
    items = []
    kwargs = {
        "ProjectionExpression": "campaign_id, #n, subject, #s, created_at, updated_at, #t, sent, failed, skipped",
        "ExpressionAttributeNames": {"#n": "name", "#s": "status", "#t": "total"},
    }
    while True:
        page = table.scan(**kwargs)
        items.extend(page.get("Items", []))
        if "LastEvaluatedKey" not in page:
            break
        kwargs["ExclusiveStartKey"] = page["LastEvaluatedKey"]

    items.sort(key=lambda item: item.get("created_at", ""), reverse=True)
    return respond(200, {"campaigns": items})


def get_campaign(campaign_id):
    item = table.get_item(Key={"campaign_id": campaign_id}).get("Item")
    if not item:
        return respond(404, {"error": "Campaign not found"})
    return respond(200, item)


def get_config():
    account = ses.get_account()
    quota = account.get("SendQuota", {})
    return respond(
        200,
        {
            "sender": SENDER_EMAIL,
            "sandbox": not account.get("ProductionAccessEnabled", False),
            "max_24h": quota.get("Max24HourSend"),
            "sent_24h": quota.get("SentLast24Hours"),
            "max_rate": quota.get("MaxSendRate"),
        },
    )


def lambda_handler(event, context):
    route = event.get("routeKey", "")
    try:
        if route == "POST /campaigns":
            return create_campaign(event)
        if route == "GET /campaigns":
            return list_campaigns()
        if route == "GET /campaigns/{id}":
            return get_campaign(event["pathParameters"]["id"])
        if route == "GET /config":
            return get_config()
        return respond(404, {"error": f"Unknown route {route}"})
    except Exception as exc:  # surface the error to the UI, keep it in the logs
        print(f"ERROR handling {route}: {exc!r}")
        return respond(500, {"error": "Internal error, check CloudWatch logs"})
