import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import test from "node:test";

const ROOT = resolve(import.meta.dirname, "..");
const SOURCE_HOLDER = "seal-host";
// Keep this semantic family broad: a new phrasing must be sourced too.
const LEAN_PROOF_PROPERTY = /(?:\b(?:proved|proven|verified)\b[\s\S]{0,180}\bLean(?:\s+\d+)?\b|\bLean(?:\s+\d+)?\b[\s\S]{0,180}\b(?:theorems?|proofs?|proved|proven|verified|machine[- ]checked)\b|\bmachine[- ]checked\b[\s\S]{0,180}\b(?:Lean|theorems?|proofs?|property)\b)/iu;

function documentationFiles() {
  return execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z", "--", "docs"],
    { cwd: ROOT, encoding: "utf8" },
  )
    .split("\0")
    .filter(Boolean)
    .filter((file) => !file.startsWith("docs/archive/"))
    .filter((file) => /\.(?:md|mdx|html)$/iu.test(file));
}

test("every live Lean proof-property document names seal-host as its source holder", () => {
  const unsourced = documentationFiles().filter((file) => {
    const text = readFileSync(resolve(ROOT, file), "utf8");
    return LEAN_PROOF_PROPERTY.test(text) && !text.includes(SOURCE_HOLDER);
  });

  assert.deepEqual(
    unsourced,
    [],
    `Lean proof-property documentation must name ${SOURCE_HOLDER} as the Lean source holder: ${unsourced.join(", ")}`,
  );
});

test("the proof-property predicate catches novel wording", () => {
  const novel = "The zygomorphic decision property is machine-checked by Lean calculus.";
  assert.equal(LEAN_PROOF_PROPERTY.test(novel), true, relative(ROOT, "docs/assurance/scratch-tamper.md"));
});
