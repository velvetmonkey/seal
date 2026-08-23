// SPDX-License-Identifier: Apache-2.0
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const ROOT = path.join(__dirname, "..");
const README = path.join(ROOT, "README.md");

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

test("public Markdown outside docs/archive does not publish /home/monkey paths", () => {
  const listed = spawnSync("git", ["ls-files", "*.md"], { cwd: ROOT, encoding: "utf8" });
  assert.equal(listed.status, 0, listed.stdout + listed.stderr);
  const offenders = [];
  for (const relative of listed.stdout.trim().split("\n").filter(Boolean)) {
    if (relative.startsWith("docs/archive/")) continue;
    const lines = fs.readFileSync(path.join(ROOT, relative), "utf8").split("\n");
    for (let index = 0; index < lines.length; index += 1) {
      if (lines[index].includes("/home/monkey")) {
        offenders.push(`${relative}:${index + 1}: ${lines[index]}`);
      }
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `public Markdown contains build-machine /home/monkey paths:\n${offenders.join("\n")}`,
  );
});
