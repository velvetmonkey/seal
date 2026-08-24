// SPDX-License-Identifier: Apache-2.0
const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.join(__dirname, "..");
const VERSION = fs.readFileSync(path.join(ROOT, "VERSION"), "utf8").trim();
const NOTES = path.join(ROOT, "docs", "assurance", `RELEASE-NOTES-v${VERSION}.md`); // CLAIM-COVERAGE: docs/assurance/RELEASE-NOTES-v0.2.0-rc.3.md

test("release notes state the platform and protected-receipt signing boundary", () => {
  const notes = fs.readFileSync(NOTES, "utf8");

  assert.match(notes, /macOS source portability is CI-exercised for install, demo and receipt checking\./, `${NOTES}: macOS portability claim`);
  assert.match(notes, /Protect is not supported on macOS yet\./, `${NOTES}: Protect macOS exclusion`);
  assert.doesNotMatch(notes, /supports Linux x86-64 and macOS x64\/arm64/, `${NOTES}: overbroad platform claim`);
  assert.match(notes, /Both paths write signed receipt files/);
  assert.match(notes, /the protected path creates or reuses a machine-local Ed25519 key under the Seal data directory/);
  assert.match(notes, /The checker accepts a receipt only against the public key you supply/);
});

test("v0.2.0-rc.2 release notes retain the immutable tag's Linux-only platform claim", () => {
  const notes = fs.readFileSync(path.join(ROOT, "docs", "assurance", "RELEASE-NOTES-v0.2.0-rc.2.md"), "utf8");
  assert.match(notes, /Seal v0\.2\.0-rc\.2 supports Linux x86-64 only\. macOS, Windows, Linux ARM, and other platforms are not supported in this release\./);
  assert.doesNotMatch(notes, /v0\.2\.0-rc\.2 supports Linux x86-64 and macOS/);
});

test("every current platform-claim surface excludes macOS Protect support", () => {
  const claimSites = [
    ".github/workflows/release.yml",
    "README.md",
    "bin/seal",
    "docs/assurance/README.md",
    "docs/assurance/RELEASE-NOTES-v0.2.0-rc.3.md",
    "docs/assurance/distribution.md",
    "docs/assurance/index.html",
    "docs/guide/README.md",
    "docs/guide/when-something-looks-wrong.md",
    "docs/start/install.md",
    "scripts/install.cjs",
    "scripts/seal-launch.cjs",
    "spine/platform.cjs",
  ];
  for (const file of claimSites) {
    const text = fs.readFileSync(path.join(ROOT, file), "utf8");
    assert.match(text, /macOS source portability is CI-exercised for install, demo and receipt checking\./, `${file}: portability boundary`);
    assert.match(text, /Protect is not supported on macOS yet\./, `${file}: Protect boundary`);
    assert.doesNotMatch(text, /supports Linux x86-64 and macOS x64\/arm64|source builds support Linux x86-64 and macOS/i, `${file}: overbroad platform claim`);
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
