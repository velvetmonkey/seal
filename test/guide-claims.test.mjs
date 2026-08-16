// The refusal-token inventory says nothing about explanatory prose. These two
// guide files contain reviewed claims whose meaning must not drift silently.
//
// This is deliberately a whole-file pin, not a marker-located section parser:
// a heading, its whitespace, or a later heading cannot redirect what is being
// checked. Any edit to either reviewed file needs an intentional review and
// re-pin of the digest below.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";

const ROOT = resolve(import.meta.dirname, "..");

const REVIEWED_GUIDES = [
  {
    file: "docs/guide/when-something-looks-wrong.md",
    sha256: "2f8efb1a4ee73afe7b2c455219122855ee1b3a87951dd9e981e3a7b26a69d1a5",
    claims: [
      "You pointed `seal verify` at one of the gate's own receipts.",
      "The format is recognized, but this binary does not verify its own receipts; the message hands you the separate checker command to run instead.",
      "Use that checker to learn whether the receipt is valid.",
    ],
  },
  {
    file: "docs/guide/what-is-protected-right-now.md",
    sha256: "1e6efc9349cc4770d3e1eaeaba9212e92cef3903dcfc0ddbc47ea514eb2eae92",
    claims: [
      "One honest wrinkle: `seal verify` can leave a *kernel* receipt (a different format) in the same directory, and `seal status` then prints `Receipt unreadable: … (missing decision or receipt time)` for it.",
      "That line means only that this listing does not parse the kernel format; use `seal verify` to check a named kernel receipt.",
    ],
  },
];

function sha256(text) {
  return createHash("sha256").update(text).digest("hex");
}

function occurrences(text, claim) {
  return text.replace(/\s+/g, " ").split(claim).length - 1;
}

function assertPinned(entry, text) {
  assert.ok(entry.claims.length > 0, `${entry.file}: reviewed claim inventory must not be empty`);
  assert.equal(
    sha256(text),
    entry.sha256,
    `${entry.file}: content changed; review the whole file and intentionally re-pin its sha256`,
  );
}

test("reviewed guide files are content-addressed and retain each reviewed claim once", () => {
  assert.ok(REVIEWED_GUIDES.length > 0, "REVIEWED_GUIDES must not be empty");
  for (const entry of REVIEWED_GUIDES) {
    const text = readFileSync(resolve(ROOT, entry.file), "utf8");
    assertPinned(entry, text);
    for (const claim of entry.claims) {
      assert.equal(occurrences(text, claim), 1, `${entry.file}: reviewed claim must appear exactly once: ${claim}`);
    }
  }
});

test("whole-file pin rejects locator defeats and earlier claim tampering", () => {
  const entry = REVIEWED_GUIDES[0];
  const text = readFileSync(resolve(ROOT, entry.file), "utf8");
  const heading = "### `spine_receipt_use_separate_checker`";
  const falseClaim = "Nothing is wrong with the receipt.";
  const rejects = [
    ["whitespace real heading plus exact decoy", text.replace(heading, `###  \`spine_receipt_use_separate_checker\``) + `\n${heading}\n\n${entry.claims.join(" ")}\n${falseClaim}\n`],
    ["case-different heading", text.replace(heading, "### `Spine_receipt_use_separate_checker`")],
    ["backtick-different heading", text.replace(heading, "### spine_receipt_use_separate_checker")],
    ["deleted reviewed body", text.replace(entry.claims[0], "")],
    ["deleted reviewed sentence", text.replace("learn whether the receipt is valid.", "")],
    ["novel assertion", `${text}\n${falseClaim}\n`],
    ["deleted heading", text.replace(heading, "")],
    ["renamed heading", text.replace(heading, "### `spine_receipt_use_other_checker`")],
  ];
  for (const [name, tampered] of rejects) {
    assert.throws(() => assertPinned(entry, tampered), /content changed/, name);
  }
  assert.throws(() => assertPinned({ ...entry, claims: [] }, text), /inventory must not be empty/);
});
