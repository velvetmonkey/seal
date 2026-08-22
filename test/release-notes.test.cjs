// SPDX-License-Identifier: Apache-2.0
const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.join(__dirname, "..");
const VERSION = fs.readFileSync(path.join(ROOT, "VERSION"), "utf8").trim();
const NOTES = path.join(ROOT, "docs", "assurance", `RELEASE-NOTES-v${VERSION}.md`);

test("release notes state the platform and protected-receipt signing boundary", () => {
  const notes = fs.readFileSync(NOTES, "utf8");

  assert.match(notes, new RegExp(`Seal v${VERSION.replaceAll(".", "\\.")} supports Linux x86-64 only\\.`));
  assert.match(notes, /Both paths write signed receipt files/);
  assert.match(notes, /the protected path creates or reuses a machine-local Ed25519 key under the Seal data directory/);
  assert.match(notes, /The checker accepts a receipt only against the public key you supply/);
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
