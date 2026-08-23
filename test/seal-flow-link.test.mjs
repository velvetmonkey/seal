// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import test from "node:test";

const ROOT = resolve(import.meta.dirname, "..");
const GUARD = resolve(ROOT, "scripts/check-seal-flow-link.mjs");

test("README uses the terminal approval capture instead of the SVG", () => {
  const result = spawnSync(process.execPath, [GUARD], { cwd: ROOT, encoding: "utf8" });
  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
  assert.match(result.stdout, /PASS  README uses the terminal approval capture/);
});
