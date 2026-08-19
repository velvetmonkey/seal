import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { resolve, join } from "node:path";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import test from "node:test";
import { createRequire } from "node:module";
const { tmpdir: makeTmp, track } = createRequire(import.meta.url)("../test-support/tmpdir.cjs");

const ROOT = resolve(import.meta.dirname, "..");
const GUARD = resolve(ROOT, "scripts/claim-bearing-file-inventory.mjs");

test("README is classified as claim-bearing, including the hosted seal-check behaviour claims", () => {
  const result = spawnSync(process.execPath, [GUARD], { cwd: ROOT, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^README\.md\tCOVERED by /m);
  const worktree = makeTmp("seal-claim-inventory-");
  try {
    mkdirSync(join(worktree, "scripts"));
    writeFileSync(join(worktree, "scripts", "claim-bearing-file-inventory.mjs"), readFileSync(GUARD));
    writeFileSync(join(worktree, "scripts", "claim-bearing-files.json"), '{"files":{}}\n');
    writeFileSync(join(worktree, "novel.md"), "Seal calibrates every satellite relay before dawn.\n");
    spawnSync("git", ["init", "-q"], { cwd: worktree });
    spawnSync("git", ["add", "."], { cwd: worktree });
    const result = spawnSync(process.execPath, ["scripts/claim-bearing-file-inventory.mjs"], { cwd: worktree, encoding: "utf8" });
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /novel\.md: new claim-bearing file is neither covered nor allowlisted/);
  } finally {
    rmSync(worktree, { recursive: true, force: true });
  }
});

test("a bare contextual component reference remains outside the subject-keyed rule", () => {
  const worktree = makeTmp("seal-claim-inventory-bare-");
  try {
    mkdirSync(join(worktree, "scripts"));
    writeFileSync(join(worktree, "scripts", "claim-bearing-file-inventory.mjs"), readFileSync(GUARD));
    writeFileSync(join(worktree, "scripts", "claim-bearing-files.json"), '{"files":{}}\n');
    writeFileSync(join(worktree, "context.md"), "The kernel calibrates the receipt clock before evaluation.\n");
    spawnSync("git", ["init", "-q"], { cwd: worktree });
    spawnSync("git", ["add", "."], { cwd: worktree });
    const result = spawnSync(process.execPath, ["scripts/claim-bearing-file-inventory.mjs"], { cwd: worktree, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    assert.doesNotMatch(result.stdout, /^context\.md\t/m);
  } finally {
    rmSync(worktree, { recursive: true, force: true });
  }
});
