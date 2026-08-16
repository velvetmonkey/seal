// The guide's refusal-token inventory is not enough: it says nothing about
// the explanatory claims beneath a token. These reviewed sentences are the
// claims currently established for the two sections whose wording was
// corrected. A sentence added to either section must be reviewed here first;
// each listed sentence must also remain in its reviewed section.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");

const REVIEWED_CLAIMS = [
  {
    file: "docs/guide/when-something-looks-wrong.md",
    heading: "### `spine_receipt_use_separate_checker`",
    sentences: [
      "You pointed `seal verify` at one of the gate's own receipts.",
      "The format is recognized, but this binary does not verify its own receipts; the message hands you the separate checker command to run instead.",
      "Use that checker to learn whether the receipt is valid.",
    ],
  },
  {
    file: "docs/guide/what-is-protected-right-now.md",
    anchor: "One honest wrinkle:",
    sentences: [
      "One honest wrinkle: `seal verify` can leave a *kernel* receipt (a different format) in the same directory, and `seal status` then prints `Receipt unreadable: … (missing decision or receipt time)` for it.",
      "That line means only that this listing does not parse the kernel format; use `seal verify` to check a named kernel receipt.",
    ],
  },
];

function sectionText(text, heading, anchor) {
  const marker = anchor || (heading.startsWith("### ") ? heading : `## ${heading}`);
  const start = text.indexOf(marker);
  assert.notEqual(start, -1, `guide heading missing: ${marker}`);
  const rest = text.slice(start + (anchor ? 0 : marker.length));
  const end = rest.search(/^#{1,2} /m);
  return (end === -1 ? rest : rest.slice(0, end)).trim();
}

function sentences(text) {
  return text.replace(/\s+/g, " ").split(/(?<=[.!?])\s+(?=[A-Z`])/).map((sentence) => sentence.trim()).filter(Boolean);
}

test("reviewed guide sections reject unreviewed explanatory claims", () => {
  const unreviewed = [];
  const missing = [];
  for (const entry of REVIEWED_CLAIMS) {
    const text = readFileSync(resolve(ROOT, entry.file), "utf8");
    const section = sentences(sectionText(text, entry.heading, entry.anchor));
    for (const sentence of section) {
      if (!entry.sentences.includes(sentence)) {
        unreviewed.push(`${entry.file} (${entry.heading}): ${sentence}`);
      }
    }
    for (const sentence of entry.sentences) {
      if (!section.includes(sentence)) {
        missing.push(`${entry.file} (${entry.heading || entry.anchor}): ${sentence}`);
      }
    }
  }
  assert.deepEqual(unreviewed, [], "guide claims present but unreviewed:\n" + unreviewed.join("\n"));
  assert.deepEqual(missing, [], "reviewed guide claims missing from section:\n" + missing.join("\n"));
});
