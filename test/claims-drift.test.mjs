// SPDX-License-Identifier: Apache-2.0
// Regression: a fatal manifest read must not mask later claim drift.
import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, copyFileSync, lstatSync, mkdirSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync, spawnSync } from "node:child_process";
import tempRoot from "../scripts/temp-root.cjs";
const { testTmpdir } = tempRoot;

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const GUARD = join("scripts", "claims-drift.mjs"); // CLAIM-COVERAGE: docs/archive/LIMITATIONS.md#limitations; CLAIM-COVERAGE: docs/archive/TRUTH-BOX.md#truth-box; CLAIM-COVERAGE: docs/assurance/index.html#index-drift
const README = "README.md";
const TRUTH_BOX = "docs/archive/TRUTH-BOX.md";
const INDEX = "docs/assurance/index.html";
const COVERED_CLAIM_FILES = [
  "docs/archive/LIMITATIONS.md", // CLAIM-COVERAGE: docs/archive/LIMITATIONS.md#limitations-list
  "docs/archive/TRUTH-BOX.md", // CLAIM-COVERAGE: docs/archive/TRUTH-BOX.md#truth-box-list
  "docs/assurance/index.html", // CLAIM-COVERAGE: docs/assurance/index.html#index-list
];
const DRIFT_FILE = readFileSync(resolve(ROOT, README), "utf8").includes("<!-- claims:begin -->") ? README : INDEX;
const UNREADABLE = "docs/.claims-drift-unreadable";

// Every mutation below happens in a private copy of the tracked tree, never in
// the shared checkout. node --test runs test files concurrently, and several
// test files copy the whole checkout while they run; a write to the shared
// tree, even one restored a moment later, can be captured mid-flight by one of
// them. The copied population is derived from git, the same way
// test/authorization-status-boundaries.test.mjs derives it, so it cannot
// silently shrink when a claim surface is added.
function isolatedTree(t) {
  const root = testTmpdir(join(tmpdir(), "seal-claims-drift-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const files = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], {
    cwd: ROOT,
    encoding: "buffer",
  }).toString("utf8").split("\0").filter(Boolean);
  for (const file of files) {
    const source = resolve(ROOT, file);
    const destination = resolve(root, file);
    const stat = lstatSync(source);
    mkdirSync(dirname(destination), { recursive: true });
    if (stat.isSymbolicLink()) symlinkSync(readlinkSync(source), destination);
    else if (stat.isFile()) {
      copyFileSync(source, destination);
      chmodSync(destination, stat.mode & 0o7777);
    }
  }
  return root;
}

function runGuard(root) {
  return spawnSync(process.execPath, [resolve(root, GUARD)], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, SEAL_CLAIMS_DRIFT_ROOT: root },
  });
}

function read(root, file) {
  return readFileSync(resolve(root, file), "utf8");
}

function write(root, file, text) {
  writeFileSync(resolve(root, file), text);
}

test("fatal manifest read first still reports later drift", (t) => {
  const root = isolatedTree(t);
  const guard = read(root, GUARD);
  for (const file of COVERED_CLAIM_FILES) assert.ok(guard.includes(file), `claims-drift guard must name ${file}`);
  const readme = read(root, DRIFT_FILE);
  const rewritten = guard.replace(
    "const CLAIM_MANIFEST = [\n",
    `const CLAIM_MANIFEST = [\n  ["${UNREADABLE}", "combined-test sentinel"],\n`,
  );
  assert.notEqual(rewritten, guard, "test entry must be first in CLAIM_MANIFEST");
  const [, begin, end] = guard.match(/begin: "([^"]+)", end: "([^"]+)"/) ?? [];
  const start = readme.indexOf(begin);
  const finish = readme.indexOf(end, start);
  assert.ok(start !== -1 && finish !== -1, "a guarded mirror must contain the first guarded block");
  const drifted = `${readme.slice(0, finish)}\ncombined-test tampered sentence${readme.slice(finish)}`;

  mkdirSync(resolve(root, UNREADABLE));
  write(root, GUARD, rewritten);
  write(root, DRIFT_FILE, drifted);
  const run = runGuard(root);
  const output = `${run.stdout}${run.stderr}`;
  assert.equal(run.status, 2, output);
  assert.ok(output.includes(`ERROR  claim manifest entry ${UNREADABLE}`), output);
  assert.match(output, /CLAIMS DRIFT/);
});

