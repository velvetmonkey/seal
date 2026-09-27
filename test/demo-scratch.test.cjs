// SPDX-License-Identifier: Apache-2.0
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");
const { testTmpdir } = require("../scripts/temp-root.cjs");

const ROOT = path.join(__dirname, "..");
const SEAL = path.join(ROOT, "bin", "seal");

test("seal demo names the retained scratch directory and its recovery command", () => {
  const root = testTmpdir(path.join(os.tmpdir(), "seal-demo-retained-test-"));
  const run = spawnSync(process.execPath, [SEAL, "demo"], {
    env: { ...process.env, TMPDIR: root, TMP: root, TEMP: root },
    cwd: ROOT,
    encoding: "utf8",
    input: "y\n",
    timeout: 30000,
  });
  const output = `${run.stdout}${run.stderr}`;
  const match = output.match(/^temporary demo directory: (.+) \(remains after the demo for the printed checker command\)$/m);
  assert.ok(match, output);
  const demoDir = match[1];

  try {
    assert.equal(run.status, 0, output);
    assert.ok(fs.statSync(demoDir).isDirectory(), `demo directory did not remain: ${demoDir}`);
    const quoted = `'${demoDir.replaceAll("'", `'"'"'`)}'`;
    assert.match(
      output,
      new RegExp(`^Recover this run directory with: chmod -R u\\+w -- ${escapeRegExp(quoted)} && rm -rf -- ${escapeRegExp(quoted)}$`, "m"),
    );
  } finally {
    fs.rmSync(demoDir, { recursive: true, force: true });
  }
});

test("seal demo --dir never deletes a user-named directory", () => {
  const parent = testTmpdir(path.join(os.tmpdir(), "seal-demo-scratch-test-"));
  const demoDir = path.join(parent, "user-owned");
  const marker = path.join(demoDir, "keep.txt");
  fs.mkdirSync(demoDir);
  fs.writeFileSync(marker, "keep\n");

  try {
    const run = spawnSync(process.execPath, [SEAL, "demo", "--dir", demoDir], {
      cwd: ROOT,
      encoding: "utf8",
      input: "n\n",
      timeout: 30000,
    });
    const output = `${run.stdout}${run.stderr}`;
    assert.equal(run.status, 0, output);
    assert.doesNotMatch(output, /^Recover this run directory with:/m);
    assert.ok(fs.statSync(demoDir).isDirectory(), `user-named directory did not remain: ${demoDir}`);
    assert.equal(fs.readFileSync(marker, "utf8"), "keep\n");
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function approvedDemo(directory) {
  const run = spawnSync(process.execPath, [SEAL, "demo", "--dir", directory], {
    cwd: ROOT, encoding: "utf8", input: "y\n", timeout: 30000,
  });
  assert.equal(run.status, 0, `${run.stdout}${run.stderr}`);
  return run.stdout;
}

function verifyDemoReceipts(output, directory) {
  // Use the checker and public-key path from the command the user receives.
  const command = output.match(/^  Run: (.+)$/m)?.[1];
  assert.ok(command, output);
  const receipts = path.join(directory, "receipts");
  const names = fs.readdirSync(receipts);
  assert.equal(names.length, 3, output);
  const finalReceipt = output.match(/node checker\/seal-receipt-v2\.mjs (".+?") --pubkey/)?.[1];
  assert.ok(finalReceipt, command);
  for (const name of names) {
    const receipt = path.join(receipts, name);
    const checked = spawnSync("bash", ["-c", command.replace(finalReceipt, JSON.stringify(receipt))], {
      cwd: ROOT, encoding: "utf8", timeout: 30000,
    });
    assert.equal(checked.status, 0, `${receipt}: ${checked.stdout}${checked.stderr}`);
  }
}

test("repeated demo runs retain verifiable receipts with their printed keys", () => {
  const directory = testTmpdir(path.join(os.tmpdir(), "seal-demo-repeat-key-"));
  const first = approvedDemo(directory);
  const secondRun = spawnSync(process.execPath, [SEAL, "demo", "--dir", directory], {
    cwd: ROOT, encoding: "utf8", input: "y\n", timeout: 30000,
  });
  // Even a refused second run must leave the first run checkable.
  verifyDemoReceipts(first, directory);
  assert.equal(secondRun.status, 0, `${secondRun.stdout}${secondRun.stderr}`);
  const second = secondRun.stdout;
  for (const output of [first, second]) {
    const runDirectory = output.match(/^demo directory: (.+) \(remains after the demo/m)?.[1];
    assert.ok(runDirectory, output);
    assert.ok(runDirectory === directory || runDirectory.startsWith(directory + path.sep));
    verifyDemoReceipts(output, runDirectory);
  }
});

test("demo preserves a hand-written signer file and prints a checkable new run", () => {
  const directory = testTmpdir(path.join(os.tmpdir(), "seal-demo-hand-key-"));
  const keyPath = path.join(directory, "receipt-signer.pub");
  const original = "user supplied key file\n";
  fs.writeFileSync(keyPath, original);
  const output = approvedDemo(directory);
  assert.equal(fs.readFileSync(keyPath, "utf8"), original);
  const runDirectory = output.match(/^demo directory: (.+) \(remains after the demo/m)?.[1];
  assert.ok(runDirectory?.startsWith(directory + path.sep), output);
  verifyDemoReceipts(output, runDirectory);
});
