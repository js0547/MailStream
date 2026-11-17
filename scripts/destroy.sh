#!/usr/bin/env bash
# Delete every AWS resource this project created.
set -euo pipefail
cd "$(dirname "$0")/../infra"
terraform destroy -auto-approve -input=false
