DRAFT FOR BEN: the text of this record needs Ben's reading before the tag.
# Seal v1.0.0-rc.1 release notes

These notes describe the v1.0.0-rc.1 candidate. The install commands below work after v1.0.0-rc.1 assets are published.

A release candidate is a prerelease for evaluation before a final release; it is not GitHub's Latest stable release. At candidate preparation, the install commands in the README and install guide fetch the published v0.5.3 release.

## Changes since v0.5.3

- The published v0.5.3 release prose is owned by the release documentation generator. That work landed in commit `1696c40`.
- The generator now excludes prereleases when choosing the release it calls Latest. A newer prerelease therefore leaves the published v0.5.3 install instructions in place. That work landed in commit `8de34a9`.
- Those are the two commits in `v0.5.3..origin/main` before this candidate preparation. Neither changes the shipped v0.5.3 artifact.

## 1.0 closed-list status

The signed 1.0 closed list in the north star still marks the real-client eight-case Claude Code acceptance walk (row 6), real-Mac arm64 Protect walk (row 7), blind walk of the published candidate (row 8), candidate claims batch (row 9), and final v1.0.0 tag and publication (row 10) OPEN. The release documentation identity row (row 5) requires a post-publication documentation path; the current release workflow's documentation job will refuse this prerelease after publish because it expects the just-published tag to be Latest. These items are not claimed complete by this candidate record.

Seal supports install, demo, receipt checking and Protect on Linux x86-64 and macOS x64/arm64. The native macOS process-start witness helper is release-produced, not independently reproduced. macOS Protect execution is not exercised in CI. See `spine/platform.cjs`, `test/darwin-readiness.test.cjs`, and `test/release-matrix.test.mjs` for the platform boundary.

Receipts retain one `seal.receipt/v2` envelope. The verifier refuses `authorityRoot` and `occurrenceWitness` inputs. Positive VERIFY is unreachable in this release; its formatted result is `UNVERIFIED`. The checker checks supported structure, a signature against the supplied key, and replay. It does not prove event occurrence or authority.

<!-- generated candidate release notes; do not edit -->
## Download, verify, and install after publication

Run these commands on Linux x86-64 with Node 20+ after the v1.0.0-rc.1 assets are published. `SHA256SUMS` has three fields per line: SHA-256, byte count, and filename. The command converts the matching record to the two-field format accepted by `sha256sum --check` and checks the byte count separately.

```bash
set -e
SEAL_VERSION=v1.0.0-rc.1
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
