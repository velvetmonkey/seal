// SPDX-License-Identifier: Apache-2.0
// Standing rule "proven means strict", ruled 2026-08-27: proof-strength
// claims about the authorization rule must bind to their evidence in the same
// reader-visible block. This is a binder, not a list of yesterday's strings.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const test = require("node:test");

const ROOT = path.join(__dirname, "..");
const SEAL = path.join(ROOT, "bin", "seal");
const PROOF_WORD = String.raw`(?:proved|proven|verified|machine\s*[-\s]?\s*checked|formally\s*verified|theorem-backed)`;
const AUTHORIZATION = String.raw`(?:authorization\s+(?:rule|kernel)|kernel\s+authorization|authorized\s+decision)`;
const AUTHORIZATION_PROOF_CLAIM = new RegExp(
  String.raw`(?:${AUTHORIZATION}[\s\S]{0,180}${PROOF_WORD}|${PROOF_WORD}[\s\S]{0,180}${AUTHORIZATION})`,
  "giu",
);

function normalizeWhitespace(text) {
  return text.replace(/\s+/gu, " ").replace(/\bpro\s+ved\b/giu, "proved").trim();
}

function claimBlocks(text, kind) {
  const normalized = normalizeWhitespace(text);
  const blocks = kind === "markdown"
    ? [
      ...text.matchAll(/<!--([\s\S]*?)-->/gu),
      ...text.matchAll(/^```[^\n]*\n([\s\S]*?)^```\s*$/gmu),
      ...text.split(/^#{1,6}\s+.*$/gmu),
    ].map((match) => normalizeWhitespace(typeof match === "string" ? match : (match[1] ?? match[0]))).filter(Boolean)
    : text.split(/\n{2,}/u).map(normalizeWhitespace).filter(Boolean);
  return blocks;
}

function hasBoundAuthorizationClaim(block) {
  AUTHORIZATION_PROOF_CLAIM.lastIndex = 0;
  if (!AUTHORIZATION_PROOF_CLAIM.test(block)) return false;
  // The evidence declaration must travel with the claim. A URL alone is not
  // evidence; seal-host is the named source holder used by the proof-source
  // control, and the declaration must say what it supplies.
  return /\bseal-host\b[\s:,-]*(?:is|holds|contains|provides|supplies|the)\b/iu.test(block)
    || /\b(?:evidence|source|theorem|proof)\s*:\s*[^.]{0,120}\bseal-host\b/iu.test(block);
}

function assertBound(text, label, kind = "text") {
  const blocks = claimBlocks(text, kind);
  for (const block of blocks) {
    AUTHORIZATION_PROOF_CLAIM.lastIndex = 0;
    if (AUTHORIZATION_PROOF_CLAIM.test(block) && !hasBoundAuthorizationClaim(block)) {
      assert.fail(`${label} contains an authorization proof-strength claim without same-block evidence binding`);
    }
  }
}

function currentReaderDocuments() {
  return [
    "README.md",
    ...fs.readdirSync(path.join(ROOT, "docs"), { recursive: true })
      .filter((name) => /\.(?:md|mdx|html)$/iu.test(name) && !name.startsWith("archive/") && name !== "assurance/POLICY-LANGUAGE.md")
      .map((name) => path.join("docs", name)),
  ];
}

function trackedPayloadFiles() {
  return ["contract/kernel-authorization.cjs", "spine/proxy.cjs"];
}

function jsonFixtureFiles() {
  return execFileSync("git", ["ls-files", "--", "test/fixtures/**/*.json"], { cwd: ROOT, encoding: "utf8" })
    .split("\n").filter(Boolean);
}

function runDemo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "seal-provedlie-control-"));
  try {
    const output = execFileSync(process.execPath, [SEAL, "demo", "--dir", dir], {
      cwd: ROOT, input: "y\n", encoding: "utf8", stdio: ["pipe", "pipe", "pipe"],
    });
    const allow = fs.readdirSync(path.join(dir, "receipts")).find((name) => name.endsWith("-ALLOW.json"));
    const receipt = JSON.parse(fs.readFileSync(path.join(dir, "receipts", allow), "utf8"));
    return { output, receipt };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test("authorization proof-strength claims bind to evidence across shipped and reader surfaces", () => {
  for (const relative of [...currentReaderDocuments(), ...trackedPayloadFiles()]) {
    const kind = /\.(?:md|mdx|html)$/iu.test(relative) ? "markdown" : "text";
    assertBound(fs.readFileSync(path.join(ROOT, relative), "utf8"), relative, kind);
  }
  for (const relative of jsonFixtureFiles()) {
    assertBound(fs.readFileSync(path.join(ROOT, relative), "utf8"), relative, "json");
  }
  const { output, receipt } = runDemo();
  assertBound(output, "seal demo output");
  assert.notEqual(receipt.evidence.authorization_rule, "PROVED", "ALLOW receipt must not carry an unearned PROVED authorization rule");
});

const TAMPER_SHAPES = [
  ["upper case", "authorization rule PROVED;"],
  ["lower case", "authorization rule proved;"],
  ["mixed case", "authorization rule PrOvEd;"],
  ["proven", "authorization rule proven;"],
  ["verified", "authorization rule verified;"],
  ["machine-checked", "authorization rule machine-checked;"],
  ["different punctuation", "authorization rule proved!"],
  ["split line", "authorization rule pro\nved;"],
  ["fenced HTML comment", "<!-- authorization rule machine-checked; -->"],
  ["HTML comment outside fence", "prefix\n<!-- authorization rule proven; -->\nsuffix"],
  ["is PROVED", "The authorization rule is PROVED."],
  ["proved colon", "authorization rule: proven"],
  ["JSON string value", JSON.stringify({ evidence: "authorization rule PROVED" })],
  ["standalone JSON fixture", JSON.stringify({ claim: "authorization rule machine-checked" })],
];

test("every frisk shape goes red without a same-block evidence binding", () => {
  for (const [label, shape] of TAMPER_SHAPES) {
    assert.throws(() => assertBound(shape, `tamper ${label}`, label.includes("HTML") ? "markdown" : "json"), /same-block evidence binding/, label);
  }
});

test("a claim bound to its evidence in the same block passes", () => {
  assert.doesNotThrow(() => assertBound("The authorization rule is machine-checked by Lean. Evidence: seal-host provides the theorem.", "bound"));
  assert.doesNotThrow(() => assertBound("<!-- The authorization rule is proven. Evidence: seal-host provides the theorem. -->", "bound comment", "markdown"));
});
