// SPDX-License-Identifier: Apache-2.0
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const { join } = require("node:path");
const test = require("node:test");

const ROOT = join(__dirname, "..");
const SCRIPT = join(ROOT, "scripts", "check-dist-payload-completeness.cjs");

test("distribution payload contains every installed-store file required by consumers", () => {
  const out = execFileSync(process.execPath, [SCRIPT], { cwd: ROOT, encoding: "utf8" });
  assert.match(out, /PASS dist payload includes/);
  assert.match(out, /checker\/seal-receipt-check\.mjs/);
});
