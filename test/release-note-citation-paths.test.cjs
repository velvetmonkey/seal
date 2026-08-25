// SPDX-License-Identifier: Apache-2.0
// The release notes are evidence only if every local citation opens a file.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.join(__dirname, "..");
const NOTES = path.join(ROOT, "docs", "assurance", "RELEASE-NOTES-v0.2.0-rc.3.md");

function citedPaths(notes) {
  const inline = [...notes.matchAll(/`([^`]+)`/g)].map((match) => match[1]);
  const markdown = [...notes.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)].map((match) => match[1]);
  const paths = [...inline, ...markdown]
    .filter((candidate) => candidate === "README.md" || /^(?:\.{0,2}\/)?(?:\.?github|docs|test|scripts|checker|contract)\//.test(candidate))
    .filter((candidate) => !/^[a-z]+:/i.test(candidate))
    .map((candidate) => {
      const rootRelative = candidate === "README.md" || /^(?:\.?github|docs|test|scripts|checker|contract)\//.test(candidate);
      const resolved = rootRelative ? path.join(ROOT, candidate) : path.resolve(path.dirname(NOTES), candidate);
      return path.relative(ROOT, resolved);
    });
  return [...new Set(paths)].sort();
}

test("every local rc.3 release-note citation resolves to a nonempty regular file", () => {
  const actual = citedPaths(fs.readFileSync(NOTES, "utf8"));
  const expected = [
    ".github/workflows/macos.yml",
    ".github/workflows/release.yml",
    "README.md",
    "checker/seal-receipt-check.mjs",
    "contract/contract.cjs",
    "docs/assurance/architecture.md",
    "docs/assurance/distribution.md",
    "docs/reference/multi-tool-semantics.md",
    "scripts/build-dist.cjs",
    "test/approval-contract.test.cjs",
    "test/demo-witness.test.cjs",
    "test/no-verification-claim.test.cjs",
    "test/protect3b.test.cjs",
    "test/proxy-lock-nonlinux.test.cjs",
    "test/receipt-checker.test.cjs",
    "test/spine-retry.test.cjs",
  ];
  for (const citation of actual) {
    const target = path.join(ROOT, citation);
    const stat = fs.statSync(target, { throwIfNoEntry: false });
    assert.ok(stat, `${citation}: cited file does not exist`);
    assert.ok(stat.isFile(), `${citation}: citation target is not a regular file`);
    assert.ok(stat.size > 0, `${citation}: citation target is empty`);
  }
  assert.deepEqual(actual, expected, "the extracted citation population changed; review every new or removed citation deliberately");
});
