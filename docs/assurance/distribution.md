# Distribution (roadmap 3D)

Seal v0.4.0.
Seal supports install, demo, receipt checking and Protect on Linux x86-64 and macOS x64/arm64.
Windows, Linux ARM and other platforms are not supported.
It ships **three** installable artifacts, for **Linux x86-64**, **macOS x64**, and **macOS arm64**.

## The artifacts

`scripts/build-dist.cjs` writes one of the three installable artifacts per
run, `dist/seal-v<identity>-<platform>`, for `linux-x64` (the default) or, via
`--platform`, `darwin-x64` or `darwin-arm64`; a Darwin build also needs the
matching release runner's `--macos-helper`. The identity is the bare
`<version>` only when HEAD is exactly tag `v<version>` and otherwise
`<version>-dev.g<commit>` — see [VERSION-IDENTITY.md](version-identity.md).
Each file is the installer and the payload. The published pins live in the
`SHA256SUMS` release asset alongside the artifacts (digest and byte length). The repository
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
SEAL_VERSION=v0.3.0
artifact_name="seal-v0.3.0-linux-x64" \
&& artifact_sha256="93d1dfa722f05127025f2c087949f9356c6292f737e37e9a8b94948e10242f8b" \
&& artifact_bytes=6247615 \
&& sums_name="SHA256SUMS" \
&& sums_sha256="55f26a95c5aed564545ae35a409b7ea73ca4f1d9f7cf67311a9d79215e3563e3" \
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
The current install payload includes `seal-receipt-v2.mjs`. Download the sibling
[`seal-receipt-v2.mjs` release asset](https://github.com/velvetmonkey/seal/releases/download/v0.3.0/seal-receipt-v2.mjs)
to verify its digest against the `SHA256SUMS` asset attached to that same release.
The sibling is not standalone: it imports the kernel decision runner from the
Seal tree. Run `node checker/seal-receipt-v2.mjs RECEIPT` from the installed
store at `prefix/lib/seal/store/<tree>/`; the checker is at
`checker/seal-receipt-v2.mjs` within that tree. Its presence establishes neither
authority nor event occurrence.
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
