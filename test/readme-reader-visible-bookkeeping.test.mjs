// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const ROOT = resolve(import.meta.dirname, "..");
const GUARD = join(ROOT, "scripts", "readme-reader-visible-bookkeeping-guard.mjs");
const README = join(ROOT, "README.md");

function run(readme) {
  return spawnSync(process.execPath, [GUARD], {
    cwd: ROOT,
    encoding: "utf8",
    env: { ...process.env, SEAL_READER_README: readme },
  });
}

test("README renders no repository guard-scoping bookkeeping", () => {
  const result = run(README);
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

test("reader-visible guard-scoping prose is refused regardless of its subject", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "seal-reader-visible-bookkeeping-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const fixture = join(directory, "README.md");
  writeFileSync(fixture, `${readFileSync(README, "utf8")}\nScope of the deployment verifier guard: it checks an internal manifest.\n`);
  const result = run(fixture);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stderr, /reader-visible guard bookkeeping/);
});
