// SPDX-License-Identifier: Apache-2.0
const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.join(__dirname, "..");
const VERSION = fs.readFileSync(path.join(ROOT, "VERSION"), "utf8").trim();
const NOTES_RELATIVE = "docs/assurance/RELEASE-NOTES-v0.2.0-rc.3.md";
const NOTES = path.join(ROOT, NOTES_RELATIVE); // CLAIM-COVERAGE: docs/assurance/RELEASE-NOTES-v0.2.0-rc.3.md
assert.equal(NOTES_RELATIVE, `docs/assurance/RELEASE-NOTES-v${VERSION}.md`);

test("release notes state the platform and protected-receipt signing boundary", () => {
  const notes = fs.readFileSync(NOTES, "utf8");

  assert.match(notes, /macOS source portability is CI-exercised for install, demo and receipt checking\./, `${NOTES}: macOS portability claim`);
  assert.match(notes, /Protect is not supported on macOS yet\./, `${NOTES}: Protect macOS exclusion`);
  assert.doesNotMatch(notes, /supports Linux x86-64 and macOS x64\/arm64/, `${NOTES}: overbroad platform claim`);
  assert.match(notes, /Both paths write signed receipt files/);
  assert.match(notes, /the protected path creates or reuses a machine-local Ed25519 key under the Seal data directory/);
  assert.match(notes, /The checker accepts a receipt only against the public key you supply/);
});

test("replacement rc.3 citations retain their specific evidence", () => {
  const approvalContract = fs.readFileSync(path.join(ROOT, "test", "approval-contract.test.cjs"), "utf8");
  assert.match(approvalContract, /replayed approval already consumed; child stays at exactly 1/);
  assert.match(approvalContract, /expired approval; child receives nothing/);

  const distribution = fs.readFileSync(path.join(ROOT, "docs", "assurance", "distribution.md"), "utf8");
  assert.match(distribution, /Linux x86-64 is the supported Protect path\./);

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

test("current product and release surfaces state macOS Protect parity", () => {
  const claimSites = [
    ".github/workflows/release.yml",
    "bin/seal",
    "scripts/install.cjs",
    "scripts/seal-launch.cjs",
    "spine/platform.cjs",
  ];
  for (const file of claimSites) {
    const text = fs.readFileSync(path.join(ROOT, file), "utf8");
    assert.match(text, /supports install, demo, receipt checking and Protect on Linux x86-64 and macOS x64\/arm64\./, `${file}: product parity`);
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
