const assert = require("node:assert/strict");
const { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } = require("node:fs");
const { join, resolve } = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const ROOT = resolve(__dirname, "..");
const SCRIPT = join(ROOT, "scripts", "check-protected-paths.cjs");
const RANGE_SCRIPT = join(ROOT, "scripts", "resolve-ci-diff-range.cjs");
// Local evidence stays under the required scratch root. GitHub-hosted CI has
// no /home/monkey, so it supplies its own runner-managed scratch directory.
const SCRATCH_ROOT = process.env.SEAL_PINPROTECT_TEST_ROOT
  || (process.env.GITHUB_ACTIONS ? process.env.RUNNER_TEMP : "/home/monkey/scratch");

function git(root, args) {
  const result = spawnSync("git", ["-C", root, ...args], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  return result.stdout.trim();
}

function fixture() {
  const root = mkdtempSync(join(SCRATCH_ROOT, "pinprotect-path-test-"));
  git(root, ["init", "-q"]);
  git(root, ["config", "user.email", "pinprotect@example.invalid"]);
  git(root, ["config", "user.name", "Pinprotect Test"]);
  writeFileSync(join(root, "README.md"), "base\n");
  git(root, ["add", "README.md"]);
  git(root, ["commit", "-qm", "base"]);
  git(root, ["update-ref", "refs/remotes/origin/main", "HEAD"]);
  return root;
}

function run(root, base, head) {
  return runWithScript(SCRIPT, root, base, head);
}

function runWithScript(script, root, base, head) {
  return spawnSync(process.execPath, [script, "--base", base, "--head", head], {
    encoding: "utf8",
    env: { ...process.env, SEAL_PROTECTED_PATHS_ROOT: root },
  });
}

function renameCase(source, destination) {
  const root = fixture();
  mkdirSync(join(root, source, ".."), { recursive: true });
  writeFileSync(join(root, source), "rename payload\n");
  git(root, ["add", source]);
  git(root, ["commit", "-qm", "add rename source"]);
  const base = git(root, ["rev-parse", "HEAD"]);
  mkdirSync(join(root, destination, ".."), { recursive: true });
  renameSync(join(root, source), join(root, destination));
  git(root, ["add", "-A"]);
  git(root, ["commit", "-qm", "rename artifact"]);
  return { root, base, result: run(root, base, "HEAD") };
}

function resolveRange(root, eventName, event) {
  const eventPath = join(root, "github-event.json");
  writeFileSync(eventPath, JSON.stringify(event));
  return spawnSync(process.execPath, [
    RANGE_SCRIPT,
    "--event-name", eventName,
    "--event-path", eventPath,
  ], {
    encoding: "utf8",
    env: { ...process.env, SEAL_CI_RANGE_ROOT: root },
  });
}

function writeRuling(root, base, files) {
  mkdirSync(join(root, "docs"), { recursive: true });
  writeFileSync(join(root, "docs", "PROTECTED-PATH-RULINGS.json"), JSON.stringify({
    version: 1,
    rulings: [{
      base,
      author: "test",
      date: "2026-08-28",
      scope: "test ruling",
      files,
    }],
  }, null, 2) + "\n");
  git(root, ["add", "docs/PROTECTED-PATH-RULINGS.json"]);
  git(root, ["commit", "-qm", "record ruling"]);
}

function writeRulings(root, rulings) {
  mkdirSync(join(root, "docs"), { recursive: true });
  writeFileSync(join(root, "docs", "PROTECTED-PATH-RULINGS.json"), JSON.stringify({
    version: 1,
    rulings,
  }, null, 2) + "\n");
  git(root, ["add", "docs/PROTECTED-PATH-RULINGS.json"]);
  git(root, ["commit", "-qm", "update rulings"]);
}

function testRecord(base, author = "test") {
  return {
    base,
    author,
    date: "2026-08-28",
    scope: "test ruling",
    files: [{
      path: "test/fixtures/approved.json",
      blob: "0000000000000000000000000000000000000000",
    }],
  };
}

function approvedTopic(root) {
  const base = git(root, ["rev-parse", "HEAD"]);
  git(root, ["switch", "-qc", "topic"]);
  mkdirSync(join(root, ".github", "workflows"), { recursive: true });
  writeFileSync(join(root, ".github", "workflows", "ci.yml"), "name: approved\n");
  git(root, ["add", ".github/workflows/ci.yml"]);
  git(root, ["commit", "-qm", "approved protected edit"]);
  writeRuling(root, base, [{
    path: ".github/workflows/ci.yml",
    blob: git(root, ["rev-parse", "HEAD:.github/workflows/ci.yml"]),
  }]);
  return base;
}

function mergeTopic(root, base) {
  git(root, ["switch", "-qc", "main", base]);
  git(root, ["merge", "--no-ff", "topic", "-m", "merge topic"]);
}

test("protected paths fail with the changed artifact named", (t) => {
  const root = fixture();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const base = git(root, ["rev-parse", "HEAD"]);
  mkdirSync(join(root, "test", "fixtures"), { recursive: true });
  writeFileSync(join(root, "test", "fixtures", "tampered.json"), "{}\n");
  git(root, ["add", "test/fixtures/tampered.json"]);
  git(root, ["commit", "-qm", "protected tamper"]);
  const result = run(root, base, "HEAD");
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stderr, /HUMAN RULING REQUIRED/);
  assert.match(result.stderr, /test\/fixtures\/tampered\.json/);
});

