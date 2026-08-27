import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import test from "node:test";

const ROOT = resolve(import.meta.dirname, "..");
const SOURCE_HOLDER = "seal-host";
const DOCUMENTATION_FILE = /\.(?:md|mdx|html)$/iu;
// Keep this semantic family broad: a new phrasing must be sourced too.
const LEAN_PROOF_PROPERTY = /(?:\b(?:proved|proven|verified)\b[\s\S]{0,180}\bLean(?:\s+\d+)?\b|\bLean(?:\s+\d+)?\b[\s\S]{0,180}\b(?:theorems?|proofs?|proved|proven|verified|machine[- ]checked)\b|\bmachine[- ]checked\b[\s\S]{0,180}\b(?:Lean|theorems?|proofs?|property)\b)/giu;

function git(args) {
  return execFileSync("git", args, { cwd: ROOT, encoding: "utf8" });
}

function documentationFiles(revision) {
  const args = revision
    ? ["ls-tree", "-r", "-z", "--name-only", revision]
    : ["ls-files", "-z"];
  return git(args)
    .split("\0")
    .filter(Boolean)
    .filter((file) => DOCUMENTATION_FILE.test(file));
}

function mergeBase() {
  return git(["merge-base", "HEAD", "origin/main"]).trim();
}

function visibleText(text) {
  return text
    .replace(/<!--[\s\S]*?-->/gu, "")
    .replace(/https?:\/\/[^\s)>\]]+/gu, "");
}

function sectionAt(text, position) {
  // A document's H1 section is its reader-visible source declaration scope.
  // Nested headings organise claims; they do not silently replace that declaration.
  const withoutCode = text.replace(/```[\s\S]*?```/gu, (block) => " ".repeat(block.length));
  const headings = [...withoutCode.matchAll(/^#\s+.*$/gmu)];
  let start = 0;
  for (const heading of headings) {
    if (heading.index > position) break;
    start = heading.index;
  }
  const end = headings.find((heading) => heading.index > position)?.index ?? text.length;
  return text.slice(start, end);
}

function hasSourceBinding(section) {
  const visible = visibleText(section);
  return /\b(?:Lean\s+(?:proof\s+)?source|proof\s+source|source\s+holder)\b[^.\n]{0,120}\bseal-host\b/iu.test(visible)
    || /\bLean\s+proof\s+propert(?:y|ies)\b[^.]{0,120}\bsource\s+held\b[^.]{0,120}\bseal-host\b/iu.test(visible)
    || /\bseal-host\b[^.\n]{0,120}\b(?:holds?|hosts?|contains?)\b[^.\n]{0,80}\bLean\s+(?:proof\s+)?source\b/iu.test(visible)
    || /\bseal-host\b[^.\n]{0,120}\b(?:repository|repo)\b[^.\n]{0,80}\b(?:holds?|holding)\b[^.\n]{0,80}\bLean\s+(?:proof\s+)?source\b/iu.test(visible)
    || /\bseal-host\b[^.\n]{0,80}\bLean\s+kernel\b/iu.test(visible);
}

function unsourcedClaims(file) {
  const text = readFileSync(resolve(ROOT, file), "utf8");
  const claims = [...text.matchAll(LEAN_PROOF_PROPERTY)];
  return claims.some((claim) => !hasSourceBinding(sectionAt(text, claim.index)));
}

test("every tracked Lean proof-property document binds its claim to seal-host", () => {
  const unsourced = documentationFiles().filter(unsourcedClaims);
  assert.deepEqual(
    unsourced,
    [],
    `Lean proof-property documentation must bind each claim to ${SOURCE_HOLDER} as its Lean source holder: ${unsourced.join(", ")}`,
  );
});

test("no documentation path leaves the merge-base population", () => {
  const baseline = documentationFiles(mergeBase());
  const current = new Set(documentationFiles());
  const left = baseline.filter((file) => !current.has(file));
  assert.deepEqual(left, [], `documentation paths removed since merge-base: ${left.join(", ")}`);
});

test("the proof-property predicate catches novel wording", () => {
  const novel = "The zygomorphic decision property is machine-checked by Lean calculus.";
  assert.equal(LEAN_PROOF_PROPERTY.test(novel), true, relative(ROOT, "docs/assurance/scratch-tamper.md"));
});
