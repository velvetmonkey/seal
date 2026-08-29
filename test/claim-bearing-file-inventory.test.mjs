import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { resolve, join } from "node:path";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import test from "node:test";

const ROOT = resolve(import.meta.dirname, "..");
const GUARD = resolve(ROOT, "scripts/claim-bearing-file-inventory.mjs");
const ARTIFACT_ROOT = process.env.SEAL_MARKERPIN_ARTIFACT_ROOT
  ?? process.env.RUNNER_TEMP
  ?? tmpdir();

test("README is classified as claim-bearing, including the hosted seal-check behaviour claims", () => {
  const result = spawnSync(process.execPath, [GUARD], { cwd: ROOT, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^README\.md\tCOVERED by /m);
  const worktree = mkdtempSync(join(tmpdir(), "seal-claim-inventory-"));
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
  const worktree = mkdtempSync(join(tmpdir(), "seal-claim-inventory-bare-"));
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

test("a coveredBy marker must exist in the cited proof file", () => {
  mkdirSync(ARTIFACT_ROOT, { recursive: true });
  const worktree = mkdtempSync(join(ARTIFACT_ROOT, "inventory-marker-"));
  try {
    mkdirSync(join(worktree, "scripts"));
    mkdirSync(join(worktree, "test"));
    writeFileSync(join(worktree, "scripts", "claim-bearing-file-inventory.mjs"), readFileSync(GUARD));
    writeFileSync(join(worktree, "scripts", "claim-bearing-files.json"), JSON.stringify({
      files: {
        "fixture.md": { coveredBy: ["test/proof.mjs#missing-marker"] },
      },
    }) + "\n");
    writeFileSync(join(worktree, "fixture.md"), "Seal works reliably.\n");
    writeFileSync(join(worktree, "test", "proof.mjs"), "// This proof has no matching coverage marker.\n");
    assert.equal(spawnSync("git", ["init", "-q"], { cwd: worktree }).status, 0);
    assert.equal(spawnSync("git", ["add", "."], { cwd: worktree }).status, 0);

    const result = spawnSync(process.execPath, ["scripts/claim-bearing-file-inventory.mjs"], {
      cwd: worktree,
      encoding: "utf8",
    });
    assert.notEqual(result.status, 0, result.stderr);
    assert.match(result.stderr, /fixture\.md/);
    assert.match(result.stderr, /test\/proof\.mjs/);
    assert.match(result.stderr, /missing-marker/);
  } finally {
    rmSync(worktree, { recursive: true, force: true });
  }
});
