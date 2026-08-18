// The refusal-token inventory says nothing about explanatory prose. These two
// guide files contain reviewed claims whose meaning must not drift silently.
//
// This pins the whole reviewed guide after canonicalizing one exact generated
// release-version slot, not a marker-located section:
// a heading, its whitespace, or a later heading cannot redirect what is being
// checked. This pin catches accidental and incidental changes, but cannot stop
// a determined author: that author can change both the text and this mutable
// digest. Re-pinning is correct only after a human confirms the new text is
// TRUE; the pin cannot check truth. Stopping a determined author needs a
// protected review rule and a reviewer attestation signed by a key the author
// does not hold.
//
// truediag7 records why this is locally unwinnable: a deterministic checker
// sees only final repository bytes, so an author who can change a legitimate
// edit and its pin can make the same local changes for a false edit. The
// external reviewer boundary above is what would close that gap.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";

const ROOT = resolve(import.meta.dirname, "..");

const VERSIONED_GUIDE = "docs/guide/when-something-looks-wrong.md";
const GENERATED_VERSION_SLOT = new RegExp("(?<=^Printed by the installer, the installed launcher, and the demo alike: Seal\\n)v\\d+\\.\\d+\\.\\d+(?:-[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*)?(?= supports Linux x86-64 only, refuses everything else, and changes no\\nfiles when it refuses\\.$)", "gm");

function canonicalReviewedGuide(file, text) {
  if (file !== VERSIONED_GUIDE) return text;
  const matches = [...text.matchAll(GENERATED_VERSION_SLOT)];
  assert.equal(matches.length, 1, `${file}: expected exactly one generated release-version slot`);
  return text.replace(GENERATED_VERSION_SLOT, "v<generated-version>");
}

const REVIEWED_GUIDES = [
  {
    file: "docs/guide/when-something-looks-wrong.md", // CLAIM-COVERAGE: docs/guide/when-something-looks-wrong.md
    sha256: "3cbc419903128913477f99d4d6989f93b9ef82056c48576064585e6c823385db",
    claims: [
      "You pointed `seal verify` at one of the gate's own receipts.",
      "The format is recognized, but this binary does not verify its own receipts; the message hands you the separate checker command to run instead.",
      "Use that checker to learn whether the receipt is valid.",
    ],
  },
  {
    file: "docs/guide/what-is-protected-right-now.md", // CLAIM-COVERAGE: docs/guide/what-is-protected-right-now.md
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
    sha256(canonicalReviewedGuide(entry.file, text)),
    entry.sha256,
    `${entry.file}: content changed; this pin cannot check truth. Re-pin its sha256 only after a human confirms the new text is TRUE.`,
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

test("reviewed-prose pin rejects locator defeats and earlier claim tampering", () => {
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
