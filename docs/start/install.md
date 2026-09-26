<!-- generated from published release; do not edit -->
# Install Seal v0.5.2
The [v0.5.2 release](https://github.com/velvetmonkey/seal/releases/tag/v0.5.2) publishes `seal-v0.5.2-darwin-arm64`, `seal-v0.5.2-darwin-x64`, `seal-v0.5.2-linux-x64`, `seal-receipt-v2.mjs`, and `SHA256SUMS`; its tag resolves to commit [`e5d901fc7183485bf9565ded4f3ccb73ee71efde`](https://github.com/velvetmonkey/seal/commit/e5d901fc7183485bf9565ded4f3ccb73ee71efde). Its `release-manifest.json` uses schema `seal.release/v2`. This checkout supports Protect on Linux x86-64 and macOS x64/arm64.
The native macOS process-start witness helper is release-produced, not independently reproduced. Windows and Linux ARM are unsupported. Node 20+ is required.
The installer refuses before changing anything on an unsupported or mismatched platform.

This page is the SHA256SUMS verification wall. The [README](../../README.md)
short form uses the same shell gate. In every install command below, a failed
checksum comparison prevents both `chmod` and execution of the artifact.
The commands use POSIX syntax for `sh`, `dash`, `bash`, and `zsh`. Copy each
whole command, including its continuation backslashes and `&&` operators;
there is no shell-option preamble. The release version is a separate assignment;
omitting it cannot remove the verification gate. Each continuation starts with
`&&`, so copying a continuation alone produces a syntax error.

The digest comparison below is *your* check, with the OS SHA-256 tool,
against the `SHA256SUMS` asset attached to the same GitHub release. That is
not the installer checking itself. The `--sha256` flag is a
second pin the installer demands and will refuse without. The optional `--bytes` flag adds a length check. Together they
answer "did I download the bytes the release named?" They do not answer
"is the publisher honest?"

## Verify, then install
<!-- end generated release docs -->

<!-- generated from published release; do not edit -->
```bash
SEAL_VERSION=v0.5.2
artifact_name="seal-v0.5.2-linux-x64" \
&& artifact_sha256="693c901376f4f1d4f6584fc106fea301d3707d78f698bc905ec87221a8714f52" \
&& artifact_bytes=6370451 \
&& sums_name="SHA256SUMS" \
&& sums_sha256="aa2f148f990667aa1a3feaa362c87a5e2a767c7a77a6bd45c1904c2239bb42f1" \
&& checker_name="seal-receipt-v2.mjs" \
&& checker_sha256="6576c97c0065a3414cad332a8fa930d4283a57c763dfbfa6ce26aa47abed3636" \
&& checker_bytes=10789 \
&& curl -fsSLO "https://github.com/velvetmonkey/seal/releases/download/$SEAL_VERSION/$sums_name" \
&& curl -fsSLO "https://github.com/velvetmonkey/seal/releases/download/$SEAL_VERSION/$artifact_name" \
&& curl -fsSLO "https://github.com/velvetmonkey/seal/releases/download/$SEAL_VERSION/$checker_name" \
&& if command -v shasum >/dev/null 2>&1; then sums_actual="$(shasum -a 256 "$sums_name")"; else sums_actual="$(sha256sum "$sums_name")"; fi \
&& test "${sums_actual%% *}" = "$sums_sha256" \
&& expected_record="$(awk -v name="$artifact_name" '$3 == name { print $1, $2, $3 }' "$sums_name")" \
&& test "$expected_record" = "$artifact_sha256 $artifact_bytes $artifact_name" \
&& if command -v shasum >/dev/null 2>&1; then actual_digest="$(shasum -a 256 "$artifact_name")"; else actual_digest="$(sha256sum "$artifact_name")"; fi \
&& test "${actual_digest%% *}" = "$artifact_sha256" \
&& actual_bytes="$(wc -c < "$artifact_name")" \
&& test "$actual_bytes" -eq "$artifact_bytes" \
&& checker_record="$(awk -v name="$checker_name" '$3 == name { print $1, $2, $3 }' "$sums_name")" \
&& test "$checker_record" = "$checker_sha256 $checker_bytes $checker_name" \
&& if command -v shasum >/dev/null 2>&1; then checker_actual="$(shasum -a 256 "$checker_name")"; else checker_actual="$(sha256sum "$checker_name")"; fi \
&& test "${checker_actual%% *}" = "$checker_sha256" \
&& checker_count="$(wc -c < "$checker_name")" \
&& test "$checker_count" -eq "$checker_bytes" \
&& chmod +x "$artifact_name" \
&& ./"$artifact_name" --sha256 "$artifact_sha256" --bytes "$artifact_bytes" --prefix ~/.local
```
Success prints `installed seal 0.5.2 linux-x64` and the store, command,
and tree lines. Path prefixes on `store:` and `command:` differ per machine.
The tree hash of the published v0.5.2 asset is pinned here:

**Seal installed-tree pin role:** `published-asset`
```output
installed seal 0.5.2 linux-x64
store: /home/you/.local/lib/seal/store/8018be632b4e95ede7dd7c17e5d08d0495721e6a9187ab0538664866b39150e3
command: /home/you/.local/bin/seal
tree: 8018be632b4e95ede7dd7c17e5d08d0495721e6a9187ab0538664866b39150e3
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
tree: 0bd5477a7a4a99175cd0b76895dc988c5900693317fcf7dc8ca004bb5869eae5
```

That hash is the installed-tree digest of the payload `scripts/build-dist.cjs`
packs from this tree. It is not a captured command transcript. It will
change when a payload member changes; it does not change when only docs
change.

Before scripting receipt checks, read the [v0.4.0 standalone checker exit-status notice](../verify/README.md#v040-standalone-checker-exit-status).

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

## Build and install this checkout on Linux x86-64

For the [source-build evaluator walk](evaluator-walk.md), run this from the
checkout root with Node 20+ on Linux x86-64. It builds the artifact, checks
its SHA-256 digest and byte count, and installs under this checkout's
`dist/local` directory:

```bash
platform="linux-$(node -p 'process.arch')" \
&& node scripts/build-dist.cjs --platform "$platform" --out dist \
&& read -r expected_digest expected_bytes expected_name < dist/SHA256SUMS \
&& test "$expected_name" = "$(node scripts/product-identity.cjs --artifact-name | sed 's/-linux-x64$//')-$platform" \
&& test -n "$expected_digest" \
&& if command -v shasum >/dev/null 2>&1; then actual_digest="$(shasum -a 256 "dist/$expected_name")"; else actual_digest="$(sha256sum "dist/$expected_name")"; fi \
&& test "${actual_digest%% *}" = "$expected_digest" \
&& actual_bytes="$(wc -c < "dist/$expected_name")" \
&& test "$actual_bytes" -eq "$expected_bytes" \
&& chmod +x "dist/$expected_name" \
&& ./"dist/$expected_name" --sha256 "$expected_digest" --bytes "$expected_bytes" --prefix "$PWD/dist/local"
```

Add this installation to PATH in the same shell before following the walk:

```bash
$ export PATH="$PWD/dist/local/bin:$PATH"
```

## Build and install this checkout on macOS

The macOS CI lane selects `macos-15` for `darwin-arm64` and `macos-15-intel` for `darwin-x64`.
CI passes `--macos-helper` to include the matching native process-start witness helper in the payload.
For this recipe, set `MACOS_HELPER` to the path of that helper from the matching release runner.
The recipe selects the artifact label from Node's running architecture and uses the
SHA-256 utility shipped by macOS when GNU `sha256sum` is absent:

```bash
platform="darwin-$(node -p 'process.arch')" \
&& node scripts/build-dist.cjs --platform "$platform" --macos-helper "$MACOS_HELPER" --out dist \
&& read -r expected_digest expected_bytes expected_name < dist/SHA256SUMS \
&& test "$expected_name" = "$(node scripts/product-identity.cjs --artifact-name | sed 's/-linux-x64$//')-$platform" \
&& test -n "$expected_digest" \
&& if command -v shasum >/dev/null 2>&1; then actual_digest="$(shasum -a 256 "dist/$expected_name")"; else actual_digest="$(sha256sum "dist/$expected_name")"; fi \
&& test "${actual_digest%% *}" = "$expected_digest" \
&& actual_bytes="$(wc -c < "dist/$expected_name")" \
&& test "$actual_bytes" -eq "$expected_bytes" \
&& chmod +x "dist/$expected_name" \
&& ./"dist/$expected_name" --sha256 "$expected_digest" --bytes "$expected_bytes" --prefix ~/.local
```

This checkout supports Protect on Linux x86-64 and macOS x64/arm64. The native macOS process-start witness helper is release-produced, not independently reproduced. macOS Protect execution is not exercised in CI.

If you installed the published release, continue with
[Choosing what to protect](../guide/choosing-what-to-protect.md). If you built
and installed this checkout, continue with the [Evaluator walk](evaluator-walk.md).

Previous: [Start](README.md).
Up: [Start](README.md).
Next: [Evaluator walk](evaluator-walk.md).
