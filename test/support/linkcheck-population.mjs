// Expected family-fixture occurrence totals, not a plain-checkout population.
// test/linkcheck.test.mjs clones six sibling repositories beneath ROOT/.family;
// scripts/linkcheck.mjs recursively scans that directory, so its Markdown links
// raise the internal total from the plain checker's 256 to this fixture's 409.
// Refreshed 2026-08-25 after rc3unblockb intentionally added the two workflow
// path references `.github/workflows/release.yml` and `.github/workflows/ci.yml`;
// both targets exist on disk. Ben's 2026-08-25 ruling was to proceed with this
// refresh.
// The separate-source target cross-check
// lives in test/linkcheck.test.mjs and cannot be refreshed from
// LINKCHECK_REPORT_SCANNED_TARGETS. It is deliberately described as a cross-check;
// docs/assurance/linkcheck-population-control.md records its shared blind spots.
export default {
  familyInternalOccurrences: 409,
  familyExternalOccurrences: 50,
};
