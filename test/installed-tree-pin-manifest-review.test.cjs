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

const MANIFEST = "scripts/installed-tree-pin-sites.json";
const RULING_DOCUMENT = "docs/PINMANIFEST-RULINGS.json";

function changedManifest(t) {
  const root = fixture();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const base = git(root, ["rev-parse", "HEAD"]);
  writeFileSync(join(root, MANIFEST), '[{"file":"README.md"}]\n');
  git(root, ["add", MANIFEST]);
  git(root, ["commit", "-m", "change manifest"]);
  const blob = git(root, ["rev-parse", `HEAD:${MANIFEST}`]);
  return { root, base, blob };
}

function writeRuling(root, base, blob, mutate = () => {}) {
  const record = {
    version: 1,
    ruling: {
      base,
      author: "Test human",
      date: "2026-09-06",
      scope: "Synthetic approval in a disposable test repository only.",
      retires: [],
      files: [{ path: MANIFEST, blob }],
    },
  };
  mutate(record);
  mkdirSync(join(root, "docs"), { recursive: true });
  writeFileSync(join(root, RULING_DOCUMENT), JSON.stringify(record, null, 2) + "\n");
}

function commitRuling(root) {
  git(root, ["add", RULING_DOCUMENT]);
  git(root, ["commit", "-m", "record synthetic ruling"]);
}

function assertRefused(result) {
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stderr, /PINMANIFEST REVIEW REQUIRED \(INJECTED\)/);
  assert.match(result.stderr, /Human control: Ben must review/);
  assert.doesNotMatch(result.stdout, /PINMANIFEST REVIEW OK/);
}

for (const scenario of ["NO ruling", "WRONG blob", "STALE base"]) {
  test(`committed manifest change with ${scenario} still fails`, (t) => {
    const { root, base, blob } = changedManifest(t);
    if (scenario !== "NO ruling") {
      const staleBase = git(root, ["rev-parse", "HEAD"]);
      const wrongBlob = git(root, ["rev-parse", `${base}:${MANIFEST}`]);
      writeRuling(root, scenario === "STALE base" ? staleBase : base,
        scenario === "WRONG blob" ? wrongBlob : blob);
      commitRuling(root);
    }
    const result = run(root, ["--base", base, "--head", "HEAD"]);
    t.diagnostic(`${scenario}: checker exit ${result.status}\n${result.stderr}`);
    assertRefused(result);
  });
}

test("committed manifest change accepts an exact ruling from the requested head", (t) => {
  const { root, base, blob } = changedManifest(t);
  writeRuling(root, base, blob);
  commitRuling(root);
  const head = git(root, ["rev-parse", "HEAD"]);
  writeFileSync(join(root, RULING_DOCUMENT), "invalid local JSON\n");
  const result = run(root, ["--base", base, "--head", head]);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /PINMANIFEST REVIEW OK: recorded human ruling/);
});

test("uncommitted ruling cannot approve a committed manifest change", (t) => {
  const { root, base, blob } = changedManifest(t);
  writeRuling(root, base, blob);
  assertRefused(run(root, ["--base", base, "--head", "HEAD"]));
  git(root, ["add", RULING_DOCUMENT]);
  assertRefused(run(root, ["--base", base, "--head", "HEAD"]));
});

test("a ruling in a later commit cannot approve an earlier requested head", (t) => {
  const { root, base, blob } = changedManifest(t);
  const head = git(root, ["rev-parse", "HEAD"]);
  writeRuling(root, base, blob);
  commitRuling(root);
  assertRefused(run(root, ["--base", base, "--head", head]));
});

for (const [name, mutate] of [
  ["empty files", (r) => { r.ruling.files = []; }],
  ["duplicate paths", (r) => { r.ruling.files.push({ ...r.ruling.files[0] }); }],
  ["extra path", (r) => { r.ruling.files.push({ path: "README.md", blob: r.ruling.files[0].blob }); }],
  ["wrong path", (r) => { r.ruling.files[0].path = "README.md"; }],
  ["malformed blob", (r) => { r.ruling.files[0].blob = "not-a-blob"; }],
  ["missing files", (r) => { delete r.ruling.files; }],
  ["null file", (r) => { r.ruling.files = [null]; }],
]) {
  test(`manifest ruling refuses ${name}`, (t) => {
    const { root, base, blob } = changedManifest(t);
    writeRuling(root, base, blob, mutate);
    commitRuling(root);
    assertRefused(run(root, ["--base", base, "--head", "HEAD"]));
  });
}

test("manifest ruling refuses malformed committed JSON", (t) => {
  const { root, base, blob } = changedManifest(t);
  writeRuling(root, base, blob);
  writeFileSync(join(root, RULING_DOCUMENT), "not JSON\n");
  commitRuling(root);
  assertRefused(run(root, ["--base", base, "--head", "HEAD"]));
});

test("ruling binds the computed merge-base when the target branch advances", (t) => {
  const { root, base, blob } = changedManifest(t);
  writeRuling(root, base, blob);
  commitRuling(root);
  const head = git(root, ["rev-parse", "HEAD"]);
  git(root, ["checkout", "--detach", base]);
  writeFileSync(join(root, "other.txt"), "target branch change\n");
  git(root, ["add", "other.txt"]);
  git(root, ["commit", "-m", "advance target"]);
  const target = git(root, ["rev-parse", "HEAD"]);
  const result = run(root, ["--base", target, "--head", head]);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /recorded human ruling/);
  git(root, ["checkout", "--detach", head]);
  writeRuling(root, target, blob);
  commitRuling(root);
  assertRefused(run(root, ["--base", target, "--head", "HEAD"]));
});

test("worktree-only still refuses staged and unstaged edits despite a committed ruling", (t) => {
  const { root, base, blob } = changedManifest(t);
  writeRuling(root, base, blob);
  commitRuling(root);
  assert.equal(run(root, ["--worktree-only"]).status, 0);
  writeFileSync(join(root, MANIFEST), "[]\n");
  assertRefused(run(root, ["--worktree-only"]));
  git(root, ["add", MANIFEST]);
  assertRefused(run(root, ["--worktree-only"]));
});
