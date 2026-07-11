#!/bin/bash
# Local 5-min showcase for seal/ (no external clone needed in monorepo)
# Runs the no-Docker PWA replay + prints key evidence strings from the bundle.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LIVE="$ROOT/../seal-live-demo"
if [ ! -d "$LIVE" ]; then
  echo "Sibling seal-live-demo not found; falling back to printed evidence."
  cat "$ROOT/docs/EVIDENCE-SUMMARY.txt" 2>/dev/null || echo "See evidence in seal-live-demo/evidence/"
  exit 0
fi
cd "$LIVE/pwa"
echo "=== seal/ local showcase: PWA replay (no Docker) ==="
echo "Evidence bundle demonstrates block vs bypass on identical request."
echo "Key strings from bundle:"
grep -o 'blocked\|bypassed\|ASSERT OK\|rows unchanged\|rows -> 0' ../evidence/summary.md ../evidence/*.json 2>/dev/null | head -10 || true
echo ""
echo "Serving PWA on http://localhost:8090 (background for 5s)..."
python3 -m http.server 8090 >/dev/null 2>&1 &
SRV=$!
sleep 2
curl -s --max-time 3 http://localhost:8090 | head -c 800 || echo "(PWA UI would show the replay grid with block/bypass)"
kill $SRV 2>/dev/null || true
echo ""
echo "=== END OF SHOWCASE (see full bundle in ../evidence/ for re-derivation) ==="