test("unprotected paths pass", (t) => {
  const root = fixture();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const base = git(root, ["rev-parse", "HEAD"]);
  writeFileSync(join(root, "README.md"), "ordinary documentation edit\n");
  git(root, ["add", "README.md"]);
  git(root, ["commit", "-qm", "ordinary edit"]);
  const result = run(root, base, "HEAD");
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /PROTECTED PATH REVIEW OK/);
});

test("a rename from a protected source to an unprotected destination requires a ruling", (t) => {
  const { root, result } = renameCase("test/fixtures/source.txt", "ordinary-renamed.txt");
  t.after(() => rmSync(root, { recursive: true, force: true }));
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stderr, /HUMAN RULING REQUIRED/);
  assert.match(result.stderr, /test\/fixtures\/source\.txt/);
});

test("a rename from an unprotected source to a protected destination requires a ruling", (t) => {
  const { root, result } = renameCase("ordinary-source.txt", "test/fixtures/destination.txt");
  t.after(() => rmSync(root, { recursive: true, force: true }));
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stderr, /HUMAN RULING REQUIRED/);
  assert.match(result.stderr, /test\/fixtures\/destination\.txt/);
});

test("a rename between two protected paths requires a ruling for both sides", (t) => {
  const { root, result } = renameCase("test/fixtures/source.txt", "test/pins/destination.txt");
  t.after(() => rmSync(root, { recursive: true, force: true }));
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stderr, /test\/fixtures\/source\.txt/);
  assert.match(result.stderr, /test\/pins\/destination\.txt/);
});

test("a rename between two unprotected paths passes", (t) => {
  const { root, result } = renameCase("ordinary-source.txt", "ordinary-renamed.txt");
  t.after(() => rmSync(root, { recursive: true, force: true }));
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /PROTECTED PATH REVIEW OK/);
});

