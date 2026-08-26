# GitHub Actions provenance for released assets

Seal release artifacts are attested by
[`release.yml`](../../.github/workflows/release.yml). That attestation records
the release workflow's provenance for the assets it produces.

Post-publication verification of downloaded release assets is not yet covered.
It is planned as a separate `release.published` workflow; this repository does
not currently provide that workflow or a verification procedure for downloaded
release assets.

Next: [Knowing it worked](knowing-it-worked.md).
