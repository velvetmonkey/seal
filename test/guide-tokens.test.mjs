// SPDX-License-Identifier: Apache-2.0
// The operating guide's anti-rot gate: docs/guide/when-something-looks-wrong.md
// documents every refusal token the product can emit, and nothing else.
//
// Both directions are enforced against the SOURCE, not against a copy of the
// list: a token added to the code without a guide entry fails, and a token
// documented in the guide without a source of truth fails. The guide marks
// each documented token as a heading of the exact form `### `token``.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";

const ROOT = resolve(import.meta.dirname, "..");
const GUIDE = "docs/guide/when-something-looks-wrong.md";
const GUIDE_SHA256 = "1a49ec4d98a4d35765fceb2674d3b801bbf26d3d4d7e10da78407519e5b7cf8a";

// Where refusal tokens live and the shapes they are minted in. A new refusal
// site that follows any of these shapes is picked up automatically; a new
// shape must be added here (and the sentinel check below fails loudly if a
// whole file stops matching).
const SOURCES = [
  { file: "contract/contract.cjs", patterns: [/^\s+[A-Z_]+: "([a-z_]+)",/gm], sentinel: "already_consumed" },
  {
    file: "spine/protection.cjs",
    patterns: [
      /new ProtectionError\(\s*"([a-z_]+)"/g, /\bownershipRefusal\(\s*"([a-z_]+)"/g,
      /\bfail\("([a-z_]+)"/g,
      /\brefusal: "([a-z_]+)"/g,
      /\bcode: "([a-z_]+)"/g,
    ],
    sentinel: "drifted",
  },
  { file: "spine/proxy.cjs", patterns: [/"(protected_server_missing|protected_server_failed|forward_refused)"/g], sentinel: "forward_refused" },
  { file: "spine/platform.cjs", patterns: [/REFUSE ([a-z_]+):/g], sentinel: "unsupported_platform" },
  { file: "spine/integrity.cjs", patterns: [/\.code = "([a-z_]+)"/g, /\bcode: "([a-z_]+)"/g], sentinel: "artifact_truncated" },
  { file: "spine/version.cjs", patterns: [/error\.code = "([a-z_]+)"/g], sentinel: "version_mismatch" },
  { file: "bin/seal", patterns: [/\b(spine_receipt_use_separate_checker)\b/g, /runtimeRefusal\("([a-z_]+)"/g], sentinel: "spine_receipt_use_separate_checker" },
  { file: "scripts/install.cjs", patterns: [/refuse\("([a-z_]+)"/g, /REFUSE ([a-z_]+):/g], sentinel: "pin_missing" },
  { file: "scripts/seal-launch.cjs", patterns: [/refuse\("([a-z_]+)"/g, /REFUSE ([a-z_]+):/g], sentinel: "install_record_missing" },
  { file: "scripts/build-dist.cjs", patterns: [/REFUSE ([a-z_]+):/g], sentinel: "node_missing" },
  { file: "checker/seal-receipt-check.mjs", patterns: [/new Refusal\("([a-z_]+)"/g, /REFUSE ([a-z_]+):/g], sentinel: "signature_invalid" },
];

function sourceTokens() {
  const tokens = new Set();
  for (const { file, patterns, sentinel } of SOURCES) {
    const text = readFileSync(resolve(ROOT, file), "utf8");
    const found = new Set();
    for (const pattern of patterns) {
      for (const match of text.matchAll(pattern)) found.add(match[1]);
    }
    assert.ok(
      found.has(sentinel),
      `${file}: expected to extract "${sentinel}" but got [${[...found].join(", ")}] — ` +
        "either the refusal site moved (update SOURCES) or the token was removed (update the guide)",
    );
    for (const token of found) tokens.add(token);
  }
  return tokens;
}

function guideTokens() {
  const text = readFileSync(resolve(ROOT, GUIDE), "utf8");
  const digest = createHash("sha256").update(text).digest("hex");
  assert.equal(
    digest,
    GUIDE_SHA256,
    `${GUIDE}: content changed; this pin cannot check truth. Re-pin its sha256 only after a human confirms the new text is TRUE.`,
  );
  const occurrences = new Map();
  for (const match of text.matchAll(/^### `([a-z_]+)`/gm)) {
    const line = text.slice(0, match.index).split("\n").length;
    const locations = occurrences.get(match[1]) || [];
    locations.push(`line ${line}`);
    occurrences.set(match[1], locations);
  }
  const duplicates = [...occurrences]
    .filter(([, locations]) => locations.length > 1)
    .map(([token, locations]) => `### \`${token}\` (${locations.join(", ")})`);
  assert.deepEqual(
    duplicates,
    [],
    `${GUIDE}: refusal headings appear more than once:\n${duplicates.join("\n")}`,
  );
  return new Set(occurrences.keys());
}

test("every refusal token in the source is documented in the guide", () => {
  const inSource = sourceTokens();
  const inGuide = guideTokens();
  const undocumented = [...inSource].filter((token) => !inGuide.has(token)).sort();
  assert.deepEqual(
    undocumented,
    [],
    `refusal tokens the product can emit but ${GUIDE} does not document:\n${undocumented.join("\n")}`,
  );
});

test("every refusal token the guide documents exists in the source", () => {
  const inSource = sourceTokens();
  const inGuide = guideTokens();
  const phantom = [...inGuide].filter((token) => !inSource.has(token)).sort();
  assert.deepEqual(
    phantom,
    [],
    `refusal tokens ${GUIDE} documents that no source file mints:\n${phantom.join("\n")}`,
  );
});

// These reviewed claims move from guide-claims.test.mjs. The token inventory
// alone does not retain their explanatory prose or protect the second guide.
const REVIEWED_GUIDES = [
  {
    file: "docs/guide/when-something-looks-wrong.md", // CLAIM-COVERAGE: docs/guide/when-something-looks-wrong.md
    sha256: GUIDE_SHA256,
    claims: [
      ["You pointed `seal verify`", " at one of the gate's own receipts."].join(""),
      "The format is recognized, but this binary does not verify its own receipts; the message hands you the separate checker command to run instead.",
      "Use that checker to learn whether the receipt is valid.",
    ],
  },
  {
    file: "docs/guide/what-is-protected-right-now.md", // CLAIM-COVERAGE: docs/guide/what-is-protected-right-now.md
    sha256: "5e193f5da31c0b9df79efa57c2220eb911bc8b230dbdd19257f3a70e0389b9bb",
    claims: [
      ["One honest wrinkle: `seal verify`", " can leave a *kernel* receipt (a different format) in the same directory, and `seal status` then prints `Receipt unreadable: … (missing decision or receipt time)` for it."].join(""),
      ["That line means only that this listing does not parse the kernel format; use `seal verify`", " to check a named kernel receipt."].join(""),
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
