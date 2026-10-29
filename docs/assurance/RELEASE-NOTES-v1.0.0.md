# Seal v1.0.0 release notes

These notes describe the published v1.0.0 release. The install commands below use that release's `SHA256SUMS` asset.

This candidate follows the published v1.0.0-rc.1 prerelease. Until v1.0.0 is published, the README and install guide fetch the latest published stable release, v0.5.3.

## Changes since v1.0.0-rc.1

- The release checks now run every rostered kernel test executable and refuse missing or extra executables (`bbb73d4`, `67bd59e`, `4118eaa`). The A2 divergence checks are part of the Lean tests (`b58273b`).
- Release artifact reads retry after server and network errors (`d413668`, `fd579f5`). The install guide and generated release docs refuse a checker download in the primary install commands (`1bb1ba1`, `73eb0e2`).
- The claims pages have live routes, and the archived proof references have clearer limits (`224c95f`, `aa1f2fc`, `f582e28`). The demo configuration key and replay-only checker key are labelled (`01692d3`).
- A separate hosted macOS arm64 workflow drives Protect using a published asset (`2918b6b`). It does not record a human walk on a real Mac.

## 1.0 closed-list status

Rows 6, 7 and 8 are not done at this release cut. Row 6 needs the Linux real-client acceptance walk. Row 7 needs the real Mac walk; the hosted macOS test does not replace it. Row 8 needs the stranger walk of published bytes. Row 9 is open: the 2026-10-25 claims rescore found six open BLOCK rows on its measured main commit. Ben's 2026-10-25 19:15 ruling says the version cut need not wait for demos or walks and that claims need not be complete. The Monkey ruled at 19:42 that row 9 does not gate this tag. These open rows can advance after publication. Row 10 still needs the tag, the release workflow and its publication gate.

Tags v0.4.1 and v0.5.0 exist, but neither was published as a GitHub release.

Seal supports install, demo, receipt checking and Protect on Linux x86-64 and macOS x64/arm64. The native macOS process-start witness helper is release-produced, not independently reproduced. The main macOS source test workflow does not exercise Protect. The separate hosted macOS arm64 workflow exercises Protect from a published asset. See `spine/platform.cjs`, `test/darwin-readiness.test.cjs`, and `test/release-matrix.test.mjs` for the platform boundary.

Receipts retain one `seal.receipt/v2` envelope. The verifier refuses `authorityRoot` and `occurrenceWitness` inputs. Positive VERIFY is unreachable in this release; its formatted result is `UNVERIFIED`. The checker checks supported structure, a signature against the supplied key, and replay. It does not prove event occurrence or authority.

**The strict proved-property count for the shipped product is zero.**

<!-- generated candidate release notes; do not edit -->
## Download, verify, and install after publication

Run these commands on Linux x86-64 with Node 20+ after the v1.0.0 assets are published. `SHA256SUMS` has three fields per line: SHA-256, byte count, and filename. The command converts the matching record to the two-field format accepted by `sha256sum --check` and checks the byte count separately.

```bash
set -e
SEAL_VERSION=v1.0.0
artifact="seal-$SEAL_VERSION-linux-x64"
base="https://github.com/velvetmonkey/seal/releases/download/$SEAL_VERSION"
curl -fsSLO "$base/SHA256SUMS"
curl -fsSLO "$base/$artifact"
curl -fsSLO "$base/seal-receipt-v2.mjs"
awk -v name="$artifact" '$3 == name { print $1 "  " $3 }' SHA256SUMS > artifact.sha256.check
sha256sum --check artifact.sha256.check
expected_bytes="$(awk -v name="$artifact" '$3 == name { print $2 }' SHA256SUMS)"
test -n "$expected_bytes"
test "$(wc -c < "$artifact")" -eq "$expected_bytes"
awk '$3 == "seal-receipt-v2.mjs" { print $1 "  " $3 }' SHA256SUMS > checker.sha256.check
sha256sum --check checker.sha256.check
chmod +x "$artifact"
prefix="$HOME/.local"
./"$artifact" --sha256 "$(awk -v name="$artifact" '$3 == name { print $1 }' SHA256SUMS)" --bytes "$expected_bytes" --prefix "$prefix"
```

The sibling `seal-receipt-v2.mjs` asset imports `../runtime/kernel/decision-runner.cjs`, so it runs from an installed store with that runtime, not alone from the download directory. The published checker workflow verifies the downloaded asset and places it in a copy of the installed store before running it. With a receipt and signer key from `seal demo`, run it there as follows:

```bash
set -e
demo_dir="${TMPDIR:-$HOME}/seal-published-demo"
printf 'y\n' > "${TMPDIR:-$HOME}/seal-demo-input"
"$prefix/bin/seal" demo --dir "$demo_dir" < "${TMPDIR:-$HOME}/seal-demo-input"
receipt="$(find "$demo_dir/receipts" -maxdepth 1 -type f -name '*-BLOCK.json' -print -quit)"
pubkey="$demo_dir/receipt-signer.pub"
test -n "$receipt"
test -f "$pubkey"
store="$(node -p "require('$prefix/lib/seal/install.json').treeSha256")"
checker_store="${TMPDIR:-$HOME}/published-checker-store"
cp -a "$prefix/lib/seal/store/$store" "$checker_store"
chmod u+w "$checker_store/checker/seal-receipt-v2.mjs"
cp seal-receipt-v2.mjs "$checker_store/checker/seal-receipt-v2.mjs"
checker="$checker_store/checker/seal-receipt-v2.mjs"
node "$checker" "$receipt" --pubkey "$(cat "$pubkey")"
```

This command checks the receipt's supported structure, signature against the supplied key, and replay. It does not establish authority, event occurrence, or that an effect happened.
<!-- end generated candidate release notes -->
