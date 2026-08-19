// SPDX-License-Identifier: Apache-2.0
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const ROOT = path.join(__dirname, "..");
const GATE = fs.readFileSync(path.join(ROOT, "scripts", "check-published-claim.cjs"), "utf8");
const SCRATCH = process.env.RUNNER_TEMP || process.env.TMPDIR;
if (!SCRATCH) throw new Error("published-claim tests require RUNNER_TEMP or TMPDIR");

const VERSION = "0.2.0-rc.2";
const DIGEST = "a".repeat(64);
const BYTES = "4";
const ARTIFACT = `seal-v${VERSION}-linux-x64`;
const SUMS = `${DIGEST} ${BYTES} ${ARTIFACT}\n`;
const RELEASES = [{
  tag_name: `v${VERSION}`,
  assets: [
    { name: "SHA256SUMS", browser_download_url: `data:text/plain,${encodeURIComponent(SUMS)}` },
    { name: ARTIFACT, digest: `sha256:${DIGEST}`, size: Number(BYTES) },
  ],
}];
const RELEASES_API = `data:application/json,${encodeURIComponent(JSON.stringify(RELEASES))}`;

function git(cwd, ...args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
}

function fixture(files = {}) {
  const repo = fs.mkdtempSync(path.join(SCRATCH, "seal-published-claim-"));
  fs.mkdirSync(path.join(repo, "scripts"));
  fs.writeFileSync(path.join(repo, "scripts", "check-published-claim.cjs"), GATE, { mode: 0o755 });
  fs.writeFileSync(path.join(repo, "VERSION"), `${VERSION}\n`);
  fs.writeFileSync(path.join(repo, "README.md"), `Install Seal v${VERSION}.\n`);
  for (const [name, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(repo, name)), { recursive: true });
    fs.writeFileSync(path.join(repo, name), text);
  }
  git(repo, "init");
  git(repo, "remote", "add", "origin", "https://github.com/velvetmonkey/seal.git");
  git(repo, "add", ".");
  return repo;
}

function runGate(repo, env = {}) {
  return spawnSync(process.execPath, [path.join(repo, "scripts", "check-published-claim.cjs")], {
    cwd: repo,
    encoding: "utf8",
    env: { ...process.env, SEAL_RELEASES_API: RELEASES_API, ...env },
  });
}

function output(result) {
  return `${result.stdout}${result.stderr}`;
}

test("clean tracked text and published assets pass", (t) => {
  const repo = fixture({
    INSTALL: `Install Seal v${VERSION}.\n`,
    "docs/install.ps1": `Write-Output "Seal v${VERSION}"\n`,
    "docs/links.rst": `See RELEASE-NOTES-v${VERSION}.md.\n`,
  });
  t.after(() => fs.rmSync(repo, { recursive: true, force: true }));
  const result = runGate(repo);
  assert.equal(result.status, 0, output(result));
  assert.match(result.stdout, /scanned \d+ tracked text files/);
});

test("an unpublished token in a tracked extensionless file is refused", (t) => {
  const unpublished = ["v9", "9", "9-rc", "1"].join(".");
  const repo = fixture({ INSTALL: `docker pull ghcr.io/velvetmonkey/seal:${unpublished}\n` });
  t.after(() => fs.rmSync(repo, { recursive: true, force: true }));
  const result = runGate(repo);
  assert.equal(result.status, 1, output(result));
  assert.match(result.stderr, new RegExp(`INSTALL:1: unpublished version token ${unpublished.replaceAll(".", "\\.")}`));
});

test("HTML entities and newlines cannot split an unpublished token", (t) => {
  const repo = fixture({ "index.html": "<a>v9&#46;9&#46;\n9-rc&#46;1</a>\n" });
  t.after(() => fs.rmSync(repo, { recursive: true, force: true }));
  const result = runGate(repo);
  assert.equal(result.status, 1, output(result));
  assert.match(result.stderr, /index\.html:1: unpublished version token v9\.9\.9-rc\.1/);
});

test("BOM-marked UTF-16 text is scanned rather than skipped as binary", (t) => {
  const unpublished = ["v9", "8", "7-rc", "6"].join(".");
  const utf16 = Buffer.from(`\ufeffWrite-Output "Seal ${unpublished}"\r\n`, "utf16le");
  const repo = fixture({ "docs/install.ps1": utf16 });
  t.after(() => fs.rmSync(repo, { recursive: true, force: true }));
  const result = runGate(repo);
  assert.equal(result.status, 1, output(result));
  assert.match(result.stderr, new RegExp(`docs/install\\.ps1:1: unpublished version token ${unpublished.replaceAll(".", "\\.")}`));
});

