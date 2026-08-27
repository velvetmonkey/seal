// SPDX-License-Identifier: Apache-2.0
const assert = require("node:assert/strict");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const ROOT = path.join(__dirname, "..");

test("captured producer receipt facts remain frozen", () => { // CLAIM-COVERAGE: conformance/receipt-vectors/producer-baseline-610bf01d.json
  const result = spawnSync(process.execPath, [path.join(ROOT, "scripts", "check-receipt-vectors.mjs")], {
    cwd: ROOT,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /PASS receipt conformance vectors \(producer-baseline-610bf01d\)/);
});
