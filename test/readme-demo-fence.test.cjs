// SPDX-License-Identifier: Apache-2.0
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const README = path.join(__dirname, "..", "README.md");

function run(script, cwd) {
  return spawnSync("bash", ["-lc", script], { cwd, encoding: "utf8" });
}

test("README bare demo fence propagates a failing seal demo", () => {
  const readme = fs.readFileSync(README, "utf8");
  const fences = [...readme.matchAll(/```bash\n([\s\S]*?)\n```/g)].map((match) => match[1]);
  assert.doesNotMatch(fences[0], /^\$ /, "README demo command must be pasteable without a prompt");

  const work = fs.mkdtempSync(path.join(os.tmpdir(), "seal-readme-demo-"));
  const fakeSeal = "seal() { printf 'tampered demo step\\n'; return 37; }";
  const result = run(`${fakeSeal}\n${fences[0]} && printf 'walk continued\\n'`, work);

  assert.equal(result.status, 37, result.stderr);
  assert.match(result.stdout, /tampered demo step/);
  assert.doesNotMatch(result.stdout, /walk continued/);
  assert.equal(fences[0], "seal demo");
});
