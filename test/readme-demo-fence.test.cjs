// SPDX-License-Identifier: Apache-2.0
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const README = path.join(__dirname, "..", "README.md");

test("README presents a pasteable demo command", () => {
  const text = fs.readFileSync(README, "utf8");
  assert.match(text, /```bash\nseal demo\n```/);
});
