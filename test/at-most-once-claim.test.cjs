// SPDX-License-Identifier: Apache-2.0
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.join(__dirname, "..");

test("the first screen relates approval to effect as an upper bound, not an execution guarantee", () => {
  const readme = fs.readFileSync(path.join(ROOT, "README.md"), "utf8");
  const firstScreen = readme.match(/^<p align="center">[\s\S]*?(?=\n## 1\. Install)/)?.[0];

  assert.ok(firstScreen, "README must have a first screen before Install");
  assert.match(firstScreen, /approval response that can release at most that exact effect/);
  assert.doesNotMatch(firstScreen, /then (?:it|the call) runs once|execut(?:e[sd]?|ion) once after approval/i);
});
