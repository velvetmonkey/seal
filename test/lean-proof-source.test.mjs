import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import test from "node:test";

const ROOT = resolve(import.meta.dirname, "..");
const SOURCE_HOLDER = "seal-host";
const DOCUMENTATION_FILE = /\.(?:md|mdx|html)$/iu;
// Keep this semantic family broad: a new phrasing must be sourced too.
const LEAN_PROOF_PROPERTY_SOURCE = String.raw`(?:\b(?:proved|proven|verified)\b[\s\S]{0,180}\bLean(?:\s+\d+)?\b|\bLean(?:\s+\d+)?\b[\s\S]{0,180}\b(?:theorems?|proofs?|proved|proven|verified|machine[- ]checked)\b|\bmachine[- ]checked\b[\s\S]{0,180}\b(?:Lean|theorems?|proofs?|property)\b)`;

function leanProofProperty() {
  // The global matcher is intentionally new for each scan: its lastIndex is
  // mutable, so sharing one between callers would make a later scan partial.
  return new RegExp(LEAN_PROOF_PROPERTY_SOURCE, "giu");
}

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
  if (/\b(?:does\s+not|did\s+not|cannot|can['’]t|never)\s+(?:name|identify|provide)\b[^.!?]{0,80}\bproof\s+source\b/iu.test(visible)) return false;
  return sentences.some((sentence) => {
    if (!/\bseal-host\b/iu.test(sentence) || /\b(?:not|no|never|without|hardly|false|may|might|could|would|should|was|were|will\s+be|fails\s+to|removed)\b|\bisn['’]t\b/iu.test(sentence)) return false;

    // A named proof-source label is itself an affirmative declaration.  The
    // remaining productions cover ordinary prose, in either word order.
    return /\bLean\s+proof\s+source\s*:\s*(?:the\s+)?\bseal-host\b\s*[.!?]$/iu.test(sentence)
      || /\bLean\s+proof\s+source\s*:\s*[^.!?]{0,120}\breader-facing\s+(?:Lean\s+)?(?:proof\s+)?(?:index|atlas)\b/iu.test(sentence)
      || /\bseal-host\b\s+is\s+(?:(?:a|an|the|our|this|that)\s+)?reader-facing\s+(?:Lean\s+)?(?:proof\s+)?(?:index|atlas)\b/iu.test(sentence)
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

function claimIndex(match) {
  // A property match may begin with a nearby source declaration.  Attribute it
  // to the assertion word itself, which can be under a later heading.
  const assertion = /\b(?:proved|proven|verified|machine[- ]checked)\b/iu.exec(match[0]);
  return match.index + (assertion?.index ?? 0);
}

function hasUnsourcedClaims(text) {
  const claims = [...text.matchAll(leanProofProperty())];
  return claims.some((claim) => {
    const attributedClaim = { ...claim, index: claimIndex(claim) };
    return !isDeniedClaim(text, attributedClaim) && !hasSourceBinding(sectionAt(text, attributedClaim.index));
  });
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
  assert.equal(hasUnsourcedClaims(novel), true, relative(ROOT, "docs/assurance/scratch-tamper.md"));
});

test("tamper: direct source declaration passes", () => {
  assert.equal(hasUnsourcedClaims("The gate is proven in Lean 4. Lean proof source: seal-host."), false);
});

test("tamper: theorem-location declaration passes", () => {
  assert.equal(hasUnsourcedClaims("The gate is proven in Lean 4. The Lean theorems for this claim live in [seal-host](https://github.com/velvetmonkey/seal-host/)."), false);
});

test("tamper: source label with theorem holder passes", () => {
  assert.equal(hasUnsourcedClaims("The gate is proven in Lean 4. Lean proof source: [seal-host](https://github.com/velvetmonkey/seal-host/) holds the theorems for this claim."), false);
});

test("tamper: possessive proof-index declaration and list item pass", () => {
  assert.equal(hasUnsourcedClaims("The gate is proven in Lean 4. seal-host is our reader-facing proof index."), false);
  assert.equal(hasUnsourcedClaims("The gate is proven in Lean 4. - **Lean proof source:** seal-host is the reader-facing atlas."), false);
});

test("tamper: wrapped multi-line declaration passes", () => {
  assert.equal(hasUnsourcedClaims("The gate is proven in Lean 4. **Lean proof source:** [seal-host](https://github.com/velvetmonkey/seal-host/) is the reader-facing\nindex for this claim."), false);
});

test("tamper: negated source declaration fails", () => {
  for (const declaration of [
    "Lean proof source: seal-host is hardly the reader-facing atlas.",
    "Lean proof source: seal-host fails to be the reader-facing atlas.",
    "Lean proof source: we removed seal-host.",
    "This page does not name a proof source. Lean proof source: seal-host is the reader-facing atlas.",
    "Lean proof source: seal-host isn't the reader-facing atlas.",
    "Lean proof source: seal-host was the reader-facing atlas.",
    "Lean proof source: seal-host will be the reader-facing atlas.",
    "Lean proof source: it is false that seal-host is the reader-facing destination for this claim.",
  ]) assert.equal(hasUnsourcedClaims(`The gate is proven in Lean 4. ${declaration}`), true, declaration);
});

test("a nested heading starts a new reader-visible claim section", () => {
  const text = "# Overview\n\n**Lean proof source:** seal-host is the reader-facing atlas.\n\n## Deep claim\n\nThe gate is proven in Lean 4.";
  assert.equal(hasUnsourcedClaims(text), true);
});

test("tamper: bare URL without a declaration fails", () => {
  assert.equal(hasUnsourcedClaims("The gate is proven in Lean 4. https://github.com/velvetmonkey/seal-host/"), true);
});

test("entry-point scans have no shared regex state", () => {
  const unsourced = "## Claim\n\nThe gate is proven in Lean 4.";
  assert.equal(hasUnsourcedClaims(unsourced), true);
  assert.equal(hasUnsourcedClaims(unsourced), true);
  assert.equal(hasUnsourcedClaims("The zygomorphic decision property is machine-checked by Lean calculus."), true);
  assert.equal(hasUnsourcedClaims(unsourced), true);
});

test("a denial is not a proof-property claim, but an unsourced affirmative claim fails", () => {
  assert.equal(hasUnsourcedClaims("## UNVERIFIED\n\nThe state machine has no machine-checked model in the seal-host Lean kernel."), false);
  assert.equal(hasUnsourcedClaims("## Claim\n\nThe gate is proven in Lean 4."), true);
});
