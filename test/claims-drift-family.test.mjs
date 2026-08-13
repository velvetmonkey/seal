import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";
import test from "node:test";
import { resolve } from "node:path";
const ROOT = resolve(import.meta.dirname, "..");
const repositories = ["seal", "seal-check", "seal-demo", "seal-live-demo", "seal-verify-action", "seal-assurance-kit", "mcp-seal-dev"];
const env = { ...process.env, FAMILY_CLAIMS_ROOTS: repositories.map((name) => `${name}=/home/monkey/wt/family1-${name}`).join(";") };
test("family shared-region comparator accepts configuration differences", () => {
  const run = spawnSync(process.execPath, ["scripts/claims-drift-family.mjs"], { cwd: ROOT, env, encoding: "utf8" });
  assert.equal(run.status, 0, run.stdout + run.stderr);
});

