import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";
import test from "node:test";
import { resolve } from "node:path";
const ROOT = resolve(import.meta.dirname, "..");
test("family shared-region comparator accepts configuration differences", () => {
  const run = spawnSync(process.execPath, ["scripts/claims-drift-family.mjs"], { cwd: ROOT, encoding: "utf8" });
  assert.equal(run.status, 0, run.stdout + run.stderr);
  assert.match(run.stdout, /INFO  this run compared the local claim block only; cross-repository comparison requires FAMILY_CLAIMS_LIVE=1 and did not run/);
  assert.match(run.stdout, /PASS  seal shared claims-drift hash [0-9a-f]{64} matches recorded seal reference/);
});
