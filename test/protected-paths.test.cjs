const assert = require("node:assert/strict");
const { mkdirSync, mkdtempSync, rmSync, writeFileSync } = require("node:fs");
const { join, resolve } = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const ROOT = resolve(__dirname, "..");
const SCRIPT = join(ROOT, "scripts", "check-protected-paths.cjs");
const SCRATCH_ROOT = "/home/monkey/scratch";

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
