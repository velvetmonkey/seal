import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const PUBLISHED_VERSION = readFileSync(resolve(ROOT, "README.md"), "utf8").match(/^SEAL_VERSION=v([^\s]+)$/m)?.[1]; assert.ok(PUBLISHED_VERSION, "README must declare the published release identity");
const COMMON_SCOPE_LINES = [
  "> The state machine is TESTED.",
];
const TRUTH_BOX_PROOF_COUNT_CITATION = "; for the shipped product's strict proved-property count, read the [unreleased v1.0.0-rc.1 candidate notes](../assurance/RELEASE-NOTES-v1.0.0-rc.1.md).";
function scopeBlock(scope, name, releaseNotesLabel = `docs/assurance/RELEASE-NOTES-v${PUBLISHED_VERSION}.md`, releaseVersion = PUBLISHED_VERSION) {
  const releaseNotes = name.startsWith("archive/")
    ? `../assurance/RELEASE-NOTES-v${releaseVersion}.md`
    : `RELEASE-NOTES-v${releaseVersion}.md`;
  return [
    scope,
    ...COMMON_SCOPE_LINES,
    `> For the truth about what you installed, read [${releaseNotesLabel}](${releaseNotes}) and the [README](../../README.md)${name === "archive/TRUTH-BOX.md" ? TRUTH_BOX_PROOF_COUNT_CITATION : "."}`,
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
  assert.match(readFileSync(resolve(ROOT, "docs/assurance/RELEASE-NOTES-v1.0.0-rc.1.md"), "utf8"), /The strict proved-property count for the shipped product is zero\./);
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

// The archive fact is committed evidence, checked against the row without network access.
test("archived action row does not claim maintenance or current CI", () => {
  const text = readFileSync(resolve(ROOT, "docs/archive/CLAIMS-MATRIX.md"), "utf8");
  assert.match(text, /seal-verify-action.*archived.*2026-09-27/);
  const row = text.split("\n").find(line => line.startsWith("| The `seal verify` closure"));
  assert.ok(row);
  assert.doesNotMatch(row, /maintained|runs in CI|\*\*Tested\*\*/);
  assert.match(row, /CI no longer runs/);
});

function archivedHomeViolations(lines) {
  // Re-measure archive heads with: gh api repos/velvetmonkey/NAME --jq '.archived, .default_branch' && gh api repos/velvetmonkey/NAME/commits/BRANCH --jq .sha
  // GitHub read 2026-10-16: seal-demo archived true, head e5388ebe475fcd88e10bec7ce390c7c6aeeeadd9.
  const roster = new Set(Object.keys(JSON.parse(readFileSync(resolve(ROOT, "scripts/claims-drift-family-hashes.json"), "utf8"))));
  roster.delete("seal");
  const extraArchived = new Set(["seal-host"]);
  const archived = new Map([
    ["seal-host", "d1af738b1f17966a18d7f86c51392b5cd3b8b0a1"],
    ["seal-live-demo", "0a89876379bc79063fc06afaa5b854fb2738b725"],
    ["seal-verify-action", "84e91a4bc605aa53bb9aa2e5a25aaa7e499794d5"],
    ["seal-demo", "e5388ebe475fcd88e10bec7ce390c7c6aeeeadd9"],
  ]);
  const live = new Set(["seal-check", "seal-assurance-kit", "mcp-seal-dev"]);
  const population = new Set([...roster, ...extraArchived]);
  const violations = [];
  for (const name of archived.keys()) {
    if (!roster.has(name) && !extraArchived.has(name)) violations.push(`${name}: archived name is outside the roster and extra set`);
  }
  for (const name of population) {
    const classifications = Number(archived.has(name)) + Number(live.has(name));
    if (classifications === 0) violations.push(`${name}: roster name has no classification`);
    if (classifications > 1) violations.push(`${name}: name is classified twice`);
  }
  for (const [index, line] of lines.entries()) {
    if (!line.startsWith("| ") || index < 41 || !line.endsWith(" |")) continue;
    const home = line.slice(line.lastIndexOf(" | ") + 3, -2);
    for (const name of population) {
      if (!new RegExp(`\\b${name}\\b`).test(home)) continue;
      if (!archived.has(name)) continue;
      const sha = archived.get(name);
      const qualified = home.includes(`Archived repository \`${name}\` at \`${sha}\``)
        && /seal (?:`[^`]+` )?runs\b/.test(home);
      if (!qualified) violations.push(`line ${index + 1}: ${name} Home cell is not qualified`);
    }
    const familyNames = new Set(home.match(/(?<![\w./-])(?:mcp-seal|seal)-[a-z0-9]+(?:-[a-z0-9]+)*(?![\w./-])/g) ?? []);
    for (const name of familyNames) {
      if (!population.has(name)) violations.push(`line ${index + 1}: ${name} Home name is outside the roster and extra set`);
    }
  }
  return violations;
}


test("every archived repository Home cell names its archive head and current seal run", () => {
  const lines = readFileSync(resolve(ROOT, "docs/archive/CLAIMS-MATRIX.md"), "utf8").split("\n");
  const violations = archivedHomeViolations(lines);
  assert.deepEqual(violations, []);
});

test("an unqualified seal-demo Home cell is refused as archived", () => {
  const prefix = Array(41).fill("");
  const unqualified = [...prefix, "| Probe | seal-demo |"];
  assert.deepEqual(archivedHomeViolations(unqualified), ["line 42: seal-demo Home cell is not qualified"]);
  const qualified = [...prefix, "| Probe | Archived repository `seal-demo` at `e5388ebe475fcd88e10bec7ce390c7c6aeeeadd9`; seal runs |"];
  assert.deepEqual(archivedHomeViolations(qualified), []);
});

test("a Home name outside the family roster is refused", () => {
  const lines = [...Array(41).fill(""), "| Probe | mcp-seal-aria |"];
  assert.deepEqual(archivedHomeViolations(lines), ["line 42: mcp-seal-aria Home name is outside the roster and extra set"]);
});
for (const [oldPath, currentPath] of [
  ["CLAIMS-MATRIX.md", "archive/CLAIMS-MATRIX.md"],
  ["EVALUATOR-START.md", "assurance/evaluator-start.md"],
  ["ARCHITECTURE.md", "assurance/architecture.md"],
]) test(`legacy docs/${oldPath} resolves to its current page`, () => {
  const notice = readFileSync(resolve(ROOT, "docs", oldPath), "utf8");
  assert.ok(notice.includes(`](${currentPath})`));
  assert.ok(readFileSync(resolve(ROOT, "docs", currentPath), "utf8").length);
});

const PROOF_SCOPE_LINE = "> **Proof scope:** for the Node CLI shipped by this repository, this Claim is not a proved property. The strict proved-property count for the shipped product is zero.";
const RC1_BLOCK3_CORRECTION = "Correction, 2026-10-18: BLOCK 3 was also open in this release candidate and is not in the list above. BLOCK 3: the archived truth box Claim can be read as a proved property of the shipped product, and its install link sends the reader to the v0.5.3 notes, which do not state the zero strict proved-property count.";
const V053_COUNT_CORRECTION = "Correction, 2026-10-18: the strict proved-property count for the shipped product is zero.";
const GENERATED_MARKER = "<!-- generated candidate release notes; do not edit -->";
function truthboxBlock(file) {
  const text = readFileSync(resolve(ROOT, file), "utf8");
  const start = text.indexOf("<!-- truthbox:begin -->");
  const end = text.indexOf("<!-- truthbox:end -->", start);
  assert.ok(start >= 0 && end > start, `${file} is missing the truthbox markers`);
  return text.slice(start, end);
}

test("the truth box claim block states the shipped proof scope", () => {
  for (const file of ["docs/archive/TRUTH-BOX.md", "docs/assurance/index.html"])
    assert.ok(truthboxBlock(file).includes(PROOF_SCOPE_LINE), `${file} is missing the shipped proof scope line`);
});

test("the rc.1 notes correction names BLOCK 3", () => {
  const file = "docs/assurance/RELEASE-NOTES-v1.0.0-rc.1.md";
  const text = readFileSync(resolve(ROOT, file), "utf8");
  const correction = text.indexOf(RC1_BLOCK3_CORRECTION);
  assert.ok(correction >= 0, `${file} is missing the BLOCK 3 correction`);
  assert.ok(correction > text.indexOf("These five items are open in this release candidate."), `${file} puts the BLOCK 3 correction before the five-item list`);
  assert.ok(correction < text.indexOf(GENERATED_MARKER), `${file} puts the BLOCK 3 correction after generated notes`);
});

test("the v0.5.3 notes state the zero strict proved-property count", () => {
  const file = "docs/assurance/RELEASE-NOTES-v0.5.3.md";
  const text = readFileSync(resolve(ROOT, file), "utf8");
  const correction = text.indexOf(V053_COUNT_CORRECTION);
  assert.ok(correction >= 0, `${file} is missing the zero strict proved-property count`);
  assert.ok(correction < text.indexOf(GENERATED_MARKER), `${file} puts the count after generated notes`);
});

test("seal side pages name seal-host as archived, not deployed", () => {
  for (const file of ["docs/assurance/architecture.md", "docs/assurance/current-scope.md"]) {
    const text = readFileSync(resolve(ROOT, file), "utf8");
    assert.ok(!text.includes("**enforcement** (deployed)"), `${file} still names enforcement as deployed`);
    assert.ok(!text.includes("[`seal-host`'s proof reference]"), `${file} still names the old live proof index`);
    assert.ok(text.includes("archived `seal-host` proof reference"), `${file} is missing the archived proof reference`);
    assert.ok(text.includes("d1af738b1f17966a18d7f86c51392b5cd3b8b0a1"), `${file} is missing the archive head`);
  }
});

test("root aliases resolve to their current pages", () => {
  for (const [file, target] of [
    ["EVALUATOR-START.md", "docs/assurance/evaluator-start.md"],
    ["CLAIMS-MATRIX.md", "docs/archive/CLAIMS-MATRIX.md"],
  ]) {
    const text = readFileSync(resolve(ROOT, file), "utf8");
    assert.ok(text.includes(`](${target})`), `${file} is missing the ${target} link`);
    assert.ok(readFileSync(resolve(ROOT, target), "utf8").length > 0, `${target} is empty`);
  }
});
