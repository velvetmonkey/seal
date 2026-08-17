import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import test from "node:test";

const ROOT = resolve(import.meta.dirname, "..");
const GUARD = resolve(ROOT, "scripts/claim-bearing-file-inventory.mjs");

test("README is classified as claim-bearing, including the hosted seal-check behaviour claims", () => {
  const result = spawnSync(process.execPath, [GUARD], { cwd: ROOT, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^README\.md\tCOVERED by /m);
});
