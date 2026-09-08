# GitHub Actions provenance for released assets

Seal release artifacts are attested by
[`release.yml`](../../.github/workflows/release.yml). That attestation records
the release workflow's provenance for the assets it produces.

The native macOS process-start witness helper is release-produced, not independently reproduced.
For the WASM kernel, a clean rebuild from pinned source produces the recorded bytes.

To check the downloaded Linux x86-64 release, run the download-and-verify
command in the [guide](README.md) before installing.
It checks `SHA256SUMS` against the guide's pinned digest, then checks the
asset's digest and byte count against the pins and its `SHA256SUMS` record.
This establishes agreement with those published pins; it does not verify
GitHub build attestations.

The [release workflow](../../.github/workflows/release.yml) verifies downloaded
draft assets before publication.
This repository does not currently provide a `release.published` verification
workflow or a reader procedure for verifying GitHub build attestations.

Previous: [Knowing it worked](knowing-it-worked.md).
Up: [Guide](README.md).
Next: [Reference](../reference/README.md).
