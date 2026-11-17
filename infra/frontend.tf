# The React dashboard is served by S3 static website hosting.
#
# Note: CloudFront (HTTPS + caching) would be the production choice, but brand
# new AWS accounts are not allowed to create CloudFront distributions until AWS
# Support verifies them, so this project uses the S3 website endpoint (HTTP).
# The bucket only contains the built static UI; no data or secrets.

resource "aws_s3_bucket" "site" {
  bucket        = "${local.name}-site-${local.suffix}"
  force_destroy = true
}

resource "aws_s3_bucket_website_configuration" "site" {
  bucket = aws_s3_bucket.site.id
  index_document {
    suffix = "index.html"
  }
  error_document {
    key = "index.html"
  }
}

# Website hosting needs public read on the objects (read-only, nothing else).
resource "aws_s3_bucket_public_access_block" "site" {
  bucket                  = aws_s3_bucket.site.id
  block_public_acls       = true
  ignore_public_acls      = true
  block_public_policy     = false
  restrict_public_buckets = false
}

data "aws_iam_policy_document" "site" {
  statement {
    sid       = "PublicReadForWebsite"
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.site.arn}/*"]
    principals {
      type        = "*"
      identifiers = ["*"]
    }
  }
}

resource "aws_s3_bucket_policy" "site" {
  bucket     = aws_s3_bucket.site.id
  policy     = data.aws_iam_policy_document.site.json
  depends_on = [aws_s3_bucket_public_access_block.site]
}

# Runtime config for the dashboard. Written by Terraform so the built
# frontend never has the API URL baked in.
resource "aws_s3_object" "site_config" {
  bucket        = aws_s3_bucket.site.id
  key           = "config.js"
  content_type  = "application/javascript"
  cache_control = "no-cache"
  content       = "window.MAILSTREAM_CONFIG = ${jsonencode({ apiUrl = aws_apigatewayv2_api.http.api_endpoint })};\n"
}
