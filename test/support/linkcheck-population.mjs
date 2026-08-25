// Expected clean-tree occurrence totals. Refreshed 2026-08-25 from the checker
// after rc3unblockb intentionally added the two workflow path references
// `.github/workflows/release.yml` and `.github/workflows/ci.yml`; both targets
// exist on disk. Ben's 2026-08-25 ruling was to proceed with this refresh.
// The separate-source target cross-check
// lives in test/linkcheck.test.mjs and cannot be refreshed from
// LINKCHECK_REPORT_SCANNED_TARGETS. It is deliberately described as a cross-check;
// docs/assurance/linkcheck-population-control.md records its shared blind spots.
export default {
  internalOccurrences: 409,
  externalOccurrences: 50,
};
