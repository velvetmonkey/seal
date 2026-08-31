// SPDX-License-Identifier: Apache-2.0
"use strict";

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "..");

function suiteDirectories(root = os.tmpdir()) {
  return fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => name.startsWith("seal-") || name.startsWith("f5-"))
    .sort();
}

function suiteSummary(output) {
  return output.split(/\r?\n/)
    .filter((line) => /^# (?:tests|pass|fail|skipped|todo) \d+$/.test(line) || /^ROSTER: /.test(line))
    .join("\n");
}

test("a complete product suite leaves no seal or f5 temporary directory", () => {
  if (process.env.SEAL_TMP_LEAK_NESTED === "1") {
    assert.ok(fs.statSync(os.tmpdir()).isDirectory());
    return;
  }

  const target = path.resolve(process.env.SEAL_TMP_LEAK_TARGET_ROOT || ROOT);
  const tempRoot = os.tmpdir();
  const before = suiteDirectories(tempRoot);
  const result = spawnSync("bash", [path.join(target, "scripts", "run-complete-product-suite.sh")], {
    cwd: target,
    encoding: "utf8",
    env: {
      ...process.env,
      SEAL_TMP_LEAK_NESTED: "1",
      NODE_TEST_CONTEXT: undefined,
    },
    timeout: 900000,
  });
  const after = suiteDirectories(tempRoot);
  const beforeSet = new Set(before);
  const survivors = after.filter((name) => !beforeSet.has(name));
  const output = `${result.stdout}${result.stderr}`;

  process.stdout.write([
    `TMPDIR LEAK ROOT ${tempRoot}`,
    `TMPDIR LEAK COUNT BEFORE ${before.length}`,
    `TMPDIR LEAK COUNT AFTER ${after.length}`,
    `TMPDIR LEAK SURVIVORS ${survivors.length}`,
    suiteSummary(output),
    "",
  ].join("\n"));

  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, output);
  assert.deepEqual(survivors, [], `suite left temporary directories:\n${survivors.join("\n")}`);
});
