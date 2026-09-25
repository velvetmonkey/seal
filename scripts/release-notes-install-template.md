## Download, verify, and install after publication

Run these commands on Linux x86-64 with Node 20+ after the v@VERSION@ assets are published. `SHA256SUMS` has three fields per line: SHA-256, byte count, and filename. The command converts the matching record to the two-field format accepted by `sha256sum --check` and checks the byte count separately.

```bash
set -e
SEAL_VERSION=v@VERSION@
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
