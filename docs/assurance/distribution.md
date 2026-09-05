# Distribution (roadmap 3D)

Seal v0.2.1.
Seal supports install, demo, receipt checking and Protect on Linux x86-64 and macOS x64/arm64.
Windows, Linux ARM and other platforms are not supported.
It ships **one** installable artifact, for **Linux x86-64**.

## The artifact

`scripts/build-dist.cjs` writes `dist/seal-v<identity>-linux-x64`, where the
identity is the bare `<version>` only when HEAD is exactly tag `v<version>` and
otherwise `<version>-dev.g<commit>` — see
[VERSION-IDENTITY.md](version-identity.md). That file
is the installer and the payload. The published pin lives in the `SHA256SUMS`
release asset alongside the artifact (digest and byte length). The repository
root intentionally has no hand-maintained copy. `test/dist-pin.test.cjs`
refuses a root entry for an artifact that is not a published release, while
an absent or empty root file is the defined between-releases state.

There is no signing-key ceremony. Download the binary and the `SHA256SUMS`
asset attached to the same release, independently compare their bytes with the
published pins, then supply `--sha256` and `--bytes` to the installer. The
installer's self-check is additional to the shell gate below.

## Install

Copy the whole POSIX command, including its backslashes and `&&` operators.
A failed comparison skips both `chmod` and execution.

```bash
SEAL_VERSION=v0.2.1
artifact_name="seal-v0.2.1-linux-x64" \
&& artifact_sha256="4063ea160b1e8cea8f0ca0c87453484a7827bf0cbfb9ac1179888814e490b9dd" \
&& artifact_bytes=6214316 \
&& sums_name="SHA256SUMS" \
&& sums_sha256="79054c0c63d1c70ca5b1e9d0c1d5670a947f49d7abeded441ad742b392ee19c0" \
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
&& ./"$artifact_name" --sha256 "$artifact_sha256" --bytes "$artifact_bytes" --prefix ~/.local
```

On any other platform the installer prints `UNSUPPORTED PLATFORM` and
changes no files.

## After install

`prefix/bin/seal` is a launcher. It re-hashes `prefix/lib/seal/store/<tree>/`
against `prefix/lib/seal/install.json` before it executes anything from
the store. A later write that changes a stored byte is a named refusal
(`artifact_digest_mismatch`). Replacing the launcher itself is equivalent
to not running this install; that case needs an operator-pinned key, which
this release does not mint.

`--version` prints the `VERSION` file from the installed tree. It must
equal the version in the artifact name and in the install record.

The payload is the current product: `bin/seal`, the mediation and
receipt components (including the receipt-sealing module used by both
the demo and protected paths), and the approval contract.
It also includes the pinned vendored kernel and the fail-closed Node adapter
that invokes it. The state machine is
TESTED. The adapter uses an in-worker generated Ed25519 key to sign the config
accepted by `seal_init`; this is demo-grade self-authorization, not a
production config-signing trust root. Corrupt or unpinned WASM refuses and has
no JavaScript authorization fallback. Each kernel worker invocation has a
30000ms product-enforced deadline and is killed if it exceeds that deadline; the
guarded call refuses as `kernel_execution_refused` and does not fall back to
Node authorization.
The current install payload excludes `seal-receipt-v2.mjs`. Download the sibling
[`seal-receipt-v2.mjs` release asset](https://github.com/velvetmonkey/seal/releases/download/v0.2.1/seal-receipt-v2.mjs)
only to verify it against the `SHA256SUMS` asset attached to that same release.
Run `node checker/seal-receipt-v2.mjs RECEIPT` from a source checkout instead.
The launcher never searches `PATH` for another `seal`.
The checker implements receipt canonicalisation and signature checking itself
with the same Node crypto platform as the producer, but imports Seal's kernel
decision runner for decision replay. It detects mutation of the receipt's canonical parsed value
under a trusted supplied key; semantically irrelevant JSON formatting
differences are not distinguished. It does not detect defects in those
shared implementation choices.

For `seal protect`, MCP discovery has a 30000ms deadline per phase by
default. Slow but legitimate servers can use
`seal protect --timeout-ms MILLISECONDS SERVER TOOL`; timeout refusals name
that flag, and the selected deadline is retained for the activation re-check.

Previous: [Architecture](architecture.md).
Up: [Assurance](README.md).
Next: [Version identity](version-identity.md).
