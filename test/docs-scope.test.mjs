import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const PUBLISHED_VERSION = readFileSync(resolve(ROOT, "README.md"), "utf8").match(/^SEAL_VERSION=v([^\s]+)$/m)?.[1]; assert.ok(PUBLISHED_VERSION, "README must declare the published release identity");
const COMMON_SCOPE_LINES = [
  "> The state machine is TESTED.",
];
function scopeBlock(scope, name, releaseNotesLabel = `docs/assurance/RELEASE-NOTES-v${PUBLISHED_VERSION}.md`, releaseVersion = PUBLISHED_VERSION) {
  const releaseNotes = name.startsWith("archive/")
    ? `../assurance/RELEASE-NOTES-v${releaseVersion}.md`
    : `RELEASE-NOTES-v${releaseVersion}.md`;
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
  // CLAIM-COVERAGE: docs/archive/AUTHORIZATION-MESH.md#authorization-mesh; CLAIM-COVERAGE: docs/archive/CLAIMS-MATRIX.md#claims-matrix
  // CLAIM-COVERAGE: docs/assurance/architecture.md#architecture
  // CLAIM-COVERAGE: docs/archive/WHAT-SEAL-IS.md#what-seal-is
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

test("v0.4.0 standalone checker notice and both install links remain available", () => {
  // CLAIM-COVERAGE: docs/verify/README.md#v040-standalone-checker-exit-status
  const checker = readFileSync(resolve(ROOT, "docs/verify/README.md"), "utf8");
  assert.match(checker, /^## v0\.4\.0 standalone checker exit status$/m);
  for (const statement of [
    "can exit 0", "`Signature and bindings` line says `UNVERIFIED`",
    "require both exit 0", "`VALID`", "fixed on main, not in v0.4.0",
    "main exits 1", "deleted-signature and no-key cases", "`VERIFY    UNVERIFIED`",
    "neither operator authority nor event", "occurrence",
  ]) assert.ok(checker.replace(/\s+/g, " ").includes(statement.replace(/\s+/g, " ")), statement);
  for (const [page, target] of [
    ["README.md", "docs/verify/README.md"],
    ["docs/start/install.md", "../verify/README.md"],
  ]) {
    const text = readFileSync(resolve(ROOT, page), "utf8");
    assert.ok(text.includes(`[v0.4.0 standalone checker exit-status notice](${target}#v040-standalone-checker-exit-status)`), `${page} must link to the notice`);
    assert.equal(resolve(ROOT, page, "..", target), resolve(ROOT, "docs/verify/README.md"));
  }
});
