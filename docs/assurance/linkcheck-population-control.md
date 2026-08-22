# Link-check population cross-check limits

Seal uses a clean-tree occurrence total assertion for the repository and
sibling-family link population.

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
extraction and before `check()`, and it preserves the fixed clean-tree occurrence
totals. Broader assurance requires a source with a genuinely distinct file list
and extraction model.
