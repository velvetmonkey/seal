import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { resolve, join } from "node:path";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import test from "node:test";

const ROOT = resolve(import.meta.dirname, "..");
const GUARD = resolve(ROOT, "scripts/claim-bearing-file-inventory.mjs");

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

test("mandatory wording fixture pins exact approved sentences and names unseen sentences", () => {
  const worktree = mkdtempSync(join(tmpdir(), "seal-mandatory-claims-"));
  const sentence = (stem) => stem + String.fromCharCode(46);
  const readmeBaseline = sentence("Seal handles the baseline request");
  const guideBaseline = sentence("Seal records the baseline decision");
  const readmeBound = sentence("Seal refuses an identical replay after one approval is consumed");
  const guideBound = sentence("Seal writes signed receipts for the demo's guarded decisions");
  const readmeUnbound = sentence("Seal vaporizes every approval ledger at sunrise");
  const guideUnbound = sentence("Seal fabricates a second executed call whenever the moon is visible");
  try {
    mkdirSync(join(worktree, "scripts"));
    mkdirSync(join(worktree, "docs/guide"), { recursive: true });
    writeFileSync(join(worktree, "scripts", "claim-bearing-file-inventory.mjs"), readFileSync(GUARD));
    writeFileSync(join(worktree, "proof.test.mjs"), [
      "// CLAIM-COVERAGE: README.md",
      "// CLAIM-COVERAGE: docs/guide/knowing-it-worked.md",
    ].join("\n"));
    writeFileSync(join(worktree, "scripts", "claim-bearing-files.json"), JSON.stringify({ files: {
      "README.md": { coveredBy: ["proof.test.mjs:1"] },
      "docs/guide/knowing-it-worked.md": { coveredBy: ["proof.test.mjs:2"] },
      "scripts/mandatory-doc-claim-bindings.json": { allowlistReason: "test metadata" },
    } }));
    const writeBindings = () => writeFileSync(join(worktree, "scripts", "mandatory-doc-claim-bindings.json"), JSON.stringify({
      version: 1,
      baselineSentences: {
        "README.md": [readmeBaseline],
        "docs/guide/knowing-it-worked.md": [guideBaseline],
      },
      files: {
        "README.md": [{ sentence: readmeBound, proof: "proof.test.mjs:1" }],
        "docs/guide/knowing-it-worked.md": [{ sentence: guideBound, proof: "proof.test.mjs:2" }],
      },
    }));
    writeBindings();
    writeFileSync(join(worktree, "README.md"), `${readmeBaseline}\n${readmeBound}\n${readmeUnbound}\n`);
    writeFileSync(join(worktree, "docs/guide/knowing-it-worked.md"), `${guideBaseline}\n${guideBound}\n${guideUnbound}\n`);
    spawnSync("git", ["init", "-q"], { cwd: worktree });
    spawnSync("git", ["add", "."], { cwd: worktree });

    const negative = spawnSync(process.execPath, ["scripts/claim-bearing-file-inventory.mjs"], { cwd: worktree, encoding: "utf8" });
    assert.equal(negative.status, 1, negative.stdout + negative.stderr);
    assert.match(negative.stderr, new RegExp(`README\\.md: unbound claim sentence: ${readmeUnbound.replace(".", "\\.")}`));
    assert.match(negative.stderr, new RegExp(`docs/guide/knowing-it-worked\\.md: unbound claim sentence: ${guideUnbound.replace(".", "\\.")}`));

    writeFileSync(join(worktree, "README.md"), `${readmeBaseline}\n${readmeBound}\n`);
    writeFileSync(join(worktree, "docs/guide/knowing-it-worked.md"), `${guideBaseline}\n${guideBound}\n`);
    const positive = spawnSync(process.execPath, ["scripts/claim-bearing-file-inventory.mjs"], { cwd: worktree, encoding: "utf8" });
    assert.equal(positive.status, 0, positive.stdout + positive.stderr);
    assert.match(positive.stdout, /MANDATORY WORDING FIXTURE: pinned=2; compares exact approved sentence strings, not meaning or claim truth/);
  } finally {
    rmSync(worktree, { recursive: true, force: true });
  }
});
