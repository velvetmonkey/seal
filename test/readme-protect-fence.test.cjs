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

test("README protect fence passes exactly two tools and fails closed", () => {
  const readme = fs.readFileSync(README, "utf8");
  const protectFence = shellFences(readme).find((fence) => fence.includes("seal protect db demo.mutate"));
  assert.ok(protectFence, "README must contain the protect fence");
  assert.equal(protectFence, "seal protect db demo.mutate demo.erase");

  const work = fs.mkdtempSync(path.join(os.tmpdir(), "seal-readme-protect-"));
  const sentinel = path.join(work, "sentinel.txt");
  fs.writeFileSync(sentinel, "sentinel\n");
  const script = `
seal() { printf '%s\\n' "$*" > seal-args.txt; return 41; }
${protectFence} && printf 'walk continued\\n'
`;
  const result = spawnSync("bash", ["-lc", script], { cwd: work, encoding: "utf8" });

  assert.equal(result.status, 41, result.stderr);
  assert.equal(fs.readFileSync(path.join(work, "seal-args.txt"), "utf8"), "protect db demo.mutate demo.erase\n");
  assert.equal(fs.existsSync(path.join(work, ".mcp.json")), false, "failed protect fence must not create .mcp.json");
  assert.equal(fs.readFileSync(sentinel, "utf8"), "sentinel\n");
  assert.doesNotMatch(result.stdout, /walk continued/);
});
