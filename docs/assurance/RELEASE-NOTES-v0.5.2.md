# Seal v0.5.2 release notes

These are candidate notes for the next release. No v0.5.2 tag or asset is published yet. The install commands below apply after v0.5.2 is published, and use that release's `SHA256SUMS` asset. The current published install instructions remain tied to the live Latest release.

## Changes since v0.5.1

- The candidate combines the source changes reviewed in PR 401 and PR 403. Its source identity is v0.5.2; the release workflow has not published those bytes.
- Reader-facing assurance text records that `collision-check` is public, `seal-verify-action` is archived, and `seal receipt-diff` accepts supported kit and host receipt families rather than arbitrary pairs.
- The live seal-check page guard is pinned to the page proposed in seal-check PR 48, combining the CSP correction and receipt result layout.

Seal supports install, demo, receipt checking and Protect on Linux x86-64 and macOS x64/arm64. The native macOS process-start witness helper is release-produced, not independently reproduced. macOS Protect execution is not exercised in CI. See `spine/platform.cjs`, `test/darwin-readiness.test.cjs`, and `test/release-matrix.test.mjs` for the platform boundary.

Receipts retain one `seal.receipt/v2` envelope. The verifier refuses `authorityRoot` and `occurrenceWitness` inputs. Positive VERIFY is unreachable in this release; its formatted result is `UNVERIFIED`. The checker's successful result covers the supported structure, supplied-key signature, and replay, without proving event occurrence or authority.

## Download, verify, and install after publication

Run these commands on Linux x86-64 with Node 20+ after the v0.5.2 assets are published. `SHA256SUMS` has three fields per line: SHA-256, byte count, and filename. The command converts the matching record to the two-field format accepted by `sha256sum --check` and checks the byte count separately.

```bash
set -e
SEAL_VERSION=v0.5.2
artifact="seal-$SEAL_VERSION-linux-x64"
base="https://github.com/velvetmonkey/seal/releases/download/$SEAL_VERSION"
curl -fsSLO "$base/SHA256SUMS"
curl -fsSLO "$base/$artifact"
curl -fsSLO "$base/seal-receipt-v2.mjs"
awk -v name="$artifact" '$3 == name { print $1 "  " $3 }' SHA256SUMS | sha256sum --check
expected_bytes="$(awk -v name="$artifact" '$3 == name { print $2 }' SHA256SUMS)"
test -n "$expected_bytes"
test "$(wc -c < "$artifact")" -eq "$expected_bytes"
awk '$3 == "seal-receipt-v2.mjs" { print $1 "  " $3 }' SHA256SUMS | sha256sum --check
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
