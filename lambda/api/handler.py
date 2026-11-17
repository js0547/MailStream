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
import uuid
from datetime import datetime, timezone
from decimal import Decimal

import boto3

UPLOAD_BUCKET = os.environ["UPLOAD_BUCKET"]
TABLE_NAME = os.environ["TABLE_NAME"]
SENDER_EMAIL = os.environ["SENDER_EMAIL"]
URL_EXPIRY_SECONDS = 300
MAX_TEMPLATE_BYTES = 200_000

s3 = boto3.client("s3")
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
        }
    )

    # The CSV key ends in recipients.csv; the S3 notification on that suffix
    # is what starts the sender Lambda.
    upload_url = s3.generate_presigned_url(
        "put_object",
        Params={
            "Bucket": UPLOAD_BUCKET,
            "Key": f"campaigns/{campaign_id}/recipients.csv",
            "ContentType": "text/csv",
        },
        ExpiresIn=URL_EXPIRY_SECONDS,
    )

    return respond(201, {"campaign_id": campaign_id, "upload_url": upload_url})


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
