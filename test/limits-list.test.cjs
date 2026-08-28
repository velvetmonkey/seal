// SPDX-License-Identifier: Apache-2.0
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.join(__dirname, "..");

test("boundary list names the implemented limits", () => {
  const readme = fs.readFileSync(path.join(ROOT, "README.md"), "utf8");
  const limits = readme.match(/## Guarantees and non-guarantees\n\n([\s\S]*?)(?=\n## )/);
  assert.ok(limits, "README must contain guarantees and non-guarantees");

  for (const phrase of [
    "The authorization rule has a Lean proof; the current shipped assurance status is TESTED.",
    "the product has no JavaScript authorization fallback.",
    "Seal is not an agent framework, a sandbox, an IAM platform, a policy language,",
    "Bash, direct writes, network access,\nsubprocesses, other servers, and other routes to the same effect stay outside.",
    "Receipts are signed decision records, not proof that an effect happened.",
  ]) {
    assert.ok(limits[1].includes(phrase), `guarantees section must name: ${phrase}`);
  }
});
