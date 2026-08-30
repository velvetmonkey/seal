// SPDX-License-Identifier: Apache-2.0
// Regression: a fatal manifest read must not mask later claim drift.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const GUARD = resolve(ROOT, "scripts/claims-drift.mjs"); // CLAIM-COVERAGE: docs/archive/LIMITATIONS.md#limitations; CLAIM-COVERAGE: docs/archive/TRUTH-BOX.md#truth-box; CLAIM-COVERAGE: docs/assurance/index.html#index-drift
const README = resolve(ROOT, "README.md");
const TRUTH_BOX = resolve(ROOT, "docs/archive/TRUTH-BOX.md");
const INDEX = resolve(ROOT, "docs/assurance/index.html");
const COVERED_CLAIM_FILES = [
  "docs/archive/LIMITATIONS.md", // CLAIM-COVERAGE: docs/archive/LIMITATIONS.md#limitations-list
  "docs/archive/TRUTH-BOX.md", // CLAIM-COVERAGE: docs/archive/TRUTH-BOX.md#truth-box-list
  "docs/assurance/index.html", // CLAIM-COVERAGE: docs/assurance/index.html#index-list
];
const DRIFT_FILE = readFileSync(README, "utf8").includes("<!-- claims:begin -->")
  ? README
  : resolve(ROOT, "docs/assurance/index.html");
const UNREADABLE = resolve(ROOT, "docs/.claims-drift-unreadable");

test("fatal manifest read first still reports later drift", () => {
  const guard = readFileSync(GUARD, "utf8");
  for (const file of COVERED_CLAIM_FILES) assert.ok(guard.includes(file), `claims-drift guard must name ${file}`);
  const readme = readFileSync(DRIFT_FILE, "utf8");
  const rewritten = guard.replace(
    "const CLAIM_MANIFEST = [\n",
    'const CLAIM_MANIFEST = [\n  ["docs/.claims-drift-unreadable", "combined-test sentinel"],\n',
  );
  assert.notEqual(rewritten, guard, "test entry must be first in CLAIM_MANIFEST");
  const [, begin, end] = guard.match(/begin: "([^"]+)", end: "([^"]+)"/) ?? [];
  const start = readme.indexOf(begin);
  const finish = readme.indexOf(end, start);
  assert.ok(start !== -1 && finish !== -1, "a guarded mirror must contain the first guarded block");
  const drifted = `${readme.slice(0, finish)}\ncombined-test tampered sentence${readme.slice(finish)}`;

  mkdirSync(UNREADABLE);
  writeFileSync(GUARD, rewritten);
  writeFileSync(DRIFT_FILE, drifted);
  try {
    const run = spawnSync(process.execPath, [GUARD], { cwd: ROOT, encoding: "utf8" });
    const output = `${run.stdout}${run.stderr}`;
    assert.equal(run.status, 2, output);
    assert.ok(output.includes("ERROR  claim manifest entry docs/.claims-drift-unreadable"), output);
    assert.match(output, /CLAIMS DRIFT/);
  } finally {
    writeFileSync(GUARD, guard);
    writeFileSync(DRIFT_FILE, readme);
    rmSync(UNREADABLE, { recursive: true, force: true });
  }
});

test("an empty claims-drift block population is a refusal", () => {
  const guard = readFileSync(GUARD, "utf8");
  const empty = guard.replace(
    /const BLOCKS = \[[\s\S]*?\n\];/,
    "const BLOCKS = [];",
  );
  assert.notEqual(empty, guard, "test must replace the block population");
  writeFileSync(GUARD, empty);
  try {
    const run = spawnSync(process.execPath, [GUARD], { cwd: ROOT, encoding: "utf8" });
    assert.equal(run.status, 1, `${run.stdout}${run.stderr}`);
    assert.match(run.stderr, /claims-drift block population is empty/);
  } finally {
    writeFileSync(GUARD, guard);
  }
});

test("the truth-box guard reads the mirrored fact instead of its assertion sentence", () => {
  const truthBox = readFileSync(TRUTH_BOX, "utf8");
  const index = readFileSync(INDEX, "utf8");
  const withoutAssertion = truthBox.replace(
    "non-claim. index.html mirrors these three lines verbatim between the same",
    "non-claim.",
  );
  const driftedFact = index.replace(
    "Runtime profile: `compatible`",
    "Runtime profile: `drifted`",
  );
  assert.notEqual(withoutAssertion, truthBox, "test must remove the assertion sentence");
  assert.notEqual(driftedFact, index, "test must change the mirrored fact");

  writeFileSync(TRUTH_BOX, withoutAssertion);
  try {
    const sentenceMissing = spawnSync(process.execPath, [GUARD], { cwd: ROOT, encoding: "utf8" });
    assert.equal(sentenceMissing.status, 0, `${sentenceMissing.stdout}${sentenceMissing.stderr}`);
  } finally {
    writeFileSync(TRUTH_BOX, truthBox);
  }

  writeFileSync(INDEX, driftedFact);
  try {
    const factWrong = spawnSync(process.execPath, [GUARD], { cwd: ROOT, encoding: "utf8" });
    const output = `${factWrong.stdout}${factWrong.stderr}`;
    assert.equal(factWrong.status, 1, output);
    assert.match(output, /docs\/assurance\/index\.html diverges from docs\/archive\/TRUTH-BOX\.md/);
  } finally {
    writeFileSync(INDEX, index);
  }
});
