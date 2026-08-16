// SPDX-License-Identifier: Apache-2.0
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const README = path.join(__dirname, "..", "README.md");

function demoFence(text) {
  const start = text.indexOf('export SEAL_DEMO_LOG=');
  assert.notEqual(start, -1, "README must contain the demo walk fence");
  const end = text.indexOf("\n```", start);
  assert.notEqual(end, -1, "README demo walk fence must close");
  return text.slice(start, end);
}

function run(script, cwd) {
  return spawnSync("bash", ["-lc", script], { cwd, encoding: "utf8" });
}

test("README demo fence stops when tee masks a failing seal demo", () => {
  const fence = demoFence(fs.readFileSync(README, "utf8"));
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "seal-readme-demo-"));
  const fakeSeal = "seal() { printf 'tampered demo step\\n'; return 37; }";

  const unguarded = run(`${fakeSeal}\nexport SEAL_DEMO_LOG=demo.log\nseal demo | tee \"$SEAL_DEMO_LOG\"\nprintf 'walk continued\\n'`, work);
  assert.equal(unguarded.status, 0, unguarded.stderr);
  assert.match(unguarded.stdout, /walk continued/);

  const guarded = run(`${fakeSeal}\n${fence}\nprintf 'walk continued\\n'`, work);
  assert.equal(guarded.status, 37, guarded.stderr);
  assert.match(guarded.stderr, /README walk stopped: seal demo failed \(exit 37\)/);
  assert.doesNotMatch(guarded.stdout, /walk continued/);
});
