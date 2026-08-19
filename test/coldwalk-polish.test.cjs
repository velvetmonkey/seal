// SPDX-License-Identifier: Apache-2.0
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const test = require("node:test");

const ROOT = path.join(__dirname, "..");
const SEAL = path.join(ROOT, "bin", "seal");

function escapeRegex(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function demoRun() {
  const child = spawn(process.execPath, [SEAL, "demo"], { stdio: ["pipe", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  return {
    child,
    output: () => `${stdout}${stderr}`,
    waitFor: (pattern) => new Promise((resolve, reject) => {
      const timer = setInterval(() => {
        if (pattern.test(stdout)) { clearInterval(timer); resolve(); }
        if (child.exitCode !== null) { clearInterval(timer); reject(new Error(`${stdout}${stderr}`)); }
      }, 10);
    }),
    exit: new Promise((resolve) => child.once("close", (code) => resolve(code))),
  };
}

test("demo announces and retains its checker directory, and Remove explains its cleanup", async (t) => {
  const demo = demoRun();
  await demo.waitFor(/Approve\? \[y\/N\]/);
  const demoPrefix = path.join(os.tmpdir(), "seal-demo-");
  const announced = demo.output().match(new RegExp(
    `temporary demo directory: (${escapeRegex(demoPrefix)}[^\\s]+) \\(remains after the demo for the printed checker command\\)`,
  ));
  assert.ok(announced, demo.output());
  const directory = announced[1];
  t.after(() => {
    if (process.env.KEEP_TMP === "1" || process.env.KEEP_TMP === "true") return;
    fs.rmSync(directory, { recursive: true, force: true });
  });

  demo.child.stdin.write("y\n");
  assert.equal(await demo.exit, 0, demo.output());
  assert.ok(fs.statSync(directory).isDirectory(), "the checker directory must remain after the demo");
  assert.ok(fs.statSync(path.join(directory, "receipt-signer.pub")).isFile(), "the retained directory must keep the checker public key");

  const readme = fs.readFileSync(path.join(ROOT, "README.md"), "utf8");
  assert.match(readme, /temporary directory.*remains after the walk/s);
  assert.match(readme, /After you run that command, remove the exact directory the demo printed with `rm -r`/);
});

test("the README exports the installed command directory before the Demo command", () => {
  const readme = fs.readFileSync(path.join(ROOT, "README.md"), "utf8");
  const pathInstruction = readme.indexOf("Add `~/.local/bin` to PATH before continuing:");
  const exportCommand = readme.indexOf('export PATH="$HOME/.local/bin:$PATH"');
  const demo = readme.indexOf("## 2. Demo");

  assert.ok(pathInstruction >= 0, "README must make PATH setup part of the happy path");
  assert.ok(exportCommand > pathInstruction, "README must show the PATH export after introducing it");
  assert.ok(exportCommand < demo, "README must show the PATH export before seal demo");
});
