// SPDX-License-Identifier: Apache-2.0
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const README = path.join(__dirname, "..", "README.md");

function commandFences(text) {
  const lines = text.split("\n");
  const fences = [];
  let current = null;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (current) {
      if (line === "```") {
        fences.push(current);
        current = null;
        continue;
      }
      current.lines.push({ number: i + 1, text: line });
      continue;
    }
    if (line === "```bash") current = { start: i + 1, lines: [] };
  }

  return fences;
}

test("README command fences do not embed /home/ absolutes", () => {
  const readme = fs.readFileSync(README, "utf8");
  const offenders = [];

  for (const fence of commandFences(readme)) {
    for (const line of fence.lines) {
      if (line.text.includes("/home/")) offenders.push(`README.md:${line.number}: ${line.text}`);
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `README command fences must not embed build-machine /home/ paths:\n${offenders.join("\n")}`,
  );
});
