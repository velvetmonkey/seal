// SPDX-License-Identifier: Apache-2.0
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const ROOT = path.join(__dirname, "..");
const GATE = fs.readFileSync(path.join(ROOT, "scripts", "check-version-identity.cjs"), "utf8");

function run(command, args, cwd) {
  return spawnSync(command, args, { cwd, encoding: "utf8" });
}

function git(cwd, ...args) {
  const result = run("git", args, cwd);
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function writeVersion(repo, version) {
  fs.writeFileSync(path.join(repo, "VERSION"), `${version}\n`);
}

function fixture() {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "seal-version-gate-"));
  const remote = path.join(scratch, "origin.git");
  const repo = path.join(scratch, "repo");
  fs.mkdirSync(repo);
  git(scratch, "init", "--bare", remote);
  git(repo, "init");
  git(repo, "config", "user.name", "Seal tests");
  git(repo, "config", "user.email", "seal-tests@example.invalid");
  git(repo, "remote", "add", "origin", remote);
  fs.mkdirSync(path.join(repo, "scripts"));
  fs.writeFileSync(path.join(repo, "scripts", "check-version-identity.cjs"), GATE, { mode: 0o755 });

  writeVersion(repo, "0.2.0-rc.1");
  git(repo, "add", "VERSION");
  git(repo, "commit", "-m", "released version");
  const released = git(repo, "rev-parse", "HEAD");
  git(repo, "tag", "v0.2.0-rc.1");

  writeVersion(repo, "0.2.0-rc.2");
  git(repo, "add", "VERSION");
  git(repo, "commit", "-m", "next version");
  const next = git(repo, "rev-parse", "HEAD");
  git(repo, "branch", "-M", "main");
  git(repo, "push", "origin", "main", "--tags");
  return { remote, repo, released, next };
}

function gate(repo) {
  return run(process.execPath, [path.join(repo, "scripts", "check-version-identity.cjs")], repo);
}

test("version identity gate rejects a collision", () => {
  const { repo } = fixture();
  writeVersion(repo, "0.2.0-rc.1");
  git(repo, "commit", "-am", "claim a released version");
  const result = gate(repo);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /version identity collision: v0\.2\.0-rc\.1/);
});

test("version identity gate judges the commit, not a dirty working tree", () => {
  const { repo } = fixture();
  writeVersion(repo, "0.2.0-rc.1");
  git(repo, "commit", "-am", "claim a released version");
  writeVersion(repo, "0.2.0-rc.2");
  assert.equal(git(repo, "status", "--porcelain", "--", "VERSION"), "M VERSION");
  const result = gate(repo);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /version identity collision: v0\.2\.0-rc\.1/);
});

test("version identity gate ignores a dirty working tree that invents a claim", () => {
  const { repo } = fixture();
  git(repo, "tag", "v0.2.0-rc.2", git(repo, "rev-parse", "HEAD~1"));
  git(repo, "push", "origin", "v0.2.0-rc.2");
  writeVersion(repo, "0.2.0-rc.1");
  assert.equal(git(repo, "status", "--porcelain", "--", "VERSION"), "M VERSION");
  const result = gate(repo);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /version identity inherited: v0\.2\.0-rc\.2 identifies/);
});

test("version identity gate refuses a claim inherited from only one merge base", () => {
  const { repo, released, next } = fixture();
  git(repo, "checkout", "-b", "topic", released);
  writeVersion(repo, "1.1.0-rc.1");
  git(repo, "commit", "-am", "claim 1.1.0-rc.1");
  const topic = git(repo, "rev-parse", "HEAD");
  git(repo, "tag", "v1.1.0-rc.1", released);
  git(repo, "push", "origin", "v1.1.0-rc.1");

  // M1 takes the topic's history but keeps main's VERSION; M2 takes main's
  // history but keeps the topic's claim. merge-base --all names both parents.
  git(repo, "checkout", "main");
  run("git", ["merge", "--no-commit", "--no-ff", topic], repo);
  writeVersion(repo, "0.2.0-rc.2");
  git(repo, "add", "VERSION");
  git(repo, "commit", "-m", "M1: merge topic, keep 0.2.0-rc.2");
  const m1 = git(repo, "rev-parse", "HEAD");

  // `next`, not `main`: main now points at M1, and merging that would make M1
  // itself the single merge base instead of leaving the two tips crossed.
  git(repo, "checkout", "topic");
  run("git", ["merge", "--no-commit", "--no-ff", next], repo);
  writeVersion(repo, "1.1.0-rc.1");
  git(repo, "add", "VERSION");
  git(repo, "commit", "-m", "M2: merge main, keep 1.1.0-rc.1");

  git(repo, "update-ref", "refs/remotes/origin/main", m1);
  const allBases = git(repo, "merge-base", "--all", "HEAD", "origin/main").split("\n");
  assert.equal(allBases.length, 2, `expected a criss-cross, got ${allBases.join(" ")}`);

  const result = gate(repo);
  assert.equal(result.status, 1, result.stdout);
  assert.match(result.stderr, /version identity collision: v1\.1\.0-rc\.1/);
});

test("version identity gate accepts an exact remote tag", () => {
  const { repo, released } = fixture();
  git(repo, "checkout", "--detach", released);
  const result = gate(repo);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /version identity exact: v0\.2\.0-rc\.1 identifies HEAD/);
});

test("version identity gate accepts an inherited published version", () => {
  const { repo, released } = fixture();
  git(repo, "tag", "v0.2.0-rc.2", released);
  git(repo, "push", "origin", "v0.2.0-rc.2");
  const result = gate(repo);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /version identity inherited: v0\.2\.0-rc\.2 identifies/);
});

test("version identity gate accepts an absent tag when other remote tags exist", () => {
  const { repo } = fixture();
  const result = gate(repo);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /version identity available: v0\.2\.0-rc\.2 has not been released/);
});

test("version identity gate accepts a remote with zero tags", () => {
  const { repo, next } = fixture();
  const emptyRemote = fs.mkdtempSync(path.join(os.tmpdir(), "seal-version-empty-origin-"));
  git(emptyRemote, "init", "--bare", ".");
  git(repo, "remote", "set-url", "origin", emptyRemote);
  git(repo, "push", "origin", `${next}:refs/heads/main`);
  const result = gate(repo);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /v0\.2\.0-rc\.2 has not been released/);
});

test("version identity gate refuses ambiguous base history", () => {
  const { repo } = fixture();
  const emptyRemote = fs.mkdtempSync(path.join(os.tmpdir(), "seal-version-empty-origin-"));
  git(emptyRemote, "init", "--bare", ".");
  git(repo, "remote", "set-url", "origin", emptyRemote);
  git(repo, "update-ref", "-d", "refs/remotes/origin/main");
  const result = gate(repo);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /base ambiguity/);
});

test("version identity gate rejects a remote tag lookup error", () => {
  const { repo } = fixture();
  git(repo, "remote", "set-url", "origin", path.join(repo, "missing-origin.git"));
  const result = gate(repo);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /fatal:/);
});
