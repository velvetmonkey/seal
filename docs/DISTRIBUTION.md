# Distribution (roadmap 3D)

Seal v1.1 ships **one** installable artifact, for **Linux x86-64 only**.
macOS, Windows, Linux ARM and other platforms are not supported in this
release.

## The artifact

`scripts/build-dist.cjs` writes `dist/seal-vVERSION-linux-x64`. That file
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
./seal-v0.1.1-linux-x64 --sha256 678dc5e046dadc03fe440449296eca6856fb50d38edc298af0ed9d36723e5326 --bytes 129409 --prefix ~/.local
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
receipt components (including the receipt-sealing module, which only
the demo path invokes today — the protected path writes unsigned
receipts), the approval contract, and `checker/seal-receipt-check.mjs`.
The demo prints the absolute path of that packaged checker. The launcher
never searches `PATH` for another `seal`.

For `seal protect`, MCP discovery has a 5000ms deadline per phase by
default. Slow but legitimate servers can use
`seal protect --timeout-ms MILLISECONDS SERVER TOOL`; timeout refusals name
that flag, and the selected deadline is retained for the activation re-check.
