terraform {
  required_version = ">= 1.5"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.80"
    }
    archive = {
      source  = "hashicorp/archive"
      version = "~> 2.7"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project   = var.project_name
      ManagedBy = "terraform"
    }
  }
}

data "aws_caller_identity" "current" {}

# Bucket names are global, so add a random suffix.
resource "random_id" "suffix" {
  byte_length = 3
}

locals {
  name   = var.project_name
  suffix = random_id.suffix.hex
  # Origins allowed to call the API and upload to S3: the S3 website and the
  # Vite dev server for local development.
  site_url = "http://${aws_s3_bucket_website_configuration.site.website_endpoint}"
  allowed_origins = [
    local.site_url,
    "http://localhost:5173",
  ]
}

# ---------------------------------------------------------------------------
# Uploads bucket: recipient CSVs and HTML templates, one folder per campaign
# ---------------------------------------------------------------------------

resource "aws_s3_bucket" "uploads" {
  bucket        = "${local.name}-uploads-${local.suffix}"
  force_destroy = true
}

resource "aws_s3_bucket_public_access_block" "uploads" {
  bucket                  = aws_s3_bucket.uploads.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "uploads" {
  bucket = aws_s3_bucket.uploads.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

# Old campaign files are deleted automatically to stay inside free-tier storage.
resource "aws_s3_bucket_lifecycle_configuration" "uploads" {
  bucket = aws_s3_bucket.uploads.id
  rule {
    id     = "expire-campaign-files"
    status = "Enabled"
    filter {
      prefix = "campaigns/"
    }
    expiration {
      days = 30
    }
  }
}

# The browser PUTs the CSV straight to S3 with a pre-signed URL.
resource "aws_s3_bucket_cors_configuration" "uploads" {
  bucket = aws_s3_bucket.uploads.id
  cors_rule {
    allowed_methods = ["PUT"]
    allowed_origins = local.allowed_origins
    allowed_headers = ["content-type"]
    max_age_seconds = 3000
  }
}

# Upload of recipients.csv -> sender Lambda
resource "aws_s3_bucket_notification" "uploads" {
  bucket = aws_s3_bucket.uploads.id

  lambda_function {
    lambda_function_arn = aws_lambda_function.sender.arn
    events              = ["s3:ObjectCreated:*"]
    filter_prefix       = "campaigns/"
    filter_suffix       = "recipients.csv"
  }

  depends_on = [aws_lambda_permission.s3_invoke_sender]
}

# ---------------------------------------------------------------------------
# DynamoDB: campaign history and delivery results
# ---------------------------------------------------------------------------

resource "aws_dynamodb_table" "campaigns" {
  name           = "${local.name}-campaigns"
  billing_mode   = "PROVISIONED" # 5/5 capacity is inside the always-free tier
  read_capacity  = 5
  write_capacity = 5
  hash_key       = "campaign_id"

  attribute {
    name = "campaign_id"
    type = "S"
  }
}