test("changing a protected-list entry fails closed and names the change", (t) => {
  const root = fixture();
  const scriptRoot = mkdtempSync(join(SCRATCH_ROOT, "pinprotect-list-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  t.after(() => rmSync(scriptRoot, { recursive: true, force: true }));
  const base = git(root, ["rev-parse", "HEAD"]);
  writeFileSync(join(root, "README.md"), "ordinary documentation edit\n");
  git(root, ["add", "README.md"]);
  git(root, ["commit", "-qm", "ordinary edit"]);
  const tamperedScript = join(scriptRoot, "check-protected-paths.cjs");
  const source = readFileSync(SCRIPT, "utf8");
  const changed = source.replace(
    'const CONTROL_DOCUMENT = "docs/assurance/installed-tree-pin-control.md";',
    'const CONTROL_DOCUMENT = "docs/control.md";',
  );
  assert.notEqual(changed, source, "tamper fixture did not change the protected list");
  writeFileSync(tamperedScript, changed);
  const result = runWithScript(tamperedScript, root, base, "HEAD");
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stderr, /PROTECTED_PATH_LIST_TAMPERED/);
  assert.match(result.stderr, /missing \[docs\/assurance\/installed-tree-pin-control\.md\]/);
  assert.match(result.stderr, /unexpected \[docs\/control\.md\]/);
});

test("the protected-path rulebook guards itself", (t) => {
  const root = fixture();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const base = git(root, ["rev-parse", "HEAD"]);
  mkdirSync(join(root, "scripts"), { recursive: true });
  writeFileSync(join(root, "scripts", "check-protected-paths.cjs"), "tampered\n");
  git(root, ["add", "scripts/check-protected-paths.cjs"]);
  git(root, ["commit", "-qm", "rulebook tamper"]);
  const result = run(root, base, "HEAD");
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stderr, /scripts\/check-protected-paths\.cjs/);
});

test("a protected path introduced only by a merge commit requires a ruling", (t) => {
  const root = fixture();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const base = git(root, ["rev-parse", "HEAD"]);
  git(root, ["switch", "-qc", "topic"]);
  writeFileSync(join(root, "topic-only.txt"), "topic\n");
  git(root, ["add", "topic-only.txt"]);
  git(root, ["commit", "-qm", "topic change"]);
  git(root, ["switch", "-qc", "main", base]);
  writeFileSync(join(root, "main-only.txt"), "main\n");
  git(root, ["add", "main-only.txt"]);
  git(root, ["commit", "-qm", "main change"]);
  git(root, ["merge", "--no-ff", "--no-commit", "topic"]);
  mkdirSync(join(root, "corpus"), { recursive: true });
  writeFileSync(join(root, "corpus", "merge-only.txt"), "merge result\n");
  git(root, ["add", "corpus/merge-only.txt"]);
  git(root, ["commit", "-qm", "merge topic with protected result"]);
  const result = run(root, base, "HEAD");
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stderr, /HUMAN RULING REQUIRED/);
  assert.match(result.stderr, /corpus\/merge-only\.txt/);
});

test("a range-and-blob ruling passes on an actual merge commit", (t) => {
  const root = fixture();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const base = approvedTopic(root);
  mergeTopic(root, base);
  const result = run(root, base, "HEAD");
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /recorded human ruling/);
});

test("a range-and-blob ruling refuses a different protected blob", (t) => {
  const root = fixture();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const base = approvedTopic(root);
  writeFileSync(join(root, ".github", "workflows", "ci.yml"), "name: unauthorised\n");
  git(root, ["add", ".github/workflows/ci.yml"]);
  git(root, ["commit", "-qm", "unauthorised protected edit"]);
  mergeTopic(root, base);
  const result = run(root, base, "HEAD");
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stderr, /\.github\/workflows\/ci\.yml/);
});

test("a range-and-blob ruling refuses a different protected file", (t) => {
  const root = fixture();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const base = approvedTopic(root);
  mkdirSync(join(root, "scripts"), { recursive: true });
  writeFileSync(join(root, "scripts", "installed-tree-pin-sites.json"), "[]\n");
  git(root, ["add", "scripts/installed-tree-pin-sites.json"]);
  git(root, ["commit", "-qm", "different protected edit"]);
  mergeTopic(root, base);
  const result = run(root, base, "HEAD");
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stderr, /scripts\/installed-tree-pin-sites\.json/);
});

