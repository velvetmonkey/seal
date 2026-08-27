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
    // A link's label is what a reader sees; its destination is not.  Preserve
    // the former before removing URLs, so neither kind can manufacture a name.
    .replace(/\[([^\]]+)\]\([^\n)]*\)/gu, "$1")
    .replace(/<https?:\/\/[^>]+>/gu, "")
    .replace(/https?:\/\/[^\s)>\]]+/gu, "");
}

function sectionAt(text, position) {
  // A reader following an anchor sees that heading's section, not its H1 parent.
  const withoutCode = text.replace(/```[\s\S]*?```/gu, (block) => " ".repeat(block.length));
  const headings = [...withoutCode.matchAll(/^(#{1,6})\s+.*$/gmu)].map((heading) => ({
    index: heading.index,
    level: heading[1].length,
  }));
  let current;
  for (const heading of headings) {
    if (heading.index > position) break;
    current = heading;
  }
  if (!current) return text.slice(0, headings[0]?.index ?? text.length);
  const end = headings.find((heading) => heading.index > current.index && heading.level <= current.level)?.index ?? text.length;
  return text.slice(current.index, end);
}

function hasSourceBinding(section) {
  const visible = visibleText(section);
  // The label and direct copula are intentional: this is a reader-facing
  // declaration, not an inference from nearby words or a URL destination.
  return /^\s*(?:\*\*)?Lean\s+proof\s+source\s*:(?:\*\*)?\s*[^.\n]{0,100}\bseal-host\b[^.\n]{0,100}\bis\s+(?:a|an|the)\s+reader-facing\b[^.\n]{0,160}[.!]/imu.test(visible);
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

test("a binding is an affirmative declaration visible beside the claim", () => {
  assert.equal(hasSourceBinding("**Lean proof source:** seal-host is the reader-facing atlas for this claim."), true);
  assert.equal(hasSourceBinding("The proof source is not seal-host."), false);
  assert.equal(hasSourceBinding("**Lean proof source:** seal-host may become the reader-facing atlas."), false);
});

test("a nested heading starts a new reader-visible claim section", () => {
  const text = "# Overview\n\n**Lean proof source:** seal-host is the reader-facing atlas.\n\n## Deep claim\n\nThe gate is proven in Lean 4.";
  const claim = [...text.matchAll(LEAN_PROOF_PROPERTY)][0];
  assert.equal(hasSourceBinding(sectionAt(text, claim.index)), false);
});

test("visible text keeps an honest link label but discards a bare URL", () => {
  assert.equal(hasSourceBinding("**Lean proof source:** [seal-host](https://github.com/velvetmonkey/seal-host/) is the reader-facing atlas."), true);
  assert.equal(hasSourceBinding("**Lean proof source:** https://github.com/velvetmonkey/seal-host/ is the reader-facing atlas."), false);
});
