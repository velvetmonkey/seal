# Distribution (roadmap 3D)

Seal v0.2.0-rc.2 ships **one** installable artifact, for **Linux x86-64 only**.
macOS, Windows, Linux ARM and other platforms are not supported in this
release.

## The artifact

`scripts/build-dist.cjs` writes `dist/seal-v<identity>-linux-x64`, where the
identity is the bare `<version>` only when HEAD is exactly tag `v<version>` and
otherwise `<version>-dev.g<commit>` — see
[VERSION-IDENTITY.md](VERSION-IDENTITY.md). That file
is the installer and the payload. The published pin lives in `SHA256SUMS`
at the repository root (digest and byte length). That file is a pin, not
a second product. `test/dist-pin.test.cjs` rebuilds the artifact and
fails if `SHA256SUMS` does not match, so a hand-copied hash cannot rot
the next time a payload file is added.

There is no signing-key ceremony. The operator supplies `--sha256` (and
optionally `--bytes`) from a source they already trust. Without that pin
the installer refuses.

## Install

```sh
./seal-v0.2.0-rc.2-linux-x64 --sha256 aa73744e9f32d0a190938ca90bbb246883e16acfed18855e66aba30d711609af --bytes 6143644 --prefix ~/.local
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
the demo and protected paths), the approval contract, and
`checker/seal-receipt-check.mjs`.
It also includes the pinned vendored kernel and the fail-closed Node adapter
that invokes it. The authorization rule is PROVED. The state machine is
TESTED. The adapter uses an in-worker generated Ed25519 key to sign the config
accepted by `seal_init`; this is demo-grade self-authorization, not a
production config-signing trust root. Corrupt or unpinned WASM refuses and has
no JavaScript authorization fallback. Each kernel worker invocation has a
5000ms product-enforced deadline and is killed if it exceeds that deadline; the
guarded call refuses as `kernel_execution_refused` and does not fall back to
Node authorization.
The demo prints the absolute path of that packaged checker. The launcher
never searches `PATH` for another `seal`. The checker imports no Seal module
at check time, but copies the receipt canonicalisation rule and uses the same
Node crypto platform as the producer. It detects receipt mutation under a
trusted supplied key, not defects in those shared implementation choices.

For `seal protect`, MCP discovery has a 5000ms deadline per phase by
default. Slow but legitimate servers can use
`seal protect --timeout-ms MILLISECONDS SERVER TOOL`; timeout refusals name
that flag, and the selected deadline is retained for the activation re-check.