test("a head that drops a base ruling is refused and names the record", (t) => {
  const root = fixture();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const initial = git(root, ["rev-parse", "HEAD"]);
  writeRulings(root, [testRecord(initial, "base-author")]);
  const base = git(root, ["rev-parse", "HEAD"]);
  writeRulings(root, []);
  writeFileSync(join(root, "README.md"), "ordinary follow-up\n");
  git(root, ["add", "README.md"]);
  git(root, ["commit", "-qm", "drop ruling"]);
  const result = run(root, base, "HEAD");
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stderr, /PROTECTED_PATH_RULING_DROPPED/);
  assert.match(result.stderr, new RegExp(`${initial}.*base-author`));
});

test("deleting the whole ruling document is refused and names every base record", (t) => {
  const root = fixture();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const initial = git(root, ["rev-parse", "HEAD"]);
  writeRulings(root, [testRecord(initial, "badges")]);
  const base = git(root, ["rev-parse", "HEAD"]);
  rmSync(join(root, "docs", "PROTECTED-PATH-RULINGS.json"));
  git(root, ["add", "-u"]);
  git(root, ["commit", "-qm", "delete ruling document"]);
  const result = run(root, base, "HEAD");
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stderr, /PROTECTED_PATH_RULING_DROPPED/);
  assert.match(result.stderr, new RegExp(`${initial}.*badges`));
});

test("the stale frontdoor3 replacement of the badges ruling is refused", (t) => {
  const root = fixture();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const initial = git(root, ["rev-parse", "HEAD"]);
  writeRulings(root, [testRecord(initial, "badges")]);
  const base = git(root, ["rev-parse", "HEAD"]);
  writeRulings(root, [testRecord("55b9689e5c6d9905e6030196b304f0c8b64677f4", "frontdoor3")]);
  const result = run(root, base, "HEAD");
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stderr, /PROTECTED_PATH_RULING_DROPPED/);
  assert.match(result.stderr, new RegExp(`${initial}.*badges`));
});

test("a head that appends a ruling and keeps the old rulings is accepted", (t) => {
  const root = fixture();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const initial = git(root, ["rev-parse", "HEAD"]);
  writeRulings(root, [testRecord(initial, "base-author")]);
  const base = git(root, ["rev-parse", "HEAD"]);
  mkdirSync(join(root, ".github", "workflows"), { recursive: true });
  writeFileSync(join(root, ".github", "workflows", "ci.yml"), "name: appended\n");
  git(root, ["add", ".github/workflows/ci.yml"]);
  git(root, ["commit", "-qm", "append protected change"]);
  writeRulings(root, [
    testRecord(initial, "base-author"),
    {
      base,
      author: "new-author",
      date: "2026-08-28",
      scope: "test appended ruling",
      files: [{
        path: ".github/workflows/ci.yml",
        blob: git(root, ["rev-parse", "HEAD:.github/workflows/ci.yml"]),
      }],
    },
  ]);
  const result = run(root, base, "HEAD");
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /PROTECTED PATH REVIEW OK/);
});

