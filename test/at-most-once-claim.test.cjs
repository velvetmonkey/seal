// SPDX-License-Identifier: Apache-2.0
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.join(__dirname, "..");

test("the first screen says plainly that approval prevents a second run but does not promise a first", () => {
  const readme = fs.readFileSync(path.join(ROOT, "README.md"), "utf8");
  const firstScreen = readme.match(/^<p align="center">[\s\S]*?(?=\n## 1\. Install)/)?.[0];
  const hero = firstScreen?.match(/^Seal puts an approval gate.*$/m)?.[0];

  assert.ok(firstScreen, "README must have a first screen before Install");
  assert.ok(hero, "first screen must have a plain-language hero paragraph");
  assert.match(hero, /You approve one exact call\. Seal will not run it twice\. It might not run it at all\./);
  assert.doesNotMatch(hero, /then (?:it|the call) runs once|execut(?:e[sd]?|ion) once after approval/i);
  assert.doesNotMatch(hero, /\b(?:matching|approval response|release|effect|at[- ]most)\b/i);
});
