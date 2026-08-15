// SPDX-License-Identifier: Apache-2.0
// A no-flag demo must not write its fabricated, temporarily-signed decisions
// into the user's durable receipt store. Do not add XDG_DATA_HOME here: this
// test is specifically the default branch a first-time user takes.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const test = require("node:test");

const SEAL = path.join(__dirname, "..", "bin", "seal");

test("seal demo without --dir or XDG_DATA_HOME keeps receipts out of scratch HOME's store", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "seal-demo-default-home-"));
  const env = { ...process.env, HOME: home };
  delete env.XDG_DATA_HOME;

  const child = spawn(process.execPath, [SEAL, "demo"], { env, stdio: ["pipe", "pipe", "pipe"] });
  let out = "";
  let err = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    out += chunk;
    if (/Approve\? \[y\/N\]/.test(out)) child.stdin.write("y\n");
  });
  child.stderr.on("data", (chunk) => { err += chunk; });
  const code = await new Promise((resolve) => child.once("close", resolve));
  assert.equal(code, 0, `${out}${err}`);

  const directory = out.match(/^temporary demo directory: (.+) \(remains after the demo for the printed checker command\)$/m)?.[1];
  assert.ok(directory, out);
  const receiptPaths = [...out.matchAll(/^receipt written: (.+)$/gm)].map((match) => match[1]);
  assert.equal(receiptPaths.length, 3, out);
  for (const receiptPath of receiptPaths) {
    assert.equal(path.dirname(receiptPath), path.join(directory, "receipts"), out);
    assert.ok(fs.existsSync(receiptPath), `demo printed a missing receipt: ${receiptPath}`);
  }

  const durableStore = path.join(home, ".local", "share", "seal", "receipts");
  assert.ok(!fs.existsSync(durableStore), `demo wrote fabricated receipts to the user's store: ${durableStore}`);
  fs.rmSync(directory, { recursive: true, force: true });
});