test("a protected file can be approved twice across the life of the repository", (t) => {
  const root = fixture();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const path = ".github/workflows/ci.yml";
  const initial = git(root, ["rev-parse", "HEAD"]);
  git(root, ["switch", "-qc", "topic"]);
  mkdirSync(join(root, ".github", "workflows"), { recursive: true });
  writeFileSync(join(root, path), "name: first\n");
  git(root, ["add", path]);
  git(root, ["commit", "-qm", "first protected edit"]);
  const firstBlob = git(root, ["rev-parse", `HEAD:${path}`]);
  writeRulings(root, [{
    base: initial,
    author: "first",
    date: "2026-08-28",
    scope: "test first ruling",
    files: [{ path, blob: firstBlob }],
  }]);
  const base = git(root, ["rev-parse", "HEAD"]);
  writeFileSync(join(root, path), "name: second\n");
  git(root, ["add", path]);
  git(root, ["commit", "-qm", "second protected edit"]);
  const secondBlob = git(root, ["rev-parse", `HEAD:${path}`]);
  writeRulings(root, [
    {
      base: initial,
      author: "first",
      date: "2026-08-28",
      scope: "test first ruling",
      files: [{ path, blob: firstBlob }],
    },
    {
      base,
      author: "second",
      date: "2026-08-28",
      scope: "test second ruling",
      files: [{ path, blob: secondBlob }],
    },
  ]);
  const secondResult = run(root, base, "HEAD");
  assert.equal(secondResult.status, 0, secondResult.stdout + secondResult.stderr);
  assert.match(secondResult.stdout, /recorded human ruling/);

  writeFileSync(join(root, path), "name: first\n");
  git(root, ["add", path]);
  git(root, ["commit", "-qm", "return to first protected edit"]);
  const returnResult = run(root, base, "HEAD");
  assert.equal(returnResult.status, 0, returnResult.stdout + returnResult.stderr);
  assert.match(returnResult.stdout, /recorded human ruling/);
});

test("two rulings for one path select the record whose blob is at HEAD", (t) => {
  const root = fixture();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const path = ".github/workflows/ci.yml";
  const base = git(root, ["rev-parse", "HEAD"]);
  mkdirSync(join(root, ".github", "workflows"), { recursive: true });
  writeFileSync(join(root, path), "name: first\n");
  git(root, ["add", path]);
  git(root, ["commit", "-qm", "first protected edit"]);
  const firstBlob = git(root, ["rev-parse", `HEAD:${path}`]);
  writeFileSync(join(root, path), "name: second\n");
  git(root, ["add", path]);
  git(root, ["commit", "-qm", "second protected edit"]);
  const secondBlob = git(root, ["rev-parse", `HEAD:${path}`]);
  writeRulings(root, [
    {
      base: "1".repeat(40),
      author: "first",
      date: "2026-08-28",
      scope: "test first ruling",
      files: [{ path, blob: firstBlob }],
    },
    {
      base: "2".repeat(40),
      author: "second",
      date: "2026-08-28",
      scope: "test second ruling",
      files: [{ path, blob: secondBlob }],
    },
  ]);
  const result = run(root, base, "HEAD");
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, new RegExp(`base provenance ${"2".repeat(40)}`));
});

test("two rulings for one path refuse when HEAD matches neither blob", (t) => {
  const root = fixture();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const path = ".github/workflows/ci.yml";
  const base = git(root, ["rev-parse", "HEAD"]);
  mkdirSync(join(root, ".github", "workflows"), { recursive: true });
  writeFileSync(join(root, path), "name: unapproved\n");
  git(root, ["add", path]);
  git(root, ["commit", "-qm", "unapproved protected edit"]);
  writeRulings(root, [
    {
      base: "1".repeat(40),
      author: "first",
      date: "2026-08-28",
      scope: "test first ruling",
      files: [{ path, blob: "a".repeat(40) }],
    },
    {
      base: "2".repeat(40),
      author: "second",
      date: "2026-08-28",
      scope: "test second ruling",
      files: [{ path, blob: "b".repeat(40) }],
    },
  ]);
  const result = run(root, base, "HEAD");
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stderr, /HUMAN RULING REQUIRED/);
  assert.match(result.stderr, /\.github\/workflows\/ci\.yml/);
});

test("two rulings for one path and one blob authorise without ambiguity", (t) => {
  const root = fixture();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const path = ".github/workflows/ci.yml";
  const base = git(root, ["rev-parse", "HEAD"]);
  mkdirSync(join(root, ".github", "workflows"), { recursive: true });
  writeFileSync(join(root, path), "name: approved\n");
  git(root, ["add", path]);
  git(root, ["commit", "-qm", "approved protected edit"]);
  const blob = git(root, ["rev-parse", `HEAD:${path}`]);
  writeRulings(root, [
    {
      base: "1".repeat(40),
      author: "first",
      date: "2026-08-28",
      scope: "test first ruling",
      files: [{ path, blob }],
    },
    {
      base: "2".repeat(40),
      author: "second",
      date: "2026-08-28",
      scope: "test second ruling",
      files: [{ path, blob }],
    },
  ]);
  const result = run(root, base, "HEAD");
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /recorded human ruling/);
  assert.equal(result.stderr, "");
});

