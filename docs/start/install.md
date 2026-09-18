<!-- generated from published release; do not edit -->
# Install Seal v0.4.0
<!-- end generated release docs -->

Seal is a local approval boundary for AI-agent tool calls. This page installs
and verifies the published release, then runs it.

## Choose your platform

- [macOS (Apple silicon)](#macos-apple-silicon)
- [macOS (Intel)](#macos-intel)
- [Linux (x86-64)](#linux-x86-64)

Windows and Linux ARM have no install command here; this build does not run
there. The separate browser product at
[seal-check](https://velvetmonkey.github.io/seal-check/) can check an
already-produced receipt from any browser on any platform; it does not run
Seal's approval gate.

## Before you start

<!-- generated from published release; do not edit -->
This checkout supports Protect on Linux x86-64 and macOS x64/arm64.
The native macOS process-start witness helper is release-produced, not independently reproduced. Windows and Linux ARM are unsupported. Node 20+ is required.
The installer refuses before changing anything on an unsupported or mismatched platform.

Claude Code's `claude` command is required only to protect a real tool; it is not required to install, verify, or run the demo below.
<!-- end generated release docs -->

## Install

Copy the whole block for your platform below. Each command downloads its
own release asset and the release's `SHA256SUMS`, checks the downloaded
bytes' digest and byte count, and only then runs the installer; a failed
comparison skips both. [How that check works](#manual-verification-explained)
is explained in "More detail" below.

### macOS (Apple silicon)

<!-- generated from published release; do not edit -->
```bash
SEAL_VERSION=v0.4.0
artifact_name="seal-v0.4.0-darwin-arm64" \
&& artifact_sha256="5ca6298f376e716a6ea0704c5fcdd4c768dc9675fcbbe707901d004b989b66b8" \
&& artifact_bytes=6335586 \
&& sums_name="SHA256SUMS" \
&& sums_sha256="0552373fc3cb7f7257b4cf491395425a1ce2f7126cc60142a961f53ff29026ce" \
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
<!-- end generated release docs -->

### macOS (Intel)

<!-- generated from published release; do not edit -->
```bash
SEAL_VERSION=v0.4.0
artifact_name="seal-v0.4.0-darwin-x64" \
&& artifact_sha256="211c6730f3519f29a5d8261fdb89f1c48ce00fb1e2b3ca49d073b153f8adea5b" \
&& artifact_bytes=6310573 \
&& sums_name="SHA256SUMS" \
&& sums_sha256="0552373fc3cb7f7257b4cf491395425a1ce2f7126cc60142a961f53ff29026ce" \
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
<!-- end generated release docs -->

### Linux (x86-64)

<!-- generated from published release; do not edit -->
```bash
SEAL_VERSION=v0.4.0
artifact_name="seal-v0.4.0-linux-x64" \
&& artifact_sha256="5b49ea26d29b608fcb4e3e370062b96e8c4a81d7fb5ce1fd30a2cbe737c69d3b" \
&& artifact_bytes=6301771 \
&& sums_name="SHA256SUMS" \
&& sums_sha256="0552373fc3cb7f7257b4cf491395425a1ce2f7126cc60142a961f53ff29026ce" \
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
<!-- end generated release docs -->

Add that export line to your shell's startup file too, or the installed
command will not be on `PATH` in a new terminal: `~/.bashrc` for bash,
`~/.zshrc` for zsh, or `~/.profile` for a POSIX login shell.

## Check installation

<!-- generated from published release; do not edit -->
The Linux x86-64 command's installer prints `installed seal 0.4.0 linux-x64` on success, followed by `store:`, `command:`, and `tree:` lines and a two-line `Next:` block; the macOS commands print their own platform name in place of `linux-x64`.
<!-- end generated release docs -->

```bash
command -v seal
seal --version
```

Confirm the first line prints the path you just installed, for example
`/home/you/.local/bin/seal`, before trusting the second line. A different,
pre-existing binary of the same name earlier on `PATH` would print its own
version and prove nothing about the install above.

## Try an approval

```bash
seal demo
```

The demo asks a real `Approve? [y/N]` question over your actual terminal
stdin; read the request it prints and answer it yourself. Approve it, and
the demo replays the identical approval a second time and shows that replay
refused. The demo prints its own scratch directory path and, when it made
that directory itself, a `Recover this run directory with:` command you can
copy to remove it afterward.

For scripted or repeated runs, give the demo its own directory and answer
non-interactively:

```bash
demo_dir="$(mktemp -d)" && printf 'y\n' | seal demo --dir "$demo_dir"
```

That form is for automation. It skips the point of the interactive run
above: watching yourself make the approval decision the receipt records.

## Protect a real tool

Protecting a real tool additionally requires Claude Code's `claude` command;
install and confirm it before continuing:

```bash
npm install --prefix "$HOME/.local" @anthropic-ai/claude-code
PATH="$HOME/.local/node_modules/.bin:$PATH"; export PATH
claude --version
```

Continue with [Choosing what to protect](../guide/choosing-what-to-protect.md).

## More detail

This section covers what the commands above check and why, the checker's
optional standalone download, the installed-tree pins those commands write,
and how to build and install this checkout from source instead of the
published release.

### Manual verification, explained

<!-- generated from published release; do not edit -->
The [v0.4.0 release](https://github.com/velvetmonkey/seal/releases/tag/v0.4.0) publishes `seal-v0.4.0-darwin-arm64`, `seal-v0.4.0-darwin-x64`, `seal-v0.4.0-linux-x64`, `seal-receipt-v2.mjs`, and `SHA256SUMS`; its tag resolves to commit [`dabac65caaa999a789be9329e02a70a5173fd7d0`](https://github.com/velvetmonkey/seal/commit/dabac65caaa999a789be9329e02a70a5173fd7d0). Its `release-manifest.json` uses schema `seal.release/v2`.

This page is the SHA256SUMS verification wall. The [README](../../README.md)
short form uses the same shell gate. In every install command on this page,
a failed checksum comparison prevents both `chmod` and execution of the
artifact. The commands use POSIX syntax for `sh`, `dash`, `bash`, and `zsh`. Copy each
whole command, including its continuation backslashes and `&&` operators;
there is no shell-option preamble. The release version is a separate assignment;
omitting it cannot remove the verification gate. Each continuation starts with
`&&`, so copying a continuation alone produces a syntax error.

The digest comparison here is *your* check, with the OS SHA-256 tool,
against the `SHA256SUMS` asset attached to the same GitHub release. That is
not the installer checking itself. The `--sha256` flag is a
second pin the installer demands and will refuse without. The optional `--bytes` flag adds a length check. Together they
answer "did I download the bytes the release named?" They do not answer
"is the publisher honest?"
<!-- end generated release docs -->

### Verify the release's receipt checker (optional)

Every installed tree already contains its own copy of the receipt checker at
`checker/seal-receipt-v2.mjs`; the demo-receipt-checker CI job proves that
copy runs correctly against the demo's own receipts. Download and verify
the standalone checker asset separately only if you want a copy outside the
installed tree, for example to check a receipt on a machine with no
install on it:

<!-- generated from published release; do not edit -->
```bash
SEAL_VERSION=v0.4.0
checker_name="seal-receipt-v2.mjs" \
&& checker_sha256="d0767c186e5a284ab1a78ea27b75d3a3d6a91101a96874b6c4936776ba4850ac" \
&& checker_bytes=10498 \
&& sums_name="SHA256SUMS" \
&& sums_sha256="0552373fc3cb7f7257b4cf491395425a1ce2f7126cc60142a961f53ff29026ce" \
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
<!-- end generated release docs -->

Further distribution detail, including what each payload contains, is in
[DISTRIBUTION.md](../assurance/distribution.md). The downloaded checker is
only checked against `SHA256SUMS`; from a source checkout, run
`node checker/seal-receipt-v2.mjs docs/reference/receipt-operations-v1/receipt-block.json`.

### Installed-tree pins

The published Linux release's installed-tree hash is pinned below, using the
definition that follows it:

<!-- generated from published release; do not edit -->
**Seal installed-tree pin role:** `published-asset`
```output
tree: 261324816077d3ab04cd55640ec79b605f2845dadb7b56d057892111601ffe32
```

The macOS artifacts have their own installed-tree digests, published
alongside this one: Apple silicon `a94265c18dbc6056eddefa629803322fb6c52630491dff60d9c0306a745325d6`, Intel `11dbb92d8eb014e59bd5bce1eb01511ddf9fead38b06be21eda907c9dfc993ab`.
<!-- end generated release docs -->

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

### Source-build tree pin

A build of this checkout (not the published release asset) writes
`dist/seal-v<identity>-linux-x64`. That tree digest is a different claim
from the published-asset pins above:

**Seal installed-tree pin role:** `fresh-build`
```text
tree: 0ec3ca43d48217652fc24294ec7dd767e2bebab14f88840b7c0371acbb0e71b0
```

That hash is the installed-tree digest of the payload `scripts/build-dist.cjs`
packs from this tree. It is not a captured command transcript. It will
change when a payload member changes; it does not change when only docs
change.

### Build and install this checkout on Linux x86-64

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

### Build and install this checkout on macOS

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

### Uninstall and recovery

Uninstalling and recovering incompatible protection state are documented
next to the commands that produce that state: see
[Remove it](../../README.md#remove-it) and
[Recover incompatible state](../../README.md#recover-incompatible-state) in
the README.

If you built and installed this checkout instead of the published release,
continue with the [Evaluator walk](evaluator-walk.md).

Previous: [Start](README.md).
Up: [Start](README.md).
Next: [Evaluator walk](evaluator-walk.md).
