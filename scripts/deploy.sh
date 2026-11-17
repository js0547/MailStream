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

echo
echo "Done. Dashboard: $DASHBOARD_URL"
