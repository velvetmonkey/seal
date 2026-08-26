#!/usr/bin/env bash
# Run the product-suite driver through the receipt writer's own observation.
set -uo pipefail

script_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
runner="${SEAL_SUITE_RUNNER:-$script_root/scripts/run-complete-product-suite.sh}"
receipt_writer="$script_root/scripts/suitecapture-receipt.mjs"
git_sha="$(git -C "$script_root" rev-parse --verify HEAD^{commit} 2>/dev/null || true)"

# The writer spawns this exact runner and captures its output before it mints a
# receipt. Do not put a caller-owned raw file between the runner and writer.
exec node "$receipt_writer" observe --sha "$git_sha" --runner "$runner" -- "$@"
