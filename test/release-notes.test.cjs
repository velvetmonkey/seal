// SPDX-License-Identifier: Apache-2.0
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.join(__dirname, "..");

test("release notes state the platform and unsigned protected-receipt limits", () => {
  const notes = fs.readFileSync(path.join(ROOT, "docs", "RELEASE-NOTES-v1.1.md"), "utf8");

  assert.match(notes, /Seal v1\.1 supports Linux x86-64 only\./);
  assert.match(notes, /The protected path writes its receipts unsigned/);
  assert.match(notes, /REFUSE unsealed/);
});
