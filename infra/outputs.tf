output "dashboard_url" {
  description = "Open this in a browser"
  value       = local.site_url
}

output "api_url" {
  value = aws_apigatewayv2_api.http.api_endpoint
}

output "site_bucket" {
  value = aws_s3_bucket.site.bucket
}

output "uploads_bucket" {
  value = aws_s3_bucket.uploads.bucket
}
