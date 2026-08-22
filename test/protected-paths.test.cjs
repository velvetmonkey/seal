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
  git(root, ["update-ref", "refs/remotes/origin/main", "HEAD"]);
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

function writeRuling(root, base, files) {
  mkdirSync(join(root, "docs"), { recursive: true });
  writeFileSync(join(root, "docs", "PROTECTED-PATH-RULINGS.json"), JSON.stringify({
    version: 1,
    ruling: { base, files },
  }, null, 2) + "\n");
  git(root, ["add", "docs/PROTECTED-PATH-RULINGS.json"]);
  git(root, ["commit", "-qm", "record ruling"]);
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
