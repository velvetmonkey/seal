// SPDX-License-Identifier: Apache-2.0
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const README = path.join(__dirname, "..", "README.md");

function demoFence(text) {
  for (const match of text.matchAll(/```bash\n([\s\S]*?)\n```/g)) {
    if (!match[1].includes("export SEAL_DEMO_LOG=")) continue;
    return match[1].split("\n").map((line) => {
      assert.match(line, /^\$ /, "README demo command line must carry a visible prompt");
      return line.slice(2);
    }).join("\n");
  }
  assert.fail("README must contain the demo walk fence");
}

function run(script, cwd) {
  return spawnSync("bash", ["-lc", script], { cwd, encoding: "utf8" });
}

test("README demo fence stops when tee masks a failing seal demo", () => {
  const fence = demoFence(fs.readFileSync(README, "utf8"));
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "seal-readme-demo-"));
  const fakeSeal = "seal() { printf 'tampered demo step\\n'; return 37; }";

  // The published walk deliberately takes its answer from the reader's
  // controlling terminal. This non-interactive regression harness has none;
  // remove only that input redirect while exercising the pipeline's status.
  assert.match(fence, /seal demo <\/dev\/tty \| tee/);
  const fenceWithoutTty = fence.replace(" </dev/tty", "");

  const unguarded = run(`${fakeSeal}\nexport SEAL_DEMO_LOG=demo.log\nseal demo | tee \"$SEAL_DEMO_LOG\"\nprintf 'walk continued\\n'`, work);
  assert.equal(unguarded.status, 0, unguarded.stderr);
  assert.match(unguarded.stdout, /walk continued/);

  const guarded = run(`${fakeSeal}\n${fenceWithoutTty}\nprintf 'walk continued\\n'`, work);
  assert.equal(guarded.status, 37, guarded.stderr);
  assert.match(guarded.stderr, /README walk stopped: seal demo failed \(exit 37\)/);
  assert.doesNotMatch(guarded.stdout, /walk continued/);
});
