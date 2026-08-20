import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const VERSION = readFileSync(resolve(ROOT, "VERSION"), "utf8").trim();
const COMMON_SCOPE_LINES = [
  "> The state machine is TESTED.",
  `> For the truth about what you installed, read [docs/RELEASE-NOTES-v${VERSION}.md](RELEASE-NOTES-v${VERSION}.md) and the [README](../README.md).`,
];
const FAMILY_PRODUCT_SCOPE_BLOCK = [
  "> Scope: This document describes the Seal family product, not the Node CLI shipped by this repository.",
  ...COMMON_SCOPE_LINES,
].join("\n");
const PRODUCT_THEN_FAMILY_SCOPE_BLOCK = [
  "> Scope: This document describes the Node CLI shipped by this repository first, then the Seal family assurance lineage.",
  ...COMMON_SCOPE_LINES,
].join("\n");
const POSITION_PAPER_SCOPE_BLOCK = [
  "> Scope: This document argues a Seal family product position accepted on 2026-07-25; it does not describe the Node CLI shipped by this repository.",
  ...COMMON_SCOPE_LINES,
].join("\n");
const FAMILY_PRODUCT_FILES = [
  "AUTHORIZATION-MESH.md",
  "CLAIMS-MATRIX.md",
  "LIMITATIONS.md",
  "TRUTH-BOX.md",
  "WHY-DIFFERENT.md",
];

test("each scoped document carries its exact scope signpost", () => {
  const expectedBlocks = new Map([
    ...FAMILY_PRODUCT_FILES.map((name) => [name, FAMILY_PRODUCT_SCOPE_BLOCK]), // CLAIM-COVERAGE: docs/AUTHORIZATION-MESH.md; CLAIM-COVERAGE: docs/CLAIMS-MATRIX.md
    ["ARCHITECTURE.md", PRODUCT_THEN_FAMILY_SCOPE_BLOCK], // CLAIM-COVERAGE: docs/ARCHITECTURE.md
    ["WHAT-SEAL-IS.md", POSITION_PAPER_SCOPE_BLOCK], // CLAIM-COVERAGE: docs/WHAT-SEAL-IS.md
  ]);

  for (const [name, expectedBlock] of expectedBlocks) {
    const text = readFileSync(resolve(ROOT, "docs", name), "utf8");
    assert.equal(text.startsWith(`${expectedBlock}\n\n`), true, `${name} is missing its scope block at the top`);
    assert.equal(text.includes("The authorization rule is PROVED."), false, `${name} contains cut claim: The authorization rule is PROVED.`);
  }
});
