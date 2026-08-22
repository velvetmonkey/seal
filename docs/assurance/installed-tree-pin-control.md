# Installed-Tree Pin Manifest Control

The installed-tree pin site manifest is an **INJECTED** human declaration, not an enforced proof.

`scripts/installed-tree-pin-sites.json` declares where repository documentation quotes installed-tree `store` and `tree` hashes. The generator and gate use independent discovery paths, but the manifest itself is hand-maintained repository data. Repository-local code cannot prove that a manifest edit is truthful, because an editor who can remove a site from the manifest can also remove the local warning that would have protected it.

The named human control is Ben.

When `scripts/installed-tree-pin-sites.json` changes, Ben must review the manifest diff against the same pull request's documentation diff and confirm:

- every added quoted installed-tree hash site has a manifest entry;
- every removed manifest entry corresponds to a removed quoted hash site, not a hidden or misspelled pin;
- every changed line or column reflects the actual documentation location;
- every `kind` and `role` still matches the quoted hash and its installed-tree role marker;
- the manifest edit is discussed as an **INJECTED** population declaration, not as an **ENFORCED** proof.

`scripts/check-installed-tree-pin-manifest-review.cjs` and the `installed-tree pin manifest human review` CI job are loudness mechanisms for that human review. They intentionally fail when the manifest changes so the reviewer surface is hard to miss, but they do not make the manifest harder to edit than any other repository file.