test("a head with the old single-object ruling shape is accepted as one list entry", (t) => {
  const root = fixture();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const initial = git(root, ["rev-parse", "HEAD"]);
  const second = `${"a".repeat(40)}`;
  writeRulings(root, [testRecord(initial), testRecord(second, "second")]);
  const base = git(root, ["rev-parse", "HEAD"]);
  writeFileSync(join(root, "docs", "PROTECTED-PATH-RULINGS.json"), JSON.stringify({
    version: 1,
    ruling: testRecord(initial),
  }, null, 2) + "\n");
  git(root, ["add", "docs/PROTECTED-PATH-RULINGS.json"]);
  git(root, ["commit", "-qm", "restore legacy shape"]);
  const result = run(root, base, "HEAD");
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stderr, /PROTECTED_PATH_RULING_DROPPED/);
  assert.match(result.stderr, new RegExp(`${second}.*second`));
});

test("an invalid merge-base ruling document is refused by name", (t) => {
  const root = fixture();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, "docs"), { recursive: true });
  writeFileSync(join(root, "docs", "PROTECTED-PATH-RULINGS.json"), "{\n");
  git(root, ["add", "docs/PROTECTED-PATH-RULINGS.json"]);
  git(root, ["commit", "-qm", "invalid base ruling document"]);
  const base = git(root, ["rev-parse", "HEAD"]);
  writeRulings(root, []);
  const result = run(root, base, "HEAD");
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stderr, /PROTECTED_PATH_RULING_BASE_UNREADABLE/);
});

test("a missing merge-base ruling document is accepted as the first migration", (t) => {
  const root = fixture();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const base = git(root, ["rev-parse", "HEAD"]);
  writeRulings(root, []);
  const result = run(root, base, "HEAD");
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /PROTECTED PATH REVIEW OK/);
});

