# ---------------------------------------------------------------------------
# Packaging: each Lambda folder is zipped by Terraform (no dependencies
# beyond boto3, which the Python runtime already includes).
# ---------------------------------------------------------------------------

data "archive_file" "api" {
  type        = "zip"
  source_dir  = "${path.module}/../lambda/api"
  output_path = "${path.module}/build/api.zip"
  excludes    = ["__pycache__"]
}

data "archive_file" "sender" {
  type        = "zip"
  source_dir  = "${path.module}/../lambda/sender"
  output_path = "${path.module}/build/sender.zip"
  excludes    = ["__pycache__"]
}

data "aws_iam_policy_document" "lambda_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

locals {
  ses_sender_arn = "arn:aws:ses:${var.aws_region}:${data.aws_caller_identity.current.account_id}:identity/${var.sender_email}"
}

# ---------------------------------------------------------------------------
# API Lambda: least-privilege role
# ---------------------------------------------------------------------------

resource "aws_iam_role" "api" {
  name               = "${local.name}-api-role"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json
}

data "aws_iam_policy_document" "api" {
  statement {
    sid       = "Logs"
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["${aws_cloudwatch_log_group.api.arn}:*"]
  }
  statement {
    sid       = "WriteCampaignFiles"
    actions   = ["s3:PutObject"]
    resources = ["${aws_s3_bucket.uploads.arn}/campaigns/*"]
  }
  statement {
    sid       = "CampaignTable"
    actions   = ["dynamodb:PutItem", "dynamodb:GetItem", "dynamodb:Scan"]
    resources = [aws_dynamodb_table.campaigns.arn]
  }
  statement {
    sid       = "ReadSesQuota"
    actions   = ["ses:GetAccount"]
    resources = ["*"]
  }
}

resource "aws_iam_role_policy" "api" {
  role   = aws_iam_role.api.id
  policy = data.aws_iam_policy_document.api.json
}

resource "aws_cloudwatch_log_group" "api" {
  name              = "/aws/lambda/${local.name}-api"
  retention_in_days = var.log_retention_days
}

resource "aws_lambda_function" "api" {
  function_name    = "${local.name}-api"
  role             = aws_iam_role.api.arn
  runtime          = "python3.12"
  handler          = "handler.lambda_handler"
  filename         = data.archive_file.api.output_path
  source_code_hash = data.archive_file.api.output_base64sha256
  memory_size      = 128
  timeout          = 10

  environment {
    variables = {
      UPLOAD_BUCKET = aws_s3_bucket.uploads.bucket
      TABLE_NAME    = aws_dynamodb_table.campaigns.name
      SENDER_EMAIL  = var.sender_email
    }
  }

  depends_on = [aws_cloudwatch_log_group.api, aws_iam_role_policy.api]
}

# ---------------------------------------------------------------------------
# Sender Lambda: least-privilege role
# ---------------------------------------------------------------------------

resource "aws_iam_role" "sender" {
  name               = "${local.name}-sender-role"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json
}

data "aws_iam_policy_document" "sender" {
  statement {
    sid       = "Logs"
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["${aws_cloudwatch_log_group.sender.arn}:*"]
  }
  statement {
    sid       = "ReadCampaignFiles"
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.uploads.arn}/campaigns/*"]
  }
  statement {
    sid       = "CampaignTable"
    actions   = ["dynamodb:GetItem", "dynamodb:UpdateItem"]
    resources = [aws_dynamodb_table.campaigns.arn]
  }
  statement {
    sid = "SendFromVerifiedSenderOnly"
    # SendRawEmail is needed for messages with attachments (raw MIME content).
    actions = ["ses:SendEmail", "ses:SendRawEmail"]
    # In the sandbox SES also checks the recipient identities, so allow sending
    # from the sender identity to any identity in this account and region.
    resources = [
      local.ses_sender_arn,
      "arn:aws:ses:${var.aws_region}:${data.aws_caller_identity.current.account_id}:identity/*",
    ]
    condition {
      test     = "StringEquals"
      variable = "ses:FromAddress"
      values   = [var.sender_email]
    }
  }
  statement {
    sid       = "ReadSesQuota"
    actions   = ["ses:GetAccount"]
    resources = ["*"]
  }
}

resource "aws_iam_role_policy" "sender" {
  role   = aws_iam_role.sender.id
  policy = data.aws_iam_policy_document.sender.json
}

resource "aws_cloudwatch_log_group" "sender" {
  name              = "/aws/lambda/${local.name}-sender"
  retention_in_days = var.log_retention_days
}

resource "aws_lambda_function" "sender" {
  function_name    = "${local.name}-sender"
  role             = aws_iam_role.sender.arn
  runtime          = "python3.12"
  handler          = "handler.lambda_handler"
  filename         = data.archive_file.sender.output_path
  source_code_hash = data.archive_file.sender.output_base64sha256
  memory_size      = 256
  timeout          = 900 # 15 min: ~800 emails at the sandbox rate of 1/second

  environment {
    variables = {
      TABLE_NAME     = aws_dynamodb_table.campaigns.name
      SENDER_EMAIL   = var.sender_email
      MAX_RECIPIENTS = tostring(var.max_recipients_per_campaign)
    }
  }

  depends_on = [aws_cloudwatch_log_group.sender, aws_iam_role_policy.sender]
}

# One retry on crash; the handler skips campaigns that already started, so a
# retry never sends duplicates.
resource "aws_lambda_function_event_invoke_config" "sender" {
  function_name          = aws_lambda_function.sender.function_name
  maximum_retry_attempts = 1
}

resource "aws_lambda_permission" "s3_invoke_sender" {
  statement_id   = "AllowS3Invoke"
  action         = "lambda:InvokeFunction"
  function_name  = aws_lambda_function.sender.function_name
  principal      = "s3.amazonaws.com"
  source_arn     = aws_s3_bucket.uploads.arn
  source_account = data.aws_caller_identity.current.account_id
}
