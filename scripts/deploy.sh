#!/usr/bin/env bash
# One-command deploy: infrastructure (Terraform) + dashboard (React build -> S3).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "==> Deploying AWS infrastructure"
cd "$ROOT/infra"
terraform init -input=false >/dev/null
terraform apply -auto-approve -input=false

SITE_BUCKET="$(terraform output -raw site_bucket)"
DASHBOARD_URL="$(terraform output -raw dashboard_url)"

echo "==> Building dashboard"
cd "$ROOT/frontend"
npm ci --no-fund --no-audit
npm run build

echo "==> Uploading dashboard to s3://$SITE_BUCKET"
# config.js is managed by Terraform (holds the API URL), so don't overwrite it.
aws s3 sync dist/ "s3://$SITE_BUCKET/" --delete --exclude config.js
# index.html must never be cached, or browsers keep loading the old app
# after a redeploy (the hashed files in assets/ can be cached forever).
aws s3 cp dist/index.html "s3://$SITE_BUCKET/index.html" \
  --cache-control "no-cache" --content-type "text/html; charset=utf-8"

echo
echo "Done. Dashboard: $DASHBOARD_URL"
