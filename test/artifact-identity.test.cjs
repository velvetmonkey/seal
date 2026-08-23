// SPDX-License-Identifier: Apache-2.0
// The bare-version refusal, and the rule it enforces.
//
// VERSION names the next intended release. It cannot also identify a build:
// while v$VERSION is unpublished, every commit on main would otherwise wear
// the name of bytes nobody has released. The product identity splits those
// two jobs, and this check refuses a build that takes the release's name
// without being the release.
//
// This is separate from the collision gate (test/version-identity-gate.test.cjs).
// That gate asks origin whether v$VERSION already identifies a different
// commit. These tests run with no remote at all: the refusal must fire on a
// version that has never been released.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const ROOT = path.join(__dirname, "..");
const SCRIPTS = ["product-identity.cjs", "check-artifact-identity.cjs"];
const FIXTURE_VERSION = "0.2.0-rc.1";

function run(command, args, cwd) {
  // Keep a no-history fixture from inheriting a repository found above the
  // fixture directory (for example when the system temporary directory is
  // inside another checkout).
  return spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, GIT_CEILING_DIRECTORIES: path.dirname(cwd) },
  });
}

function git(cwd, ...args) {
  const result = run("git", args, cwd);
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

// A repository holding only the two scripts under test, its own VERSION and a
// dist directory. No origin: these questions must be answerable offline.
function fixture() {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "seal-artifact-identity-"));
  fs.mkdirSync(path.join(repo, "scripts"));
  fs.mkdirSync(path.join(repo, "dist"));
  for (const name of SCRIPTS) {
    fs.copyFileSync(path.join(ROOT, "scripts", name), path.join(repo, "scripts", name));
  }
  fs.writeFileSync(path.join(repo, "VERSION"), `${FIXTURE_VERSION}\n`);
  git(repo, "init");
  git(repo, "config", "user.name", "Seal tests");
  git(repo, "config", "user.email", "seal-tests@example.invalid");
  git(repo, "add", "VERSION", "scripts");
  git(repo, "commit", "-m", "release commit");
  const released = git(repo, "rev-parse", "HEAD");
  git(repo, "tag", `v${FIXTURE_VERSION}`);
  return { repo, released };
}

function commitPastTheTag(repo) {
  fs.writeFileSync(path.join(repo, "NOTES"), "one commit past the tag\n");
  git(repo, "add", "NOTES");
  git(repo, "commit", "-m", "past the tag");
  return git(repo, "rev-parse", "HEAD");
}

function identity(repo, ...args) {
  return run(process.execPath, [path.join(repo, "scripts", "product-identity.cjs"), ...args], repo);
}

function check(repo) {
  return run(process.execPath, [path.join(repo, "scripts", "check-artifact-identity.cjs")], repo);
}

function writeArtifact(repo, name) {
  fs.writeFileSync(path.join(repo, "dist", name), "not a real artifact\n");
}

test("at the exact tag the product identity is the release version", () => {
  const { repo } = fixture();
  const result = identity(repo);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), `seal ${FIXTURE_VERSION}`);
  assert.equal(JSON.parse(identity(repo, "--json").stdout).kind, "release");
});

test("one commit past the tag the product identity names that commit", () => {
  const { repo } = fixture();
  const head = commitPastTheTag(repo);
  const result = identity(repo);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), `seal ${FIXTURE_VERSION}-dev.g${head.slice(0, 7)}`);
  const record = JSON.parse(identity(repo, "--json").stdout);
  assert.equal(record.kind, "development");
  assert.equal(record.commit, head);
});

test("an untagged build wearing the bare release name is refused by name", () => {
  const { repo } = fixture();
  const head = commitPastTheTag(repo);
  writeArtifact(repo, `seal-v${FIXTURE_VERSION}-linux-x64`);
  const result = check(repo);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /^REFUSE bare_release_identity: /);
  assert.match(result.stderr, new RegExp(`seal-v${FIXTURE_VERSION.replaceAll(".", "\\.")}-linux-x64 wears the released name`));
  assert.match(result.stderr, new RegExp(`must be named seal-v${FIXTURE_VERSION.replaceAll(".", "\\.")}-dev\\.g${head.slice(0, 7)}-linux-x64`));
});

test("the same bare release name built from the exact tag is allowed", () => {
  const { repo } = fixture();
  writeArtifact(repo, `seal-v${FIXTURE_VERSION}-linux-x64`);
  const result = check(repo);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, new RegExp(`product identity ${FIXTURE_VERSION.replaceAll(".", "\\.")} \\(release\\)`));
});

test("an untagged build named for its own commit is allowed", () => {
  const { repo } = fixture();
  const head = commitPastTheTag(repo);
  writeArtifact(repo, `seal-v${FIXTURE_VERSION}-dev.g${head.slice(0, 7)}-linux-x64`);
  const result = check(repo);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /\(development\)/);
});

test("a development name for some other commit is refused", () => {
  const { repo } = fixture();
  commitPastTheTag(repo);
  writeArtifact(repo, `seal-v${FIXTURE_VERSION}-dev.gdeadbee-linux-x64`);
  const result = check(repo);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /^REFUSE artifact_identity_mismatch: /);
});

test("a checksum file naming a different artifact is refused", () => {
  const { repo } = fixture();
  const head = commitPastTheTag(repo);
  const named = `seal-v${FIXTURE_VERSION}-dev.g${head.slice(0, 7)}-linux-x64`;
  writeArtifact(repo, named);
  fs.writeFileSync(path.join(repo, "dist", "SHA256SUMS"), `${"0".repeat(64)}  12  seal-v${FIXTURE_VERSION}-linux-x64\n`);
  const result = check(repo);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /^REFUSE checksum_identity_mismatch: /);
});

test("an empty distribution directory is a refusal, not a pass", () => {
  const { repo } = fixture();
  const result = check(repo);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /^REFUSE no_named_artifact: /);
});

test("a tree with no git history still refuses the bare release name", () => {
  const { repo } = fixture();
  commitPastTheTag(repo);
  fs.rmSync(path.join(repo, ".git"), { recursive: true, force: true });
  const record = JSON.parse(identity(repo, "--json").stdout);
  assert.equal(record.kind, "unknown");
  assert.equal(record.identity, `${FIXTURE_VERSION}-dev.gunknown`);
  writeArtifact(repo, `seal-v${FIXTURE_VERSION}-linux-x64`);
  const result = check(repo);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /^REFUSE bare_release_identity: /);
});

test("the built artifact of this repository carries this repository's identity", () => {
  const { productIdentity, artifactName } = require("../scripts/product-identity.cjs");
  const record = productIdentity({ root: ROOT });
  const head = run("git", ["-C", ROOT, "rev-parse", "HEAD"], ROOT).stdout.trim();
  assert.equal(record.commit, head);
  if (record.kind === "release") assert.equal(record.identity, record.version);
  else assert.equal(record.identity, `${record.version}-dev.g${head.slice(0, 7)}`);

  const out = fs.mkdtempSync(path.join(os.tmpdir(), "seal-artifact-identity-build-"));
  const built = run(process.execPath, [path.join(ROOT, "scripts", "build-dist.cjs"), "--out", out], ROOT);
  assert.equal(built.status, 0, built.stderr);
  assert.ok(fs.existsSync(path.join(out, artifactName(record.identity))), built.stdout);
  const checked = run(process.execPath, [path.join(ROOT, "scripts", "check-artifact-identity.cjs"), "--dist", out], ROOT);
  assert.equal(checked.status, 0, checked.stderr);
});
