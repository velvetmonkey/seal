// SPDX-License-Identifier: Apache-2.0
// Demo receipts must not enter the user's durable receipt store, either by
// default or through an explicit --dir alias of that store.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const test = require("node:test");
const { testTmpdir } = require("../scripts/temp-root.cjs");

const SEAL = path.join(__dirname, "..", "bin", "seal");

test("seal demo without --dir or XDG_DATA_HOME keeps receipts out of scratch HOME's store", async () => {
  const home = testTmpdir(path.join(os.tmpdir(), "seal-demo-default-home-"));
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

function runDemo(args, env) {
  return spawnSync(process.execPath, [SEAL, "demo", ...args], {
    env: { ...process.env, ...env },
    input: "n\n",
    encoding: "utf8",
  });
}

function receiptNames(store) {
  const receipts = path.join(store, "receipts");
  return fs.existsSync(receipts) ? fs.readdirSync(receipts).sort() : [];
}

test("seal demo --dir refuses HOME and XDG receipt stores and their canonical aliases before writing", () => {
  const root = testTmpdir(path.join(os.tmpdir(), "seal-demo-refuse-home-"));
  const home = path.join(root, "home");
  const xdg = path.join(root, "xdg");
  const homeStore = path.join(home, ".local", "share", "seal");
  const xdgStore = path.join(xdg, "seal");
  fs.mkdirSync(path.join(homeStore, "receipts"), { recursive: true });
  fs.mkdirSync(path.join(xdgStore, "receipts"), { recursive: true });
  fs.writeFileSync(path.join(homeStore, "receipts", "existing.json"), "home receipt\n");
  fs.writeFileSync(path.join(xdgStore, "receipts", "existing.json"), "xdg receipt\n");
  const alias = path.join(root, "receipt-store-link");
  fs.symlinkSync(xdgStore, alias);

  const env = { HOME: home, XDG_DATA_HOME: xdg };
  const cases = [
    ["HOME store", homeStore],
    ["XDG store", xdgStore],
    ["dot-dot alias", path.join(xdgStore, "..", "seal")],
    ["symlink alias", alias],
    ["inside store", path.join(xdgStore, "projects", "demo")],
  ];
  for (const [name, directory] of cases) {
    const beforeHome = receiptNames(homeStore);
    const beforeXdg = receiptNames(xdgStore);
    const result = runDemo(["--dir", directory], env);
    assert.notEqual(result.status, 0, `${name}: ${result.stdout}${result.stderr}`);
    assert.match(result.stderr, /REFUSE demo_directory_is_real_receipt_store:/, `${name}: ${result.stderr}`);
    assert.deepEqual(receiptNames(homeStore), beforeHome, `${name}: HOME receipts changed`);
    assert.deepEqual(receiptNames(xdgStore), beforeXdg, `${name}: XDG receipts changed`);
  }
});

test("a legitimate explicit --dir works and is not called temporary", () => {
  const root = testTmpdir(path.join(os.tmpdir(), "seal-demo-explicit-dir-"));
  const home = path.join(root, "home");
  const directory = path.join(root, "genuine-scratch");
  const result = runDemo(["--dir", directory], { HOME: home, XDG_DATA_HOME: path.join(root, "xdg") });
  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
  assert.match(result.stdout, new RegExp(`^demo directory: ${directory.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} \\(remains after the demo`, "m"));
  assert.doesNotMatch(result.stdout, /temporary demo directory:/);
  assert.equal(receiptNames(directory).length, 2, result.stdout);
});
