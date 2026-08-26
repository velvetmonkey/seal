# Link-check population cross-check limits

Seal uses a family-fixture link guard that clones six sibling repositories
under the checkout's `.family/` directory. Because the checker recursively
walks the checkout root, the occurrence counts in its summary include Markdown
links in those clones. Those counts are diagnostic output, not a population
assertion: legitimate source edits may add or remove repeated occurrences
without changing the set of targets that must be checked.

`test/linkcheck.test.mjs` compares the targets reported by `scripts/linkcheck.mjs`
with targets reconstructed from repository sources. This is a **separate-source
cross-check**, not a separately implemented population oracle.

The two routes overlap in these bug classes: recursive file enumeration,
Markdown/HTML source filtering, JSON/YAML data filtering, JSON string traversal,
path-string recognition, URL skipping, and HTML attribute extraction. A defect in
one of those shared rules can hide a target from both routes. The check therefore
measures agreement between the product extractor and this overlapping
reconstruction; it does not establish complete target population coverage.

It still catches some product-only omissions, including a target dropped after
extraction and before `check()`. It also requires the checker to finish and report
zero broken targets. Broader assurance requires a source with a genuinely
distinct file list and extraction model.
