// SPDX-License-Identifier: Apache-2.0
const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.join(__dirname, "..");
const VERSION = fs.readFileSync(path.join(ROOT, "VERSION"), "utf8").trim();
const NOTES_RELATIVE = `docs/assurance/RELEASE-NOTES-v${VERSION}.md`;
const RC3_NOTES_RELATIVE = "docs/assurance/RELEASE-NOTES-v0.2.0-rc.3.md"; // CLAIM-COVERAGE: docs/assurance/RELEASE-NOTES-v0.2.0-rc.3.md
const FINAL_NOTES_RELATIVE = "docs/assurance/RELEASE-NOTES-v0.2.0.md"; // CLAIM-COVERAGE: docs/assurance/RELEASE-NOTES-v0.2.0.md
const RC3_NOTES = path.join(ROOT, RC3_NOTES_RELATIVE);

const NOTES = path.join(ROOT, NOTES_RELATIVE);

test("the current VERSION has a release note with the same identity", () => {
  assert.equal(NOTES_RELATIVE, FINAL_NOTES_RELATIVE);
  assert.equal(path.basename(NOTES), `RELEASE-NOTES-v${VERSION}.md`);
  assert.match(fs.readFileSync(NOTES, "utf8"), new RegExp(`^# Seal v${VERSION.replaceAll(".", "\\.")} release notes$`, "m"));
});

test("current release notes state the platform, receipt format, and verifier trust ceiling", () => {
  const notes = fs.readFileSync(NOTES, "utf8");

  assert.match(notes, /publishes Linux x86-64 and macOS ARM64 artifacts\./);
  assert.match(notes, /Both published platforms support install, demo, receipt checking, and Protect\./);
  assert.match(notes, /macOS x86-64, Windows, Linux ARM, and other platforms are not published for this version\./);
  assert.match(notes, /one `seal\.receipt\/v2` envelope/);
  assert.match(notes, /refuses `authorityRoot` and `occurrenceWitness` inputs/);
  assert.match(notes, /Positive VERIFY is unreachable in this release/);
  assert.match(notes, /formatted result is `UNVERIFIED`/);
  assert.doesNotMatch(notes, /\bPROVED\b/, "the final release note must make zero PROVED claims");
});

test("rc.3 release-note identity and platform boundary remain immutable", () => {
  const notes = fs.readFileSync(RC3_NOTES, "utf8");
  assert.match(notes, /^# Seal v0\.2\.0-rc\.3 release notes$/m);
  assert.match(notes, /macOS source portability is CI-exercised for install, demo and receipt checking\./);
  assert.match(notes, /Protect is not supported on macOS yet\./);
  assert.doesNotMatch(notes, /supports Linux x86-64 and macOS x64\/arm64/);
});

test("replacement rc.3 citations retain their specific evidence", () => {
  const approvalContract = fs.readFileSync(path.join(ROOT, "test", "approval-contract.test.cjs"), "utf8");
  assert.match(approvalContract, /replayed approval already consumed; child stays at exactly 1/);
  assert.match(approvalContract, /expired approval; child receives nothing/);

  const distribution = fs.readFileSync(path.join(ROOT, "docs", "assurance", "distribution.md"), "utf8");
  assert.match(distribution, /Both published platforms support install, demo, receipt checking and Protect\./);

  const noVerification = fs.readFileSync(path.join(ROOT, "test", "no-verification-claim.test.cjs"), "utf8");
  assert.match(noVerification, /arm's-length verification/);

  const architecture = fs.readFileSync(path.join(ROOT, "docs", "assurance", "architecture.md"), "utf8");
  assert.match(architecture, /Shipped Node product path/);
  assert.match(architecture, /This diagram describes the Seal family product, not the Node CLI shipped by this repository\./);
});

test("v0.2.0-rc.2 release notes retain the immutable tag's Linux-only platform claim", () => {
  const notes = fs.readFileSync(path.join(ROOT, "docs", "assurance", "RELEASE-NOTES-v0.2.0-rc.2.md"), "utf8");
  assert.match(notes, /Seal v0\.2\.0-rc\.2 supports Linux x86-64 only\. macOS, Windows, Linux ARM, and other platforms are not supported in this release\./);
  assert.doesNotMatch(notes, /v0\.2\.0-rc\.2 supports Linux x86-64 and macOS/);
});

test("current product and release surfaces state published platform parity", () => {
  const claimSites = [
    ".github/workflows/release.yml",
    "bin/seal",
    "scripts/install.cjs",
    "scripts/seal-launch.cjs",
    "spine/platform.cjs",
  ];
  for (const file of claimSites) {
    const text = fs.readFileSync(path.join(ROOT, file), "utf8");
    const expected = file === ".github/workflows/release.yml"
      ? /publishes Linux x86-64 and macOS ARM64 artifacts for v\$\{version\}\./
      : /publishes Linux x86-64 and macOS ARM64 artifacts for v0\.2\.0\./;
    assert.match(text, expected, `${file}: product parity`);
    assert.doesNotMatch(text, /Protect is not supported on macOS yet\./, `${file}: retired exclusion`);
  }
});

test("every release-note commit and repository-path citation resolves", () => {
  const notesPath = NOTES;
  const notes = fs.readFileSync(notesPath, "utf8");
  const links = [...notes.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)].map((match) => match[1]);
  const shas = [...new Set(notes.match(/\b[0-9a-f]{7,40}\b/g) ?? [])];
  const repositoryPaths = links
    .filter((link) => !/^[a-z]+:/i.test(link))
    .map((link) => path.relative(ROOT, path.resolve(path.dirname(notesPath), link)));

  for (const sha of shas) {
    assert.doesNotThrow(
      () => childProcess.execFileSync("git", ["cat-file", "-e", `${sha}^{commit}`], { cwd: ROOT }),
      `release-note SHA does not resolve: ${sha}`,
    );
  }

  for (const repositoryPath of repositoryPaths) {
    assert.ok(!repositoryPath.startsWith(".."), `release-note path escapes repository: ${repositoryPath}`);
    assert.doesNotThrow(
      () => childProcess.execFileSync("git", ["cat-file", "-e", `HEAD:${repositoryPath}`], { cwd: ROOT }),
      `release-note path does not resolve at HEAD: ${repositoryPath}`,
    );
  }
});
