#!/bin/bash
# SPDX-License-Identifier: Apache-2.0
# Umbrella showcase. In the full family layout it runs the live-demo replay.
# Cloned on its own, it does NOT dead-end: it points you at the fastest real
# receipt (the dependency-free assurance kit) and the full replay demo.
set -euo pipefail
cd "$(dirname "$0")/.."

if [[ -d ../seal-live-demo ]]; then
  exec timeout 180s bash ../seal-live-demo/scripts/run_local.sh 2>&1
fi

cat <<'EOF'
The sibling ../seal-live-demo is not checked out next to this repo, so the full
block-vs-bypass replay can't run from here. Nothing is broken — pick a real path:

  Fastest real receipt (~60s, zero dependencies — no Docker, no Lean toolchain):
    git clone https://github.com/velvetmonkey/seal-assurance-kit
    cd seal-assurance-kit
    node bin/seal verify fixtures/receipt-block.json     # -> PASS VERIFIED (exit 0)

  Full "watch it stop the attack" replay (block vs bypass, same bytes):
    git clone https://github.com/velvetmonkey/seal-live-demo
    # then re-run this script from the family layout, or follow that repo's README

  Read-only here: open ./index.html (the product map) and docs/WHY-DIFFERENT.md.
EOF
exit 0
