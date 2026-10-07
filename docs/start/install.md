<!-- generated from published release; do not edit -->
# Install Seal v0.5.3
The [v0.5.3 release](https://github.com/velvetmonkey/seal/releases/tag/v0.5.3) publishes `seal-v0.5.3-darwin-arm64`, `seal-v0.5.3-darwin-x64`, `seal-v0.5.3-linux-x64`, `seal-receipt-v2.mjs`, and `SHA256SUMS`; its tag resolves to commit [`bcf6a81d51601b02c0512fda3660f35b2171b0a4`](https://github.com/velvetmonkey/seal/commit/bcf6a81d51601b02c0512fda3660f35b2171b0a4). Its `release-manifest.json` uses schema `seal.release/v2`. This checkout supports Protect on Linux x86-64 and macOS x64/arm64.
The native macOS process-start witness helper is release-produced, not independently reproduced. Windows and Linux ARM are unsupported. Seal itself requires Node 20 or newer.
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
Protect needs Claude Code, which needs Node 22 or newer. If you want Protect and `node --version` reports below v22, get Node from https://nodejs.org/en/download or use a version manager such as nvm; then run `node --version` again and expect v22 or newer. Continue to [Start Protect in a project](#start-protect-in-a-project) after installing Seal.
<!-- generated from published release; do not edit -->
### Linux x86-64
```bash
SEAL_VERSION=v0.5.3
artifact_name="seal-v0.5.3-linux-x64" \
&& artifact_sha256="cc0835c7d7f8c90b7b6858ea80a9f447a1be25d84cb5f496a33ef61985f2868e" \
&& artifact_bytes=6418125 \
&& sums_name="SHA256SUMS" \
&& sums_sha256="1617beb751f1a1569ab5fa338ed82abb9b8aee65370b409b14be7fe926c4c479" \
&& curl -fsSLO "https://github.com/velvetmonkey/seal/releases/download/$SEAL_VERSION/$sums_name" \
&& curl -fsSLO "https://github.com/velvetmonkey/seal/releases/download/$SEAL_VERSION/$artifact_name" \
&& if command -v shasum >/dev/null 2>&1; then sums_actual="$(shasum -a 256 "$sums_name")"; else sums_actual="$(sha256sum "$sums_name")"; fi \
&& test "${sums_actual%% *}" = "$sums_sha256" \
&& expected_record="$(awk -v name="$artifact_name" '$3 == name { print $1, $2, $3 }' "$sums_name")" \
&& test "$expected_record" = "$artifact_sha256 $artifact_bytes $artifact_name" \
&& if command -v shasum >/dev/null 2>&1; then actual_digest="$(shasum -a 256 "$artifact_name")"; else actual_digest="$(sha256sum "$artifact_name")"; fi \
&& test "${actual_digest%% *}" = "$artifact_sha256" \
&& actual_bytes="$(wc -c < "$artifact_name")" \
&& test "$actual_bytes" -eq "$artifact_bytes" \
&& chmod +x "$artifact_name" \
&& ./"$artifact_name" --sha256 "$artifact_sha256" --bytes "$artifact_bytes" --prefix ~/.local \
&& export PATH="$HOME/.local/bin:$PATH"
```

### macOS Apple silicon
```bash
SEAL_VERSION=v0.5.3
artifact_name="seal-v0.5.3-darwin-arm64" \
&& artifact_sha256="ed290029caa6d153c735c9e212e7dd59f9cd453aaba89a9a4d2681bc7f4b0631" \
&& artifact_bytes=6451940 \
&& sums_name="SHA256SUMS" \
&& sums_sha256="1617beb751f1a1569ab5fa338ed82abb9b8aee65370b409b14be7fe926c4c479" \
&& curl -fsSLO "https://github.com/velvetmonkey/seal/releases/download/$SEAL_VERSION/$sums_name" \
&& curl -fsSLO "https://github.com/velvetmonkey/seal/releases/download/$SEAL_VERSION/$artifact_name" \
&& if command -v shasum >/dev/null 2>&1; then sums_actual="$(shasum -a 256 "$sums_name")"; else sums_actual="$(sha256sum "$sums_name")"; fi \
&& test "${sums_actual%% *}" = "$sums_sha256" \
&& expected_record="$(awk -v name="$artifact_name" '$3 == name { print $1, $2, $3 }' "$sums_name")" \
&& test "$expected_record" = "$artifact_sha256 $artifact_bytes $artifact_name" \
&& if command -v shasum >/dev/null 2>&1; then actual_digest="$(shasum -a 256 "$artifact_name")"; else actual_digest="$(sha256sum "$artifact_name")"; fi \
&& test "${actual_digest%% *}" = "$artifact_sha256" \
&& actual_bytes="$(wc -c < "$artifact_name")" \
&& test "$actual_bytes" -eq "$artifact_bytes" \
&& chmod +x "$artifact_name" \
&& ./"$artifact_name" --sha256 "$artifact_sha256" --bytes "$artifact_bytes" --prefix ~/.local \
&& export PATH="$HOME/.local/bin:$PATH"
```

### macOS Intel
```bash
SEAL_VERSION=v0.5.3
artifact_name="seal-v0.5.3-darwin-x64" \
&& artifact_sha256="6591a3f418b964d9eb7771e329ce097500ee9e4c1633f20a17b3e738cceb5666" \
&& artifact_bytes=6426927 \
&& sums_name="SHA256SUMS" \
&& sums_sha256="1617beb751f1a1569ab5fa338ed82abb9b8aee65370b409b14be7fe926c4c479" \
&& curl -fsSLO "https://github.com/velvetmonkey/seal/releases/download/$SEAL_VERSION/$sums_name" \
&& curl -fsSLO "https://github.com/velvetmonkey/seal/releases/download/$SEAL_VERSION/$artifact_name" \
&& if command -v shasum >/dev/null 2>&1; then sums_actual="$(shasum -a 256 "$sums_name")"; else sums_actual="$(sha256sum "$sums_name")"; fi \
&& test "${sums_actual%% *}" = "$sums_sha256" \
&& expected_record="$(awk -v name="$artifact_name" '$3 == name { print $1, $2, $3 }' "$sums_name")" \
&& test "$expected_record" = "$artifact_sha256 $artifact_bytes $artifact_name" \
&& if command -v shasum >/dev/null 2>&1; then actual_digest="$(shasum -a 256 "$artifact_name")"; else actual_digest="$(sha256sum "$artifact_name")"; fi \
&& test "${actual_digest%% *}" = "$artifact_sha256" \
&& actual_bytes="$(wc -c < "$artifact_name")" \
&& test "$actual_bytes" -eq "$artifact_bytes" \
&& chmod +x "$artifact_name" \
&& ./"$artifact_name" --sha256 "$artifact_sha256" --bytes "$artifact_bytes" --prefix ~/.local \
&& export PATH="$HOME/.local/bin:$PATH"
```
Success prints `installed seal 0.5.3 linux-x64` and the store, command,
and tree lines. Path prefixes on `store:` and `command:` differ per machine.
The tree hash of the published v0.5.3 asset is pinned here:

**Seal installed-tree pin role:** `published-asset`
```output
installed seal 0.5.3 linux-x64
store: /home/you/.local/lib/seal/store/6da03dc7d8f4d40a30033623a2e27fb7608d3fe17ce7ab420e8b940f3e8ff2ba
command: /home/you/.local/bin/seal
tree: 6da03dc7d8f4d40a30033623a2e27fb7608d3fe17ce7ab420e8b940f3e8ff2ba
Next:
  export PATH=/home/you/.local/bin:$PATH
  demo_dir="$(mktemp -d)" && demo_dir="$(cd "$demo_dir" && pwd -P)" && printf 'y\n' | seal demo --dir "$demo_dir" && printf 'Demo directory: %s\n' "$demo_dir"
```
Add `~/.local/bin` to PATH:
```bash
$ export PATH="$HOME/.local/bin:$PATH"
```
Add this export to `~/.bashrc`, `~/.zshrc`, or `~/.profile` so a new terminal finds `seal`.

Further distribution detail, including what each payload contains, is in
[DISTRIBUTION.md](../assurance/distribution.md).
### Optional checker asset download
The installed tree includes a working checker; this command downloads the published checker file for inspection.
```bash
SEAL_VERSION=v0.5.3
checker_name="seal-receipt-v2.mjs" \
&& checker_sha256="12e7080ebb293486576bacbd45de177762ea1fafe9d02cd6f78f46cba9adc7d9" \
&& checker_bytes=11935 \
&& sums_name="SHA256SUMS" \
&& sums_sha256="1617beb751f1a1569ab5fa338ed82abb9b8aee65370b409b14be7fe926c4c479" \
&& curl -fsSLO "https://github.com/velvetmonkey/seal/releases/download/$SEAL_VERSION/$sums_name" \
&& curl -fsSLO "https://github.com/velvetmonkey/seal/releases/download/$SEAL_VERSION/$checker_name" \
&& if command -v shasum >/dev/null 2>&1; then sums_actual="$(shasum -a 256 "$sums_name")"; else sums_actual="$(sha256sum "$sums_name")"; fi \
&& test "${sums_actual%% *}" = "$sums_sha256" \
&& checker_record="$(awk -v name="$checker_name" '$3 == name { print $1, $2, $3 }' "$sums_name")" \
&& test "$checker_record" = "$checker_sha256 $checker_bytes $checker_name" \
&& if command -v shasum >/dev/null 2>&1; then checker_actual="$(shasum -a 256 "$checker_name")"; else checker_actual="$(sha256sum "$checker_name")"; fi \
&& test "${checker_actual%% *}" = "$checker_sha256" \
&& checker_count="$(wc -c < "$checker_name")" \
&& test "$checker_count" -eq "$checker_bytes"
```
The downloaded checker is only checked against `SHA256SUMS`; from a source checkout, run
`node checker/seal-receipt-v2.mjs docs/reference/receipt-operations-v1/receipt-block.json`.
<!-- end generated release docs -->

## Source-build tree pin
A build of this checkout (not the published release asset) writes
`dist/seal-v<identity>-linux-x64`. That tree digest is a different claim
from the published-asset pin above:

**Seal installed-tree pin role:** `fresh-build`
```text
tree: 6da03dc7d8f4d40a30033623a2e27fb7608d3fe17ce7ab420e8b940f3e8ff2ba
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

## Start Protect in a project

Follow [Protect a real tool set in the README](../../README.md#protect-a-real-tool-set)
to install Claude Code, create `seal-protect-demo`, and run `seal protect`.
If Claude Code is already running in that project, exit that session first.
For your first sign-in, run this in the terminal and follow the login prompts:

```bash
claude auth login
```

Start Claude Code from the `seal-protect-demo` project directory:

```bash
claude
```

On the first run, Claude Code may show a theme picker before the session starts.

MCP is the protocol Claude Code uses to connect to tool servers. If Claude Code
asks you to approve the project's MCP server, accept it. Keep Claude Code running
and open a second terminal in `seal-protect-demo`, then check the route:

```bash
PATH="$HOME/.local/bin:$PATH" seal status
```

Look for `LEASE ACTIVE` on the sealed `db` route before using its tools. If it still
says `PENDING RESTART`, follow the [protection state guide](../guide/what-is-protected-right-now.md#pending-restart).

Previous: [Start](README.md).
Up: [Start](README.md).
Next: [Evaluator walk](evaluator-walk.md).
