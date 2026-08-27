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
const PROOF_WORD = String.raw`(?:proved|proven|verified|certified|machine\s*[-\s]?\s*checked|formally\s*verified|theorem-backed)`;
const AUTHORIZATION = String.raw`(?:authorization\s+(?:rule|kernel)|kernel\s+authorization|authorized\s+decision)`;
const AUTHORIZATION_PROOF_CLAIM = new RegExp(
  String.raw`(?:\b(?:${AUTHORIZATION})\b[\s\S]{0,180}?\b(?:is|was|remains|stands\s+as|has\s+been)\s+(?:${PROOF_WORD})\b|\b(?:${PROOF_WORD})\b[\s\S]{0,180}?\b(?:of|for)\s+(?:the\s+)?(?:${AUTHORIZATION})\b)`,
  "giu",
);

function normalizeForMatching(text) {
  return text.replace(/\s+/gu, " ").trim();
}

function claimBlocks(text, kind) {
  const blocks = kind === "markdown"
    ? [
      ...text.matchAll(/<!--([\s\S]*?)-->/gu),
      ...text.matchAll(/^```[^\n]*\n([\s\S]*?)^```\s*$/gmu),
      ...text.split(/^#{1,6}\s+.*$/gmu),
    ].map((match) => normalizeForMatching(typeof match === "string" ? match : (match[1] ?? match[0]))).filter(Boolean)
    : text.split(/\n{2,}/u).map(normalizeForMatching).filter(Boolean);
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

function hasPositiveAuthorizationClaim(block) {
  const unquoted = block.replace(/"[^"\n]*"|'[^'\n]*'|`[^`\n]*`/gu, "");
  if (/\b(?:residual\s+register|refused\s+example|unverified)\b/iu.test(unquoted)) return false;
  AUTHORIZATION_PROOF_CLAIM.lastIndex = 0;
  return AUTHORIZATION_PROOF_CLAIM.test(unquoted);
}

// Honest Unicode residual: this prose scan does not resist deliberate
// homoglyph or bidi substitution, and it is not intended to. It catches
// ordinary drift by an honest author. The EXACT assertions are what resist a
// determined one.

function assertBound(text, label, kind = "text") {
  const blocks = claimBlocks(text, kind);
  for (const block of blocks) {
    if (hasPositiveAuthorizationClaim(block) && !hasBoundAuthorizationClaim(block)) {
      assert.fail(`${label} contains an authorization proof-strength claim without same-block evidence binding`);
    }
  }
}

const EXPECTED_AUTHORIZATION_RULE = "TESTED";
const EXPECTED_DEMO_CLOSING_LINE = "authorization rule tested; product state and forwarding tested; client and machine trusted.";

function assertExactSurfaces(output, receipt, readme) {
  assert.equal(receipt.evidence.authorization_rule, EXPECTED_AUTHORIZATION_RULE, "ALLOW receipt authorization_rule must be exactly TESTED");
  const closingLine = output.trimEnd().split("\n").at(-1);
  assert.equal(closingLine, EXPECTED_DEMO_CLOSING_LINE, "seal demo closing line changed");
  const readmeLine = readme.match(/^authorization rule [^\n]+$/mu)?.[0];
  assert.equal(readmeLine, closingLine, "README assurance line must equal the demo closing line");
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
  assertExactSurfaces(output, receipt, fs.readFileSync(path.join(ROOT, "README.md"), "utf8"));
});

const TAMPER_SHAPES = [
  ["upper case", "The authorization rule is PROVED."],
  ["lower case", "The authorization rule is proved."],
  ["mixed case", "The authorization rule is PrOvEd."],
  ["proven", "The authorization rule is proven."],
  ["verified", "The authorization rule is verified."],
  ["machine-checked", "The authorization rule is machine-checked."],
  ["different punctuation", "The authorization rule is proved!"],
  ["fenced HTML comment", "<!-- The authorization rule is machine-checked. -->"],
  ["HTML comment outside fence", "prefix\n<!-- The authorization rule is proven. -->\nsuffix"],
  ["proved colon", "The authorization rule is proven: evidence omitted."],
];

test("every frisk shape goes red without a same-block evidence binding", () => {
  for (const [label, shape] of TAMPER_SHAPES) {
    assert.throws(() => assertBound(shape, `tamper ${label}`, label.includes("HTML") ? "markdown" : "json"), /same-block evidence binding/, label);
    console.log(`RED ${label}: contains an authorization proof-strength claim without same-block evidence binding`);
  }
});

test("frisk residuals and explicit negative or unrelated prose stay silent", () => {
  const silent = [
    ["Greek epsilon", "The authorization rule is provεd."],
    ["Greek nu", "The authorization rule is proνed."],
    ["Armenian oh", "The authorization rule is prօved."],
    ["combining acute", "The authorization rule is próved and ṕŕóv́éd."],
    ["combining overlay", "The authorization rule is p̶roved."],
    ["Cherokee", "The authorization rule is proᎥed and aᎥthorization."],
    ["bidi override", "The authorization rule is \u202Edevorp."],
    ["negation", "The authorization rule is TESTED, not PROVEN."],
    ["quoted refused example", 'REFUSED example: "The authorization rule is PROVED."'],
    ["residual register", "Residual register: the authorization rule is PROVED."],
    ["certified TLS certificate", "The authorization rule is TESTED; certified TLS certificate is unrelated."],
  ];
  for (const [label, shape] of silent) {
    assert.doesNotThrow(() => assertBound(shape, `silent ${label}`), label);
    console.log(`SILENT ${label}`);
  }
});

test("a claim bound to its evidence in the same block passes", () => {
  assert.doesNotThrow(() => assertBound("The authorization rule is machine-checked by Lean. Evidence: seal-host provides the theorem.", "bound"));
  assert.doesNotThrow(() => assertBound("<!-- The authorization rule is proven. Evidence: seal-host provides the theorem. -->", "bound comment", "markdown"));
});

test("normalization does not over-fire on unrelated prose", () => {
  assert.doesNotThrow(() => assertBound("The word prοved is discussed in this glossary.", "unrelated word"));
  assert.doesNotThrow(() => assertBound("The release artifact is certified by the issuing authority.", "legitimate certification"));
});

test("exact receipt and demo surfaces go red when physically tampered", () => {
  const { output, receipt } = runDemo();
  const tamperedReceipt = structuredClone(receipt);
  tamperedReceipt.evidence.authorization_rule = "PROVED";
  assert.throws(() => assertExactSurfaces(output, tamperedReceipt, fs.readFileSync(path.join(ROOT, "README.md"), "utf8")), /exactly TESTED/);
  console.log("RED receipt authorization_rule=PROVED: ALLOW receipt authorization_rule must be exactly TESTED");

  const tamperedOutput = output.replace(EXPECTED_DEMO_CLOSING_LINE, "authorization rule proved; product state and forwarding tested; client and machine trusted.");
  assert.throws(() => assertExactSurfaces(tamperedOutput, receipt, fs.readFileSync(path.join(ROOT, "README.md"), "utf8")), /seal demo closing line changed/);
  console.log("RED demo closing line tamper: seal demo closing line changed");
});

test("a plain unspoofed positive prose claim goes red", () => {
  assert.throws(() => assertBound("The authorization rule is PROVED.", "plain positive claim"), /same-block evidence binding/);
  console.log("RED plain positive claim: contains an authorization proof-strength claim without same-block evidence binding");
});
