// SPDX-License-Identifier: Apache-2.0
// Standing rule "proven means strict", ruled 2026-08-27: PROVED requires a
// shipped theorem in the build graph and CI running it on the shipped commit.
// Keep the reader-visible and receipt-visible claim surfaces honest.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.join(__dirname, "..");
const surfaces = [
  ["contract/contract.cjs", /authorization_rule\s*:\s*["']PROVED["']/u],
  ["spine/demo.cjs", /authorization rule\s+proved\b/iu],
  ["README.md", /authorization rule\s+proved\b/iu],
];

test("PROVED cannot return to the reader or receipt claim surfaces", () => {
  for (const [relative, forbidden] of surfaces) {
    const text = fs.readFileSync(path.join(ROOT, relative), "utf8");
    assert.doesNotMatch(text, forbidden, `${relative} contains an unearned PROVED claim`);
  }
});