test("NUL-free legacy single-byte text is scanned", (t) => {
  const unpublished = ["v8", "7", "6-beta", "5"].join(".");
  const latin1 = Buffer.concat([Buffer.from(`Install Seal ${unpublished}; caf`, "ascii"), Buffer.from([0xe9, 0x0a])]);
  const repo = fixture({ INSTALL: latin1 });
  t.after(() => fs.rmSync(repo, { recursive: true, force: true }));
  const result = runGate(repo);
  assert.equal(result.status, 1, output(result));
  assert.match(result.stderr, new RegExp(`INSTALL:1: unpublished version token ${unpublished.replaceAll(".", "\\.")}`));
});

test("an unpublished prerelease VERSION has no bypass", (t) => {
  const repo = fixture();
  const unpublished = ["9", "9", "9-rc", "1"].join(".");
  fs.writeFileSync(path.join(repo, "VERSION"), `${unpublished}\n`);
  const result = runGate(repo);
  t.after(() => fs.rmSync(repo, { recursive: true, force: true }));
  assert.equal(result.status, 1, output(result));
  assert.match(result.stderr, new RegExp(`VERSION:1: unpublished version token ${unpublished.replaceAll(".", "\\.")}`));
});

test("a published-version prefix cannot bless a longer unpublished token", (t) => {
  const repo = fixture({ "docs/install.txt": `npm install example@v${VERSION}.evil\n` });
  t.after(() => fs.rmSync(repo, { recursive: true, force: true }));
  const result = runGate(repo);
  assert.equal(result.status, 1, output(result));
  assert.match(result.stderr, new RegExp(`docs/install\\.txt:1: unpublished version token v${VERSION.replaceAll(".", "\\.")}\\.evil`));
});

test("a corrupt explicit digest still fails after token validation", (t) => {
  const repo = fixture({ "docs/install.txt": `sha256 ${"0".repeat(64)}\n` });
  t.after(() => fs.rmSync(repo, { recursive: true, force: true }));
  const result = runGate(repo);
  assert.equal(result.status, 1, output(result));
  assert.match(result.stderr, /docs\/install\.txt leads readers to digest 0{64}, live SHA256SUMS says a{64}/);
});

test("an absent tracked text file is a named failure", (t) => {
  const repo = fixture({ INSTALL: `Install Seal v${VERSION}.\n` });
  fs.unlinkSync(path.join(repo, "INSTALL"));
  t.after(() => fs.rmSync(repo, { recursive: true, force: true }));
  const result = runGate(repo);
  assert.equal(result.status, 1, output(result));
  assert.match(result.stderr, /INSTALL: tracked file is absent/);
});

test("an empty tracked text file is a named failure", (t) => {
  const repo = fixture({ INSTALL: `Install Seal v${VERSION}.\n` });
  fs.writeFileSync(path.join(repo, "INSTALL"), "");
  t.after(() => fs.rmSync(repo, { recursive: true, force: true }));
  const result = runGate(repo);
  assert.equal(result.status, 1, output(result));
  assert.match(result.stderr, /INSTALL: tracked file is empty/);
});

test("a mode-000 tracked text file is a named failure", (t) => {
  const repo = fixture({ INSTALL: `Install Seal v${VERSION}.\n` });
  fs.chmodSync(path.join(repo, "INSTALL"), 0o000);
  t.after(() => {
    fs.chmodSync(repo, 0o700);
    fs.chmodSync(path.join(repo, "INSTALL"), 0o600);
    fs.rmSync(repo, { recursive: true, force: true });
  });
  const result = runGate(repo);
  assert.equal(result.status, 1, output(result));
  assert.match(result.stderr, /INSTALL: tracked file has no read permission bits/);
});

test("an unreachable release list is UNKNOWN, never an empty published set", (t) => {
  const repo = fixture();
  t.after(() => fs.rmSync(repo, { recursive: true, force: true }));
  const result = runGate(repo, { SEAL_RELEASES_API: "http://127.0.0.1:9/unreachable" });
  assert.notEqual(result.status, 0, output(result));
  assert.match(result.stderr, /cannot reach GitHub releases API/);
});

test("NUL-bearing tracked content is classified as binary", (t) => {
  const hiddenBinaryToken = ["v9", "9", "9"].join(".");
  const repo = fixture({ "asset.dat": Buffer.from(`${hiddenBinaryToken}\0binary`, "utf8") });
  t.after(() => fs.rmSync(repo, { recursive: true, force: true }));
  const result = runGate(repo);
  assert.equal(result.status, 0, output(result));
  assert.match(result.stdout, /skipped 1 binary file/);
});
