#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ -d ../seal-live-demo ]]; then
  exec timeout 180s bash ../seal-live-demo/scripts/run_local.sh 2>&1
else
  echo "ERROR: sibling ../seal-live-demo not found; run from family layout or use live-demo directly" >&2
  exit 1
fi