test("deleting the superset check makes the dropped-ruling test accept the tamper", (t) => {
  const root = fixture();
  const scriptRoot = mkdtempSync(join(SCRATCH_ROOT, "pinprotect-rulinglist-tamper-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  t.after(() => rmSync(scriptRoot, { recursive: true, force: true }));
  const initial = git(root, ["rev-parse", "HEAD"]);
  writeRulings(root, [testRecord(initial, "base-author")]);
  const base = git(root, ["rev-parse", "HEAD"]);
  writeRulings(root, []);
  writeFileSync(join(root, "README.md"), "ordinary follow-up\n");
  git(root, ["add", "README.md"]);
  git(root, ["commit", "-qm", "drop ruling"]);
  const source = readFileSync(SCRIPT, "utf8");
  const changed = source.replace(
    "if (!rulingListIsIntact(resolvedMergeBase, options.head)) {",
    "if (false) {",
  );
  assert.notEqual(changed, source, "superset control tamper did not change the checker");
  const tamperedScript = join(scriptRoot, "check-protected-paths.cjs");
  writeFileSync(tamperedScript, changed);
  const result = runWithScript(tamperedScript, root, base, "HEAD");
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /PROTECTED PATH REVIEW OK/);
});

test("a range-and-blob ruling survives an unprotected commit after the ruling", (t) => {
  const root = fixture();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const base = approvedTopic(root);
  writeFileSync(join(root, "README.md"), "stale ruling remains valid\n");
  git(root, ["add", "README.md"]);
  git(root, ["commit", "-qm", "unprotected follow-up"]);
  mergeTopic(root, base);
  const result = run(root, base, "HEAD");
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

test("a range-and-blob ruling survives a rebase onto newer main when its file is unchanged", (t) => {
  const root = fixture();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const base = approvedTopic(root);
  const topic = git(root, ["rev-parse", "HEAD"]);
  git(root, ["switch", "-qc", "main", base]);
  writeFileSync(join(root, "README.md"), "newer main only\n");
  git(root, ["add", "README.md"]);
  git(root, ["commit", "-qm", "newer unrelated main change"]);
  const newerMain = git(root, ["rev-parse", "HEAD"]);
  git(root, ["switch", "topic"]);
  git(root, ["rebase", newerMain]);
  const result = run(root, "main", "HEAD");
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /recorded human ruling/);
});

test("widening a ruling allowlist fails closed", (t) => {
  const root = fixture();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const base = approvedTopic(root);
  writeRuling(root, base, [
    { path: ".github/workflows/ci.yml", blob: git(root, ["rev-parse", "HEAD:.github/workflows/ci.yml"]) },
    { path: "scripts/installed-tree-pin-sites.json", blob: "0000000000000000000000000000000000000000" },
  ]);
  mergeTopic(root, base);
  const result = run(root, base, "HEAD");
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stderr, /\.github\/workflows\/ci\.yml/);
});

test("push and pull-request events resolve the same target-branch candidate range", (t) => {
  const root = fixture();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const base = git(root, ["rev-parse", "HEAD"]);
  mkdirSync(join(root, "scripts"), { recursive: true });
  writeFileSync(join(root, "scripts", "installed-tree-pin-sites.json"), "[]\n");
  git(root, ["add", "scripts/installed-tree-pin-sites.json"]);
  git(root, ["commit", "-qm", "protected first commit"]);
  const first = git(root, ["rev-parse", "HEAD"]);
  writeFileSync(join(root, "ordinary-note.txt"), "harmless second commit\n");
  git(root, ["add", "ordinary-note.txt"]);
  git(root, ["commit", "-qm", "unprotected second commit"]);
  const head = git(root, ["rev-parse", "HEAD"]);
  const prRange = resolveRange(root, "pull_request", {
    pull_request: { base: { sha: base }, head: { sha: head } },
  });
  const pushRange = resolveRange(root, "push", {
    before: first,
    after: head,
    size: 2,
    commits: [{ id: first }, { id: head }],
    repository: { default_branch: "main" },
  });
  assert.equal(prRange.status, 0, prRange.stdout + prRange.stderr);
  assert.equal(pushRange.status, 0, pushRange.stdout + pushRange.stderr);
  assert.equal(prRange.stdout.trim(), `${base} ${head}`);
  assert.equal(pushRange.stdout.trim(), prRange.stdout.trim());
  const result = run(root, ...pushRange.stdout.trim().split(" "));
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stderr, /scripts\/installed-tree-pin-sites\.json/);
});

test("a push without a target default branch fails by name", (t) => {
  const root = fixture();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const head = git(root, ["rev-parse", "HEAD"]);
  const range = resolveRange(root, "push", {
    before: "0".repeat(40),
    after: head,
    size: 0,
    commits: [],
  });
  assert.equal(range.status, 1, range.stdout + range.stderr);
  assert.match(range.stderr, /CI_DIFF_RANGE_UNREADABLE: target default branch is missing from event payload/);
});

test("a protected artifact deleted within the candidate range still requires a ruling", (t) => {
  const root = fixture();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const base = git(root, ["rev-parse", "HEAD"]);
  mkdirSync(join(root, "test", "fixtures"), { recursive: true });
  const artifact = join(root, "test", "fixtures", "transient.json");
  writeFileSync(artifact, "{}\n");
  git(root, ["add", artifact]);
  git(root, ["commit", "-qm", "add protected artifact"]);
  rmSync(artifact);
  git(root, ["add", "-u"]);
  git(root, ["commit", "-qm", "delete protected artifact"]);
  const result = run(root, base, "HEAD");
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stderr, /test\/fixtures\/transient\.json/);
});
