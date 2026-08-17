// SPDX-License-Identifier: Apache-2.0
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const README = path.join(__dirname, "..", "README.md");

function shellFences(text) {
  const fences = [];
  const parts = text.split("```sh\n").slice(1);
  for (const part of parts) fences.push(part.split("\n```", 1)[0]);
  return fences;
}

test("README protect fence stops before writing .mcp.json if its target directory cannot be entered", () => {
  const readme = fs.readFileSync(README, "utf8");
  const protectFence = shellFences(readme)[5];
  assert.ok(protectFence, "README must contain the protect fence");

  const work = fs.mkdtempSync(path.join(os.tmpdir(), "seal-readme-protect-"));
  const sentinel = path.join(work, "sentinel.txt");
  fs.writeFileSync(sentinel, "sentinel\n");

  const blockedFence = protectFence.replace(
    /^export SEAL_PROTECT_PROJECT=.*$/m,
    'export SEAL_PROTECT_PROJECT="/proc/seal-readme-protect-denied/project"',
  );

  const script = `
seal() { printf 'seal-ran\\n' > seal-ran.txt; }
${blockedFence}
`;
  const result = spawnSync("bash", ["-lc", script], {
    cwd: work,
    encoding: "utf8",
  });

  assert.notEqual(result.status, 0, "blocked protect fence must fail closed");
  assert.equal(fs.existsSync(path.join(work, ".mcp.json")), false, "blocked protect fence must not write .mcp.json into the caller directory");
  assert.equal(fs.existsSync(path.join(work, "seal-ran.txt")), false, "blocked protect fence must not reach seal protect after cd fails");
  assert.equal(fs.readFileSync(sentinel, "utf8"), "sentinel\n");
});
