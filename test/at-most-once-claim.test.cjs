// SPDX-License-Identifier: Apache-2.0
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.join(__dirname, "..");

test("the boundary says plainly that approval prevents a second run but does not promise a first", () => {
  const readme = fs.readFileSync(path.join(ROOT, "README.md"), "utf8");
  const claim = ["Seal asks you to approve one exact call", "It will not run that call twice, and it might not run it at all"].join(". ") + ".";

  assert.equal(readme.split(claim).length - 1, 1, `README must carry the exact one-use boundary claim once: ${claim}`);
  assert.doesNotMatch(claim, /then (?:it|the call) runs once|execut(?:e[sd]?|ion) once after approval/i);
  assert.doesNotMatch(claim, /\b(?:matching|approval response|release|effect|at[- ]most)\b/i);
});
