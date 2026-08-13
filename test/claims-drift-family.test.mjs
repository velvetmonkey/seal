import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";
import test from "node:test";
import { resolve } from "node:path";
const ROOT = resolve(import.meta.dirname, "..");
test("family shared-region comparator accepts configuration differences", () => {
  const run = spawnSync(process.execPath, ["scripts/claims-drift-family.mjs"], { cwd: ROOT, encoding: "utf8" });
  assert.equal(run.status, 0, run.stdout + run.stderr);
});
