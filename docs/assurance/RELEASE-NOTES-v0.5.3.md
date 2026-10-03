# Seal v0.5.3 release notes

These notes describe the v0.5.3 candidate. The install commands below work after v0.5.3 assets are published.

## Changes since v0.5.2

- Upgrade from v0.5.2 because this version refuses two calls that the v0.5.2 binary forwarded: a `tools/invoke` call and a `tools/call` with colliding `Path` and `path` argument keys. The first returns `method_not_allowed`; the second returns `key_case_fold_collision`. Both are blocked before the child receives the call.
- Receipt verification refuses small-order Ed25519 public keys with `public_key_small_order` and noncanonical Ed25519 public keys with `public_key_noncanonical`. The checker CLI, Seal CLI, and MCP verification path report these codes.
- Protect setup now explains the Node 22 or newer requirement for Claude Code and the Node upgrade path. The first-tool guide and CLI reference give additional setup and command detail.
- Seal refuses malformed project MCP launch fields and unusable Claude commands before starting Protect. It checks removal of its local route during unprotect and prints a recovery command for an invalid installation lock.
- Demo runs keep each receipt signing key with its run, including when a directory is reused. The demo child checks its execution grant. Duplicate elicitation answers do not consume pending approvals.
- Guarded calls preserve MCP progress metadata. Approval text fits complete routed arguments within its line budget, shows mixed-script names with visible escapes, and treats unmatched Common letters as neutral.
- Installed protected routes use the verified launcher. Verify refuses unchecked paths and reports MCP verification errors. Receipt checks print named refusals for unsigned receipts and missing public keys.
- The README shows observed demo output. The guide and reference now describe refusal and exit code contracts; contract tests cover those surfaces.
- Documentation now groups the sidebar into five reader routes, restores legacy documentation paths, and gives a portable first-approval demo command.
- The development `npm test` command points to the guarded product suite, and CI runs the shipped Lean kernel checks and host tests.

Seal supports install, demo, receipt checking and Protect on Linux x86-64 and macOS x64/arm64. The native macOS process-start witness helper is release-produced, not independently reproduced. macOS Protect execution is not exercised in CI. See `spine/platform.cjs`, `test/darwin-readiness.test.cjs`, and `test/release-matrix.test.mjs` for the platform boundary.

Receipts retain one `seal.receipt/v2` envelope. The verifier refuses `authorityRoot` and `occurrenceWitness` inputs. Positive VERIFY is unreachable in this release; its formatted result is `UNVERIFIED`. The checker checks supported structure, a signature against the supplied key, and replay. It does not prove event occurrence or authority.

<!-- generated candidate release notes; do not edit -->
## Download, verify, and install after publication

Run these commands on Linux x86-64 with Node 20+ after the v0.5.3 assets are published. `SHA256SUMS` has three fields per line: SHA-256, byte count, and filename. The command converts the matching record to the two-field format accepted by `sha256sum --check` and checks the byte count separately.

```bash
set -e
SEAL_VERSION=v0.5.3
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
