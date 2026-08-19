// SPDX-License-Identifier: Apache-2.0
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { tmpdir, track } = require("../test-support/tmpdir.cjs");

const README = path.join(__dirname, "..", "README.md");

function shellFences(text) {
  return [...text.matchAll(/```bash\n([\s\S]*?)\n```/g)].map((match) => (
    match[1].split("\n").map((line) => {
      assert.match(line, /^\$ /, "README command line must carry a visible prompt");
      return line.slice(2);
    }).join("\n")
  ));
}

test("README protect fence stops before writing .mcp.json if its target directory cannot be entered", () => {
  const readme = fs.readFileSync(README, "utf8");
  const protectFence = shellFences(readme).find((fence) => fence.includes("seal protect db demo.mutate"));
  assert.ok(protectFence, "README must contain the protect fence");

  const work = tmpdir("seal-readme-protect-");
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
