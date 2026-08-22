import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const VERSION = readFileSync(resolve(ROOT, "VERSION"), "utf8").trim();
const COMMON_SCOPE_LINES = [
  "> The state machine is TESTED.",
];
function scopeBlock(scope, name, releaseNotesLabel = `docs/assurance/RELEASE-NOTES-v${VERSION}.md`) {
  const releaseNotes = name.startsWith("archive/")
    ? `../assurance/RELEASE-NOTES-v${VERSION}.md`
    : `RELEASE-NOTES-v${VERSION}.md`;
  return [
    scope,
    ...COMMON_SCOPE_LINES,
    `> For the truth about what you installed, read [${releaseNotesLabel}](${releaseNotes}) and the [README](../../README.md).`,
  ].join("\n");
}
const FAMILY_PRODUCT_SCOPE = "> Scope: This document describes the Seal family product, not the Node CLI shipped by this repository.";
const PRODUCT_THEN_FAMILY_SCOPE = "> Scope: This document describes the Node CLI shipped by this repository first, then the Seal family assurance lineage.";
const POSITION_PAPER_SCOPE = "> Scope: This document argues a Seal family product position accepted on 2026-07-25; it does not describe the Node CLI shipped by this repository.";
const FAMILY_PRODUCT_FILES = [
  "archive/AUTHORIZATION-MESH.md",
  "archive/CLAIMS-MATRIX.md",
  "archive/LIMITATIONS.md",
  "archive/TRUTH-BOX.md",
  "archive/WHY-DIFFERENT.md",
];

test("each scoped document carries its exact scope signpost", () => {
  // CLAIM-COVERAGE: docs/archive/AUTHORIZATION-MESH.md; CLAIM-COVERAGE: docs/archive/CLAIMS-MATRIX.md
  // CLAIM-COVERAGE: docs/assurance/architecture.md
  // CLAIM-COVERAGE: docs/archive/WHAT-SEAL-IS.md
  const expectedBlocks = new Map([
    ...FAMILY_PRODUCT_FILES.map((name) => [name, scopeBlock(FAMILY_PRODUCT_SCOPE, name)]),
    ["assurance/architecture.md", scopeBlock(PRODUCT_THEN_FAMILY_SCOPE, "assurance/architecture.md", "release evidence")],
    ["archive/WHAT-SEAL-IS.md", scopeBlock(POSITION_PAPER_SCOPE, "archive/WHAT-SEAL-IS.md")],
  ]);

  for (const [name, expectedBlock] of expectedBlocks) {
    const text = readFileSync(resolve(ROOT, "docs", name), "utf8");
    assert.equal(text.startsWith(`${expectedBlock}\n\n`), true, `${name} is missing its scope block at the top`);
    assert.equal(text.includes("The authorization rule is PROVED."), false, `${name} contains cut claim: The authorization rule is PROVED.`);
  }
});
