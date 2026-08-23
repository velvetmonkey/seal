// SPDX-License-Identifier: Apache-2.0
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const README = path.join(__dirname, "..", "README.md");

function shellFences(text) {
  return [...text.matchAll(/```bash\n([\s\S]*?)\n```/g)].map((match) => (
    match[1].split("\n").map((line) => {
      assert.notEqual(line.trim(), "", "README command lines must not be empty");
      return line.startsWith("$ ") ? line.slice(2) : line;
    }).join("\n")
  ));
}

test("README protect fence matches the published single-tool CLI", () => {
  const readme = fs.readFileSync(README, "utf8");
  const protectFence = shellFences(readme).find((fence) => fence.includes("seal protect db demo.mutate"));
  assert.ok(protectFence, "README must contain the protect fence");

  assert.equal(protectFence.trim(), "seal protect db demo.mutate");
});
