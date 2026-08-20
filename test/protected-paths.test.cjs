const assert = require("node:assert/strict");
const { mkdirSync, mkdtempSync, rmSync, writeFileSync } = require("node:fs");
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
  return root;
}

function run(root, base, head) {
  return spawnSync(process.execPath, [SCRIPT, "--base", base, "--head", head], {
    encoding: "utf8",
    env: { ...process.env, SEAL_PROTECTED_PATHS_ROOT: root },
  });
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

test("an all-zero first push resolves from the first pushed commit parent", (t) => {
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
  const range = resolveRange(root, "push", {
    before: "0".repeat(40),
    after: head,
    size: 2,
    commits: [{ id: first }, { id: head }],
  });
  assert.equal(range.status, 0, range.stdout + range.stderr);
  assert.equal(range.stdout.trim(), `${base} ${head}`);
  const result = run(root, ...range.stdout.trim().split(" "));
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stderr, /scripts\/installed-tree-pin-sites\.json/);
});

test("an uncomputable all-zero first push fails by name", (t) => {
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
  assert.match(range.stderr, /CI_DIFF_RANGE_UNREADABLE: FIRST_PUSH_COMMITS_MISSING/);
});
