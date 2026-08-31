import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { resolve, join } from "node:path";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import test from "node:test";
import tempRoot from "../scripts/temp-root.cjs";
const { testTmpdir } = tempRoot;

const ROOT = resolve(import.meta.dirname, "..");
const GUARD = resolve(ROOT, "scripts/claim-bearing-file-inventory.mjs");
const ARTIFACT_ROOT = process.env.RUNNER_TEMP ?? tmpdir();
const HERMETIC_GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_EMAIL: "seal-test@example.invalid",
  GIT_COMMITTER_EMAIL: "seal-test@example.invalid",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
};

test("README is classified as claim-bearing, including the hosted seal-check behaviour claims", () => {
  const result = spawnSync(process.execPath, [GUARD], { cwd: ROOT, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^README\.md\tCOVERED by /m);
  const worktree = testTmpdir(join(tmpdir(), "seal-claim-inventory-"));
  try {
    mkdirSync(join(worktree, "scripts"));
    writeFileSync(join(worktree, "scripts", "claim-bearing-file-inventory.mjs"), readFileSync(GUARD));
    writeFileSync(join(worktree, "scripts", "claim-bearing-files.json"), '{"files":{}}\n');
    writeFileSync(join(worktree, "novel.md"), "Seal calibrates every satellite relay before dawn.\n");
    spawnSync("git", ["init", "-q"], { cwd: worktree, env: HERMETIC_GIT_ENV });
    spawnSync("git", ["add", "."], { cwd: worktree, env: HERMETIC_GIT_ENV });
    const result = spawnSync(process.execPath, ["scripts/claim-bearing-file-inventory.mjs"], { cwd: worktree, encoding: "utf8" });
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /novel\.md: new claim-bearing file is neither covered nor allowlisted/);
  } finally {
    rmSync(worktree, { recursive: true, force: true });
  }
});

test("a bare contextual component reference remains outside the subject-keyed rule", () => {
  const worktree = testTmpdir(join(tmpdir(), "seal-claim-inventory-bare-"));
  try {
    mkdirSync(join(worktree, "scripts"));
    writeFileSync(join(worktree, "scripts", "claim-bearing-file-inventory.mjs"), readFileSync(GUARD));
    writeFileSync(join(worktree, "scripts", "claim-bearing-files.json"), '{"files":{}}\n');
    writeFileSync(join(worktree, "context.md"), "The kernel calibrates the receipt clock before evaluation.\n");
    spawnSync("git", ["init", "-q"], { cwd: worktree, env: HERMETIC_GIT_ENV });
    spawnSync("git", ["add", "."], { cwd: worktree, env: HERMETIC_GIT_ENV });
    const result = spawnSync(process.execPath, ["scripts/claim-bearing-file-inventory.mjs"], { cwd: worktree, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    assert.doesNotMatch(result.stdout, /^context\.md\t/m);
  } finally {
    rmSync(worktree, { recursive: true, force: true });
  }
});

test("a coveredBy marker must exist in the cited proof file", () => {
  mkdirSync(ARTIFACT_ROOT, { recursive: true });
  const worktree = testTmpdir(join(ARTIFACT_ROOT, "inventory-marker-"));
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
    assert.equal(spawnSync("git", ["init", "-q"], { cwd: worktree, env: HERMETIC_GIT_ENV }).status, 0);
    assert.equal(spawnSync("git", ["add", "."], { cwd: worktree, env: HERMETIC_GIT_ENV }).status, 0);

    const result = spawnSync(process.execPath, ["scripts/claim-bearing-file-inventory.mjs"], {
      cwd: worktree,
      encoding: "utf8",
    });
    assert.notEqual(result.status, 0, result.stderr);
    // This asserts the exact FAIL line is emitted, anchored to a whole line.
    // It does not assert no other output. This line and a contradicting line would pass.
    // The anchors exist because an unanchored match accepted a reversing prefix.
    // The remaining gap needs a deliberate product edit. That editor can delete this test.
    assert.match(result.stderr, /^FAIL  fixture\.md: coveredBy "test\/proof\.mjs#missing-marker" marker missing-marker in test\/proof\.mjs does not bind CLAIM-COVERAGE: fixture\.md$/m);
  } finally {
    rmSync(worktree, { recursive: true, force: true });
  }
});
