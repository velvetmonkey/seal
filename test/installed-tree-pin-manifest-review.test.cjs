const assert = require("node:assert/strict");
const { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join, resolve } = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");
const { testTmpdir } = require("../scripts/temp-root.cjs");

const ROOT = resolve(__dirname, "..");
const SCRIPT = join(ROOT, "scripts", "check-installed-tree-pin-manifest-review.cjs");

function run(root, args = []) {
  return spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd: ROOT,
    encoding: "utf8",
    env: { ...process.env, SEAL_PINMANIFEST_ROOT: root },
  });
}

function git(root, args) {
  const result = spawnSync("git", ["-C", root, ...args], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  return result.stdout.trim();
}

function fixture() {
  const root = testTmpdir(join(tmpdir(), "seal-pinmanifest-review-"));
  mkdirSync(join(root, "scripts"), { recursive: true });
  writeFileSync(join(root, "scripts", "installed-tree-pin-sites.json"), "[]\n");
  git(root, ["init"]);
  git(root, ["config", "user.email", "pinmanifest@example.invalid"]);
  git(root, ["config", "user.name", "Pin Manifest Test"]);
  git(root, ["add", "scripts/installed-tree-pin-sites.json"]);
  git(root, ["commit", "-m", "initial manifest"]);
  return root;
}

test("installed-tree manifest review is quiet when the manifest is unchanged", (t) => {
  const root = fixture();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const head = git(root, ["rev-parse", "HEAD"]);
  const result = run(root, ["--base", head, "--head", head]);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /PINMANIFEST REVIEW OK/);
});

test("installed-tree manifest review is loud when the manifest changes", (t) => {
  const root = fixture();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(
    join(root, "scripts", "installed-tree-pin-sites.json"),
    '[{ "file": "README.md", "line": 57, "column": 1, "kind": "tree", "role": "published-asset" }]\n',
  );
  const result = run(root);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stderr, /PINMANIFEST REVIEW REQUIRED \(INJECTED\)/);
  assert.match(result.stderr, /Human control: Ben must review/);
});

test("installed-tree manifest review refuses an unresolvable base without printing OK", (t) => {
  const root = fixture();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const head = git(root, ["rev-parse", "HEAD"]);
  const result = run(root, ["--base", "f18fd937fcf6b161f534fe6d2cae80fa44a91d60", "--head", head]);
  assert.notEqual(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stderr, /base ref "f18fd937fcf6b161f534fe6d2cae80fa44a91d60" is unresolvable/);
  assert.doesNotMatch(result.stdout, /PINMANIFEST REVIEW OK/);
});

test("installed-tree manifest review refuses an unresolvable head without printing OK", (t) => {
  const root = fixture();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const base = git(root, ["rev-parse", "HEAD"]);
  const result = run(root, ["--base", base, "--head", "missing-head"]);
  assert.notEqual(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stderr, /head ref "missing-head" is unresolvable/);
  assert.doesNotMatch(result.stdout, /PINMANIFEST REVIEW OK/);
});
