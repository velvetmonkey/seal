// The guide's refusal-token inventory is not enough: it says nothing about
// the explanatory claims beneath a token. These reviewed phrases are the
// claims currently established for the two sections whose wording was
// corrected. A sentence added to either section must be reviewed here first.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");

const REVIEWED_CLAIMS = [
  {
    file: "docs/guide/when-something-looks-wrong.md",
    heading: "### `spine_receipt_use_separate_checker`",
    phrases: [
      /You pointed `seal verify` at one of the gate's own receipts\./,
      /The format is recognized, but this binary does not verify its own receipts;/,
      /the message hands you the separate checker command to run instead\./,
      /Use that checker to learn whether the receipt is valid\./,
    ],
  },
  {
    file: "docs/guide/what-is-protected-right-now.md",
    anchor: "One honest wrinkle:",
    phrases: [
      /One honest wrinkle: `seal verify` can leave a \*kernel\* receipt \(a different format\) in the same directory,/,
      /and `seal status` then prints/,
      /That line means only that this listing does not parse the kernel format;/,
      /use `seal verify` to check a named kernel receipt\./,
    ],
  },
];

function sectionText(text, heading, anchor) {
  const marker = anchor || (heading.startsWith("### ") ? heading : `## ${heading}`);
  const start = text.indexOf(marker);
  assert.notEqual(start, -1, `guide heading missing: ${marker}`);
  const rest = text.slice(start + marker.length);
  const end = rest.search(/^#{1,2} /m);
  return (end === -1 ? rest : rest.slice(0, end)).trim();
}

function sentences(text) {
  return text.replace(/\s+/g, " ").split(/(?<=[.!?])\s+(?=[A-Z`])/).map((sentence) => sentence.trim()).filter(Boolean);
}

test("reviewed guide sections reject unreviewed explanatory claims", () => {
  const unreviewed = [];
  for (const entry of REVIEWED_CLAIMS) {
    const text = readFileSync(resolve(ROOT, entry.file), "utf8");
    for (const sentence of sentences(sectionText(text, entry.heading, entry.anchor))) {
      if (!entry.phrases.some((phrase) => phrase.test(sentence))) {
        unreviewed.push(`${entry.file} (${entry.heading}): ${sentence}`);
      }
    }
  }
  assert.deepEqual(unreviewed, [], "guide claims awaiting review:\n" + unreviewed.join("\n"));
});
