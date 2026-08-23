// SPDX-License-Identifier: Apache-2.0
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.join(__dirname, "..");

test("the first screen says plainly that approval prevents a second run but does not promise a first", () => {
  const readme = fs.readFileSync(path.join(ROOT, "README.md"), "utf8");
  const firstScreen = readme.slice(0, readme.indexOf("## See it work"));
  const boundary = readme.slice(readme.indexOf("## The boundary"), readme.indexOf("## Links"));

  assert.ok(firstScreen, "README must have a first screen before Install");
  assert.match(firstScreen, /Seal refuses reuse of the same approval/);
  assert.match(boundary, /A failure before forwarding can spend\n  it without running the call/);
  assert.doesNotMatch(firstScreen, /then (?:it|the call) runs once|execut(?:e[sd]?|ion) once after approval/i);
});
