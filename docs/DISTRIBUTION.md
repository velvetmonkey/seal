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
./seal-v0.1.1-linux-x64 --sha256 3e33caaea77f159fd42929f2de8ea2dc4a45b8962bd79a790410f36140b28ba1 --bytes 117655 --prefix ~/.local
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

The payload is the current product: `bin/seal`, the spine (including
receipt sealing), the approval contract, and
`checker/seal-receipt-check.mjs`. The demo prints the absolute path of
that packaged checker. The launcher never searches `PATH` for another
`seal`.
