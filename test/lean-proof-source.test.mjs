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

function proseText(text) {
  return visibleText(text)
    .replace(/[*_`]/gu, "")
    // Headings are reader-visible boundaries, not prefixes to the first prose
    // sentence beneath them (which may itself contain a negation).
    .replace(/^(?:#{1,6}\s+.*)$/gmu, "$&.\n")
    .replace(/\s+/gu, " ")
    .trim();
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
  const visible = proseText(section);
  const sentences = visible.split(/(?<=[.!?])\s+/u);
  return sentences.some((sentence) => {
    if (!/\bseal-host\b/iu.test(sentence) || /\b(?:not|no|never|without|may|might|could|would|should)\b/iu.test(sentence)) return false;

    // A named proof-source label is itself an affirmative declaration.  The
    // remaining productions cover ordinary prose, in either word order.
    return /\bLean\s+proof\s+source\s*:\s*[^.!?]{0,180}\bseal-host\b/iu.test(sentence)
      || /\bseal-host\b\s+(?:is|remains|serves\s+as)\s+(?:(?:a|an|the|our|this|that)\s+)?(?:reader-facing\s+)?(?:Lean\s+)?(?:proof\s+)?(?:source|index|atlas)\b/iu.test(sentence)
      || /\b(?:Lean\s+)?(?:theorems?|proofs?|proof\s+(?:source|index|properties?))\b[^.!?]{0,120}\b(?:(?:live|reside)\s+in|are\s+(?:held\s+)?(?:in|at)|come\s+from)\s+(?:the\s+)?\bseal-host\b/iu.test(sentence)
      || /\bseal-host\b\s+(?:holds|contains|hosts)\s+(?:the\s+)?(?:Lean\s+)?(?:theorems?|proofs?)\b/iu.test(sentence);
  });
}

function sentenceAt(text, position) {
  const start = Math.max(text.lastIndexOf("\n", position), text.lastIndexOf(".", position), text.lastIndexOf("!", position), text.lastIndexOf("?", position)) + 1;
  const rest = text.slice(position);
  const endMatch = /[.!?\n]/u.exec(rest);
  return text.slice(start, endMatch ? position + endMatch.index + 1 : text.length);
}

function isDeniedClaim(text, claim) {
  return /\b(?:not|no|never|without)\b/iu.test(sentenceAt(text, claim.index));
}

function hasUnsourcedClaims(text) {
  LEAN_PROOF_PROPERTY.lastIndex = 0;
  const claims = [...text.matchAll(LEAN_PROOF_PROPERTY)];
  return claims.some((claim) => !isDeniedClaim(text, claim) && !hasSourceBinding(sectionAt(text, claim.index)));
}

function unsourcedClaims(file) {
  const text = readFileSync(resolve(ROOT, file), "utf8");
  return hasUnsourcedClaims(text);
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

test("tamper: direct source declaration passes", () => {
  assert.equal(hasSourceBinding("Lean proof source: seal-host."), true);
});

test("tamper: theorem-location declaration passes", () => {
  assert.equal(hasSourceBinding("The Lean theorems for this claim live in [seal-host](https://github.com/velvetmonkey/seal-host/)."), true);
});

test("tamper: source label with theorem holder passes", () => {
  assert.equal(hasSourceBinding("Lean proof source: [seal-host](https://github.com/velvetmonkey/seal-host/) holds the theorems for this claim."), true);
});

test("tamper: possessive proof-index declaration and list item pass", () => {
  assert.equal(hasSourceBinding("seal-host is our reader-facing proof index."), true);
  assert.equal(hasSourceBinding("- **Lean proof source:** seal-host is the reader-facing atlas."), true);
});

test("tamper: wrapped multi-line declaration passes", () => {
  assert.equal(hasSourceBinding("**Lean proof source:** [seal-host](https://github.com/velvetmonkey/seal-host/) is the reader-facing\nindex for this claim."), true);
});

test("tamper: negated source declaration fails", () => {
  assert.equal(hasSourceBinding("The proof source is not seal-host."), false);
  assert.equal(hasSourceBinding("**Lean proof source:** seal-host may become the reader-facing atlas."), false);
});

test("a nested heading starts a new reader-visible claim section", () => {
  const text = "# Overview\n\n**Lean proof source:** seal-host is the reader-facing atlas.\n\n## Deep claim\n\nThe gate is proven in Lean 4.";
  const claim = [...text.matchAll(LEAN_PROOF_PROPERTY)][0];
  assert.equal(hasSourceBinding(sectionAt(text, claim.index)), false);
});

test("tamper: bare URL without a declaration fails", () => {
  assert.equal(hasSourceBinding("https://github.com/velvetmonkey/seal-host/"), false);
});

test("a denial is not a proof-property claim, but an unsourced affirmative claim fails", () => {
  assert.equal(hasUnsourcedClaims("## UNVERIFIED\n\nThe state machine has no machine-checked model in the seal-host Lean kernel."), false);
  assert.equal(hasUnsourcedClaims("## Claim\n\nThe gate is proven in Lean 4."), true);
});
