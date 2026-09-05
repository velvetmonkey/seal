<!-- generated from published release; do not edit -->
# Install Seal v0.2.1
The [v0.2.1 release](https://github.com/velvetmonkey/seal/releases/tag/v0.2.1) publishes `seal-v0.2.1-darwin-arm64`, `seal-v0.2.1-darwin-x64`, `seal-v0.2.1-linux-x64`, `seal-receipt-v2.mjs`, and `SHA256SUMS`; its tag resolves to commit [`ae3255ec9a5637ca965f04818c73abdac21a75e1`](https://github.com/velvetmonkey/seal/commit/ae3255ec9a5637ca965f04818c73abdac21a75e1). Its `release-manifest.json` uses schema `seal.release/v2`. This checkout supports Protect on Linux x86-64 and macOS x64/arm64.
The native macOS process-start witness helper is release-produced, not independently reproduced. Windows and Linux ARM are unsupported. Node 20+ is required.
The installer refuses before changing anything on an unsupported or mismatched platform.

This page is the SHA256SUMS verification wall. The [README](../../README.md)
short form is the same install without the named refusals spelled out. Use
this page when you want every check to fail closed in the shell, before the
binary runs.

The digest comparison below is *your* check, with the OS SHA-256 tool,
against the `SHA256SUMS` asset attached to the same GitHub release. That is
not the installer checking itself. The `--sha256` / `--bytes` flags are a
second pin the installer demands and will refuse without. Together they
answer "did I download the bytes the release named?" They do not answer
"is the publisher honest?"

## Verify, then install
<!-- end generated release docs -->

<!-- generated from published release; do not edit -->
```bash
SEAL_VERSION=v0.2.1
artifact_name="seal-v0.2.1-linux-x64"; artifact_sha256="4063ea160b1e8cea8f0ca0c87453484a7827bf0cbfb9ac1179888814e490b9dd"; artifact_bytes=6214316
checker_name="seal-receipt-v2.mjs"; checker_sha256="41bc5d7d7e4476cc9c312ca04dfb343b373b41e8f4aae7855d18693b8b99f18f"; checker_bytes=10133
sums_name="SHA256SUMS"; sums_sha256="79054c0c63d1c70ca5b1e9d0c1d5670a947f49d7abeded441ad742b392ee19c0"
curl -fsSLO "https://github.com/velvetmonkey/seal/releases/download/$SEAL_VERSION/$sums_name"
curl -fsSLO "https://github.com/velvetmonkey/seal/releases/download/$SEAL_VERSION/$artifact_name"
curl -fsSLO "https://github.com/velvetmonkey/seal/releases/download/$SEAL_VERSION/$checker_name"
if command -v shasum >/dev/null 2>&1; then sums_actual="$(shasum -a 256 "$sums_name" | awk '{print $1}')"; elif command -v sha256sum >/dev/null 2>&1; then sums_actual="$(sha256sum "$sums_name" | awk '{print $1}')"; else echo "no SHA-256 tool found (need shasum or sha256sum)" >&2; exit 1; fi; test "$sums_actual" = "$sums_sha256"
read -r expected_digest expected_bytes expected_name < <(awk -v name="$artifact_name" '$3 == name' "$sums_name"); test "$expected_name" = "$artifact_name"; test "$expected_digest" = "$artifact_sha256"; test "$expected_bytes" = "$artifact_bytes"
if command -v shasum >/dev/null 2>&1; then actual_digest="$(shasum -a 256 "$artifact_name" | awk '{print $1}')"; elif command -v sha256sum >/dev/null 2>&1; then actual_digest="$(sha256sum "$artifact_name" | awk '{print $1}')"; fi; test "$actual_digest" = "$artifact_sha256"; test "$(wc -c < "$artifact_name" | tr -d ' ')" = "$artifact_bytes"
read -r checker_sum checker_count checker_entry < <(awk -v name="$checker_name" '$3 == name' "$sums_name"); test "$checker_entry" = "$checker_name"; test "$checker_sum" = "$checker_sha256"; test "$checker_count" = "$checker_bytes"; if command -v shasum >/dev/null 2>&1; then checker_actual="$(shasum -a 256 "$checker_name" | awk '{print $1}')"; else checker_actual="$(sha256sum "$checker_name" | awk '{print $1}')"; fi; test "$checker_actual" = "$checker_sha256"; test "$(wc -c < "$checker_name" | tr -d ' ')" = "$checker_bytes"
chmod +x "$expected_name"; ./"$expected_name" --sha256 "$expected_digest" --bytes "$expected_bytes" --prefix ~/.local
```
Success prints `installed seal 0.2.1 linux-x64` and the store, command,
and tree lines. Path prefixes on `store:` and `command:` differ per machine.
The tree hash of the published v0.2.1 asset is pinned here:

**Seal installed-tree pin role:** `published-asset`
```output
installed seal 0.2.1 linux-x64
store: /home/you/.local/lib/seal/store/13e2b2a8b1e6301b2e3562e3bf6bcee78da8cb9302e12a41a1261ae08fef9f72
command: /home/you/.local/bin/seal
tree: 13e2b2a8b1e6301b2e3562e3bf6bcee78da8cb9302e12a41a1261ae08fef9f72
```

Add `~/.local/bin` to PATH:

```bash
$ export PATH="$HOME/.local/bin:$PATH"
```

Further distribution detail, including what each payload contains, is in
[DISTRIBUTION.md](../assurance/distribution.md). The downloaded checker is
only checked against `SHA256SUMS`; from a source checkout, run
`node checker/seal-receipt-v2.mjs docs/reference/receipt-operations-v1/receipt-block.json`.
<!-- end generated release docs -->

## Source-build tree pin
A build of this checkout (not the published release asset) writes
`dist/seal-v<identity>-linux-x64`. That tree digest is a different claim
from the published-asset pin above:

**Seal installed-tree pin role:** `fresh-build`
```text
tree: ae60964ca7614060296e93715a2496f8c1c15f48ae636dbe4ece6ae29d433bef
```

That hash is the installed-tree digest of the payload `scripts/build-dist.cjs`
packs from this tree. It is not a captured command transcript. It will
change when a payload member changes; it does not change when only docs
change.

### Installed-tree hash definition

The installed tree is exactly the regular payload files named by the artifact's
payload manifest (a fresh build includes `checker/seal-receipt-v2.mjs` for
`seal verify`). Order those relative slash-separated paths by bytewise
lexicographic path order. For each file, SHA-256 its exact payload bytes and
form one UTF-8 line: `<file-sha256><two spaces><decimal byte count><two
spaces><path><newline>`. Concatenate those lines without another separator and
SHA-256 the resulting UTF-8 byte sequence. That final digest is the
installed-tree hash. The same definition applies to a published asset; its
payload manifest, rather than this checkout, selects its file set.

## Build and install this checkout on macOS

The macOS CI lane runs this source-build ritual on a real `macos-latest` host.
It selects the artifact label from Node's running architecture and uses the
SHA-256 utility shipped by macOS when GNU `sha256sum` is absent:

```bash
platform="darwin-$(node -p 'process.arch')"
node scripts/build-dist.cjs --platform "$platform" --out dist
read -r expected_digest expected_bytes expected_name < dist/SHA256SUMS
if [ "$expected_name" != "$(node scripts/product-identity.cjs --artifact-name | sed 's/-linux-x64$//')-$platform" ]; then echo "SHA256SUMS names an unexpected artifact: $expected_name" >&2; exit 1; fi
if command -v shasum >/dev/null 2>&1; then actual_digest="$(shasum -a 256 "dist/$expected_name" | awk '{print $1}')"; elif command -v sha256sum >/dev/null 2>&1; then actual_digest="$(sha256sum "dist/$expected_name" | awk '{print $1}')"; else echo "no SHA-256 tool found (need shasum or sha256sum)" >&2; exit 1; fi
if [ "$actual_digest" != "$expected_digest" ]; then echo "artifact digest does not match SHA256SUMS" >&2; exit 1; fi
actual_bytes="$(wc -c < "dist/$expected_name" | tr -d ' ')"
if [ "$actual_bytes" != "$expected_bytes" ]; then echo "artifact byte count does not match SHA256SUMS" >&2; exit 1; fi
chmod +x "dist/$expected_name"
./"dist/$expected_name" --sha256 "$expected_digest" --bytes "$expected_bytes" --prefix ~/.local
```

This checkout supports Protect on Linux x86-64 and macOS x64/arm64. The native macOS process-start witness helper is release-produced, not independently reproduced. macOS Protect execution is not exercised in CI.

Previous: [Start](README.md).
Up: [Start](README.md).
Next: [Evaluator walk](evaluator-walk.md).
