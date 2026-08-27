# GitHub Actions provenance for released assets

Seal release artifacts are attested by
[`release.yml`](../../.github/workflows/release.yml). That attestation records
the release workflow's provenance for the assets it produces.

The native macOS process-start witness helper is release-produced, not independently reproduced.
For the WASM kernel, a clean rebuild from pinned source produces the recorded bytes.

Post-publication verification of downloaded release assets is not yet covered.
It is planned as a separate `release.published` workflow; this repository does
not currently provide that workflow or a verification procedure for downloaded
release assets.

Next: [Knowing it worked](knowing-it-worked.md).
