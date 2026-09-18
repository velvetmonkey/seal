// SPDX-License-Identifier: Apache-2.0
const assert = require("node:assert/strict");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");
const { checkWithdrawal } = require("../scripts/check-withdrawn-version.cjs");
const withdrawn = require("../scripts/withdrawn-versions.json");

test("committed product version is not withdrawn", () => {
  const result = spawnSync(process.execPath, [path.join(__dirname, "../scripts/check-withdrawn-version.cjs")], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /withdrawal check OK:/);
});

test("withdrawal gate rejects the recorded withdrawn release", () => {
  assert.throws(() => checkWithdrawal("0.2.0", withdrawn), /withdrawal check REFUSED: v0\.2\.0:/);
});

test("withdrawal gate compares exact identities", () => {
  for (const version of ["0.2.1", "0.4.0", "0.2.0-rc.1"]) {
    assert.match(checkWithdrawal(version, withdrawn), /withdrawal check OK:/);
  }
});

test("withdrawal gate fails closed on absent or malformed policy", () => {
  for (const record of [null, {}, [], [{ version: "0.2.0" }], [...withdrawn, ...withdrawn]]) {
    assert.throws(() => checkWithdrawal("0.4.0", record), /withdrawal check:/);
  }
  assert.throws(() => checkWithdrawal("", withdrawn), /VERSION is not exact SemVer/);
});
