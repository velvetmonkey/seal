// SPDX-License-Identifier: Apache-2.0
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const ROOT = path.join(__dirname, "..");
const SEAL = path.join(ROOT, "bin", "seal");

test("seal demo names the retained scratch directory and its recovery command", () => {
  const run = spawnSync(process.execPath, [SEAL, "demo"], {
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
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "seal-demo-scratch-test-"));
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
