import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const VERSION = readFileSync(resolve(ROOT, "VERSION"), "utf8").trim();
const COMMON_SCOPE_LINES = [
  "> The state machine is TESTED.",
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
  "archive/AUTHORIZATION-MESH.md",
  "archive/CLAIMS-MATRIX.md",
  "archive/LIMITATIONS.md",
  "archive/TRUTH-BOX.md",
  "archive/WHY-DIFFERENT.md",
];

test("each scoped document carries its exact scope signpost", () => {
  const expectedBlocks = new Map([
    ...FAMILY_PRODUCT_FILES.map((name) => [name, FAMILY_PRODUCT_SCOPE_BLOCK]), // CLAIM-COVERAGE: docs/archive/AUTHORIZATION-MESH.md; CLAIM-COVERAGE: docs/archive/CLAIMS-MATRIX.md
    ["assurance/architecture.md", PRODUCT_THEN_FAMILY_SCOPE_BLOCK], // CLAIM-COVERAGE: docs/assurance/architecture.md
    ["archive/WHAT-SEAL-IS.md", POSITION_PAPER_SCOPE_BLOCK], // CLAIM-COVERAGE: docs/archive/WHAT-SEAL-IS.md
  ]);

  for (const [name, expectedBlock] of expectedBlocks) {
    const text = readFileSync(resolve(ROOT, "docs", name), "utf8");
    const scopeLines = expectedBlock.split("\n");
    assert.equal(text.startsWith(`${scopeLines[0]}\n${scopeLines[1]}\n`), true, `${name} is missing its scope block at the top`);
    assert.equal(text.includes("The authorization rule is PROVED."), false, `${name} contains cut claim: The authorization rule is PROVED.`);
  }
});