test("an empty claims-drift block population is a refusal", (t) => {
  const root = isolatedTree(t);
  const guard = read(root, GUARD);
  const empty = guard.replace(
    /const BLOCKS = \[[\s\S]*?\n\];/,
    "const BLOCKS = [];",
  );
  assert.notEqual(empty, guard, "test must replace the block population");
  write(root, GUARD, empty);
  const run = runGuard(root);
  assert.equal(run.status, 1, `${run.stdout}${run.stderr}`);
  assert.match(run.stderr, /claims-drift block population is empty/);
});

test("the truth-box guard reads the mirrored fact instead of its assertion sentence", (t) => {
  const root = isolatedTree(t);
  const truthBox = read(root, TRUTH_BOX);
  const index = read(root, INDEX);
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

  write(root, TRUTH_BOX, withoutAssertion);
  const sentenceMissing = runGuard(root);
  assert.equal(sentenceMissing.status, 0, `${sentenceMissing.stdout}${sentenceMissing.stderr}`);
  write(root, TRUTH_BOX, truthBox);

  write(root, INDEX, driftedFact);
  const factWrong = runGuard(root);
  const output = `${factWrong.stdout}${factWrong.stderr}`;
  assert.equal(factWrong.status, 1, output);
  assert.match(output, /docs\/assurance\/index\.html diverges from docs\/archive\/TRUTH-BOX\.md/);
});

test("the archive count guard reads registrations in both directions", (t) => {
  const root = isolatedTree(t);
  const manifestPath = "scripts/claim-bearing-files.json";
  const manifest = JSON.parse(read(root, manifestPath));
  const archiveFiles = Object.keys(manifest.files).filter((file) => file.startsWith("docs/archive/"));
  assert.equal(archiveFiles.length, 19, "test baseline must contain nineteen registered archive files");

  const added = structuredClone(manifest);
  added.files["docs/archive/EXTRA.md"] = { allowlistReason: "count guard mutation" };
  write(root, manifestPath, `${JSON.stringify(added, null, 2)}\n`);
  const addedRun = runGuard(root);
  assert.equal(addedRun.status, 1, `${addedRun.stdout}${addedRun.stderr}`);
  assert.match(addedRun.stderr, /registers 20 archive files; expected 19/u);

  const removed = structuredClone(manifest);
  delete removed.files[archiveFiles[0]];
  write(root, manifestPath, `${JSON.stringify(removed, null, 2)}\n`);
  const removedRun = runGuard(root);
  assert.equal(removedRun.status, 1, `${removedRun.stdout}${removedRun.stderr}`);
  assert.match(removedRun.stderr, /registers 18 archive files; expected 19/u);
});

test("converted guards do not depend on their assertion sentences", (t) => {
  const root = isolatedTree(t);
  const archiveReadmePath = "docs/archive/README.md";
  const linkcheckControlPath = "docs/assurance/linkcheck-population-control.md";
  const archiveReadme = read(root, archiveReadmePath);
  const linkcheckControl = read(root, linkcheckControlPath);
  const withoutArchiveAssertion = archiveReadme.replace(
    "Seal registers nineteen archive files with claim-bearing-file-inventory.\n",
    "",
  );
  const withoutLinkcheckAssertion = linkcheckControl.replace(
    "This is a **separate-source\ncross-check**, not a separately implemented population oracle.",
    "This is not a separately implemented population oracle.",
  );
  assert.notEqual(withoutArchiveAssertion, archiveReadme, "test must remove the archive assertion");
  assert.notEqual(withoutLinkcheckAssertion, linkcheckControl, "test must remove the linkcheck assertion");

  write(root, archiveReadmePath, withoutArchiveAssertion);
  write(root, linkcheckControlPath, withoutLinkcheckAssertion);
  const run = runGuard(root);
  assert.equal(run.status, 0, `${run.stdout}${run.stderr}`);
});

test("the linkcheck separate-source guard rejects a product-logic import", (t) => {
  const root = isolatedTree(t);
  const linkcheckTestPath = "test/linkcheck.test.mjs";
  const source = read(root, linkcheckTestPath);
  const imported = `${source}\nimport { markdownDestinations } from "../scripts/linkcheck.mjs";\n`;
  write(root, linkcheckTestPath, imported);
  const run = runGuard(root);
  assert.equal(run.status, 1, `${run.stdout}${run.stderr}`);
  assert.match(run.stderr, /must execute scripts\/linkcheck\.mjs and reconstruct expected targets without importing or requiring product logic/u);
});
