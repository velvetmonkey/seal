// SPDX-License-Identifier: Apache-2.0
// Standing rule "proven means strict", ruled 2026-08-27: PROVED requires a
// shipped theorem in the build graph and CI running it on the shipped commit.
// This is a block-level guard, not an allowlist of yesterday's exact wording.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const test = require("node:test");

const ROOT = path.join(__dirname, "..");
const SEAL = path.join(ROOT, "bin", "seal");

function outputBlocks(text) {
  return [...text.matchAll(/^```[^\n]*\n([\s\S]*?)^```\s*$/gmu)].map((match) => match[1]);
}

function assertNoUnboundProofWords(block, label) {
  if (/\b(?:proved|proven)\b/iu.test(block) && !/\bseal-host\b/iu.test(block)) {
    assert.fail(`${label} contains proved/proven without a same-block seal-host binding`);
  }
}

function currentReaderDocuments() {
  return [
    "README.md",
    ...fs.readdirSync(path.join(ROOT, "docs"), { recursive: true })
      .filter((name) => /\.md$/iu.test(name) && !name.startsWith("archive/") && name !== "assurance/POLICY-LANGUAGE.md")
      .map((name) => path.join("docs", name)),
  ];
}

function runDemo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "seal-provedlie-control-"));
  try {
    const output = execFileSync(process.execPath, [SEAL, "demo", "--dir", dir], {
      cwd: ROOT,
      input: "y\n",
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    const allow = fs.readdirSync(path.join(dir, "receipts")).find((name) => name.endsWith("-ALLOW.json"));
    const receipt = JSON.parse(fs.readFileSync(path.join(dir, "receipts", allow), "utf8"));
    return { output, receipt };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test("reader-visible output blocks and live receipt claims stay below PROVED", () => {
  for (const relative of currentReaderDocuments()) {
    const text = fs.readFileSync(path.join(ROOT, relative), "utf8");
    for (const [index, block] of outputBlocks(text).entries()) {
      assertNoUnboundProofWords(block, `${relative} output block ${index + 1}`);
    }
  }

  const { output, receipt } = runDemo();
  assertNoUnboundProofWords(output, "seal demo output");
  assert.notEqual(receipt.evidence.authorization_rule, "PROVED", "ALLOW receipt must not carry an unearned PROVED authorization rule");
});

test("the block policy is semantic across case and punctuation", () => {
  for (const phrase of [
    "authorization rule proved;",
    "authorization rule PROVEN!",
    "The authorization rule is PROVED.",
    "authorization rule: proven",
    "PROVED WASM authorization rule",
  ]) {
    assert.throws(
      () => assertNoUnboundProofWords(`output\n${phrase}\n`, `tamper ${phrase}`),
      /same-block seal-host binding/,
    );
  }
  assert.doesNotThrow(() => assertNoUnboundProofWords("output\nproofed by seal-host\n", "bound control"));
});
