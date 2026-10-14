# Seal v1.0.0-rc.1 release notes

These notes describe the v1.0.0-rc.1 release candidate. The install commands below work after its assets are published.

This release candidate is a prerelease for evaluation before a final release. It is not GitHub's Latest stable release. The README and install guide commands fetch the published v0.5.3 release.

## Changes on main since v0.5.3

- `1696c40` (#451): The v0.5.3 release text now comes from the release documentation generator. No shipped artifact changes.
- `8de34a9` (#452): Install instructions continue to select the latest stable release when a prerelease exists.
- `445d93d` (#453): Source version 1.0.0-rc.1 and candidate notes identify this release. Install commands still select v0.5.3.
- `159d8b3` (#454): The candidate notes state that the shipped product has zero strictly proved properties.
- `6e835f4` (#455): The release workflow skips its documentation job for a prerelease.
- `764db16` (#460): The archived truth box links to the candidate notes for the shipped proof count.
- `5d27327` (#459): The README clarifies the Protect state and the scripted demo.
- `d73ec84` (#458): The archived claims matrix labels the seal-host proof home as archived.
- `1b74047` (#461): The published kernel check selects the tag commit when it checks release artifacts.
- `a8aef7f` (#463): No user-visible change. Tests reject stale dates and labels in status examples.
- `dfefce3` (#462): The archived claims matrix qualifies claim homes and checks its Home cells.
- `5005ea0` (#456): No user-visible change. The Lean axiom scan checks all 50 assigned kernel baseline modules.

## 1.0 closed-list status

Ben's eight-case acceptance walk is not done for this release. Ben moved the real-Mac arm64 Protect walk (row 7) to 1.1 on 2026-10-11. The blind walk of the published candidate (row 8), candidate claims batch (row 9), and final v1.0.0 tag and publication (row 10) remain open. The release documentation identity row (row 5) still needs a post-publication path. The release workflow skips the release-docs job for a prerelease. This record does not claim that these rows are complete.

## Known open honesty-map items

- BLOCK 1: `seal-verify-action` is archived, but its README still tells users to add it to CI as a live gate.
- BLOCK 2: `seal-host` is archived, but its README still calls it a deployed adapter and Seal pages still cite its proof index as reader-facing.
- BLOCK 5: The root claims-matrix and evaluator-start aliases are absent, while the archived live demo still says its evaluator link resolves.
- BLOCK 7: `seal-live-demo` is archived, but its README still presents its one-command demonstration as live evidence.
- BLOCK 8: The Node kernel config key is generated in the worker that supplies the config; replacing this demo-grade self-authorization is a product change for the next release.

These five items are open in this release candidate.

Seal supports install, demo, receipt checking and Protect on Linux x86-64 and macOS x64/arm64. The native macOS process-start witness helper is release-produced, not independently reproduced. macOS Protect execution is not exercised in CI. See `spine/platform.cjs`, `test/darwin-readiness.test.cjs`, and `test/release-matrix.test.mjs` for the platform boundary.

Receipts retain one `seal.receipt/v2` envelope. The verifier refuses `authorityRoot` and `occurrenceWitness` inputs. Positive VERIFY is unreachable in this release; its formatted result is `UNVERIFIED`. The checker checks supported structure, a signature against the supplied key, and replay. It does not prove event occurrence or authority.

**The strict proved-property count for the shipped product is zero.**

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
