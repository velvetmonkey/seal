# Distribution (roadmap 3D)

Seal v0.2.0-rc.2 supports Linux x86-64 and macOS x64/arm64. Windows, Linux ARM
and other platforms are not supported in this release.
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
asset attached to the same release, then supply that asset's `--sha256` (and
optionally `--bytes`) values. Without that pin the installer refuses.

## Install

```bash
$ read -r SEAL_SHA256 SEAL_BYTES SEAL_ARTIFACT < SHA256SUMS
$ chmod +x "$SEAL_ARTIFACT"
$ "./$SEAL_ARTIFACT" --sha256 "$SEAL_SHA256" --bytes "$SEAL_BYTES" --prefix ~/.local
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
5000ms product-enforced deadline and is killed if it exceeds that deadline; the
guarded call refuses as `kernel_execution_refused` and does not fall back to
Node authorization.
The published release payload includes `checker/seal-receipt-check.mjs`; the
release has no separate checker asset.
A source build of this checkout excludes that file from its payload. The
launcher never searches `PATH` for another `seal`.
The checker imports no Seal module at check time, but copies the receipt
canonicalisation rule and uses the same Node crypto platform as the
producer. It detects mutation of the receipt's canonical parsed value
under a trusted supplied key; semantically irrelevant JSON formatting
differences are not distinguished. It does not detect defects in those
shared implementation choices.

For `seal protect`, MCP discovery has a 5000ms deadline per phase by
default. Slow but legitimate servers can use
`seal protect --timeout-ms MILLISECONDS SERVER TOOL`; timeout refusals name
that flag, and the selected deadline is retained for the activation re-check.
