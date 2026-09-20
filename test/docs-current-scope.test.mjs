// SPDX-License-Identifier: Apache-2.0
//
// docs/assurance/current-scope.md declares itself a reorientation of the
// README's own "Guarantees and non-guarantees" section, not an independently
// maintained second copy of the same claims (docs-site spec section 6). This
// test is the drift check: it fails if the quoted sentences on that page stop
// matching the README's canonical wording, or if the README section itself
// disappears out from under it.
// CLAIM-COVERAGE: docs/assurance/current-scope.md#current-scope
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const README = readFileSync(resolve(ROOT, "README.md"), "utf8");
const CURRENT_SCOPE = readFileSync(resolve(ROOT, "docs/assurance/current-scope.md"), "utf8");

function normalize(text) {
  return text.replace(/\s+/g, " ").trim();
}

function section(text, heading, nextHeading) {
  const start = text.indexOf(heading);
  assert.notEqual(start, -1, `README is missing the heading: ${heading}`);
  const end = nextHeading ? text.indexOf(nextHeading, start) : text.length;
  assert.notEqual(end, -1, `README is missing the heading: ${nextHeading}`);
  return text.slice(start, end);
}

const GUARANTEES_SECTION = section(
  README,
  "## Guarantees and non-guarantees",
  "## Choose your next page",
);

const REQUIRED_VERBATIM_QUOTES = [
  "Lean proves non-bypass and default-deny properties of the authorization decision model; correspondence to the shipped authorization path is not yet tested.",
  "Release incorporation: The theorem artifact does not yet ship and run in the released build graph.",
  "Semantic correspondence: The theorem concerns `SealV2.decide`. The shipped authorization path is `sealHostStep -> stepImpl -> Host.dispatch`. Their correspondence is not yet tested or proved. The `interpreted Lean vs shipped WASM` job compares verdicts from the shipped implementation interpreted through `Ffi.modelStep` with verdicts from its compiled WASM on a corpus; it asserts their agreement, with no independent expected verdict. It does not compare `SealV2.decide` with the shipped path.",
  "The proof-bearing source compiles reproducibly to the WASM the product uses, and a tested Node runtime enforces it with durable one-use state, configuration-drift refusal, concurrent-proxy fencing and signed receipts.",
  "The proof-bearing source rebuilds the exact kernel bytes the downloadable product requires, and the product has no JavaScript authorization fallback.",
  "Seal protects selected calls that pass through its boundary. A failure before forwarding can spend an approval without running the call; a human can approve a malicious but valid request; and Bash, direct writes, network access, subprocesses, other servers, and other routes to the same effect stay outside. Receipts are signed decision records, not proof that an effect happened.",
];

const REQUIRED_TABLE_ROWS = [
  "| Authorization rule | TESTED |",
  "| Product state/forwarding | TESTED |",
  "| Client and machine | TRUSTED |",
];

test("current-scope.md quotes the README's canonical guarantees verbatim", () => {
  const normalizedReadme = normalize(GUARANTEES_SECTION);
  const normalizedPage = normalize(CURRENT_SCOPE);
  for (const quote of REQUIRED_VERBATIM_QUOTES) {
    assert.ok(normalizedReadme.includes(normalize(quote)), `quote is missing from README's own section: ${quote}`);
    assert.ok(normalizedPage.includes(normalize(quote)), `docs/assurance/current-scope.md has drifted from the README: ${quote}`);
  }
  for (const row of REQUIRED_TABLE_ROWS) {
    assert.ok(README.includes(row), `README is missing the assurance-status row: ${row}`);
    assert.ok(CURRENT_SCOPE.includes(row), `docs/assurance/current-scope.md is missing the assurance-status row: ${row}`);
  }
});

// Pass 2: scope and receipt-family boundaries for the new reader entry points.
const FAMILY_PAGE_LIMITS = {
  "docs/archive/pass2-captures.md": "not every number or optional field",
  "docs/check/README.md": "does not establish operator identity",
  "docs/check/your-first-receipt.md": "Authority and occurrence remain unverified",
  "docs/check/from-seal.md": "Event occurrence is not established",
  "docs/check/results.md": "different from a receipt refused",
  "docs/check/formats.md": "not an invalid producer receipt",
  "docs/check/keys-and-sharing.md": "Editing a signed receipt",
  "docs/check/run-locally.md": "still depends on the checkout",
  "docs/check/reference/README.md": "Do not substitute a parsed object",
  "docs/assure/README.md": "distinct from the Node gate",
  "docs/assure/start.md": "not independent verification",
  "docs/assure/verify.md": "not trusted operator identity",
  "docs/assure/scan.md": "does not establish actual enforcement",
  "docs/assure/receipt-diff.md": "does not re-verify a seal",
  "docs/assure/adequacy.md": "not universal adequacy",
  "docs/assure/conformance.md": "not a universal proof",
  "docs/assure/ci.md": "was not executed",
  "docs/assure/configure.md": "were not exercised",
  "docs/assure/reference/README.md": "not Node-gate protection",
  "docs/assure/reference/schemas.md": "contract itself permits finite decimals",
  "docs/assure/reference/verify-profiles.md": "not rank a whole deployment",
  "docs/concepts/README.md": "without installing the gate",
  "docs/concepts/gate.md": "not proof that no alternate route exists",
  "docs/concepts/approval.md": "does not guarantee",
  "docs/concepts/decision-and-effect.md": "not proof that a database changed",
  "docs/concepts/replay-and-trust.md": "shared defect",
  "docs/concepts/glossary.md": "not proof that an effect happened",
  "docs/evidence/README.md": "not automatically current product facts",
  "docs/evidence/dependencies.md": "share parts of the kernel",
  "docs/evidence/proofs.md": "Read each statement with its hypotheses",
  "docs/evidence/correspondence.md": "neither tested nor proved",
  "docs/evidence/conformance.md": "not a new universal conformance claim",
  "docs/evidence/sources.md": "not a contract restriction",
  "docs/guide/first-approval.md": "not a real Claude Code acceptance walk",
  "docs/guide/lifecycle.md": "No real-client reconfiguration or uninstall"
};
for (const [file, limitation] of Object.entries(FAMILY_PAGE_LIMITS)) {
  test(`family content preserves scope: ${file}`, () => {
    const text = readFileSync(resolve(ROOT, file), 'utf8');
    assert.ok(normalize(text).includes(limitation), `${file}: missing its decision-point limitation`);
    assert.equal((text.match(/^# /gm) || []).length, 1, `${file}: one source title`);
    assert.doesNotMatch(text, /proves? (?:that )?(?:the )?(?:effect|action) (?:actually )?(?:happened|occurred)/i);
  });
}

test('format guide keeps decimals in the product contract and names checker compatibility separately', () => {
  const text = readFileSync(resolve(ROOT, 'docs/check/formats.md'), 'utf8');
  assert.match(text, /contract.*accepts finite decimals/);
  assert.match(text, /checker compatibility gap/);
  assert.match(text, /Both Protect and decision receipts can carry seal_receipt v2/);
});

// CLAIM-COVERAGE: docs/check/README.md#family-content-scope
// CLAIM-COVERAGE: docs/check/your-first-receipt.md#family-content-scope
// CLAIM-COVERAGE: docs/check/from-seal.md#family-content-scope
// CLAIM-COVERAGE: docs/check/results.md#family-content-scope
// CLAIM-COVERAGE: docs/check/formats.md#family-content-scope
// CLAIM-COVERAGE: docs/check/keys-and-sharing.md#family-content-scope
// CLAIM-COVERAGE: docs/check/run-locally.md#family-content-scope
// CLAIM-COVERAGE: docs/check/reference/README.md#family-content-scope
// CLAIM-COVERAGE: docs/assure/README.md#family-content-scope
// CLAIM-COVERAGE: docs/assure/start.md#family-content-scope
// CLAIM-COVERAGE: docs/assure/verify.md#family-content-scope
// CLAIM-COVERAGE: docs/assure/scan.md#family-content-scope
// CLAIM-COVERAGE: docs/assure/receipt-diff.md#family-content-scope
// CLAIM-COVERAGE: docs/assure/adequacy.md#family-content-scope
// CLAIM-COVERAGE: docs/assure/conformance.md#family-content-scope
// CLAIM-COVERAGE: docs/assure/ci.md#family-content-scope
// CLAIM-COVERAGE: docs/assure/configure.md#family-content-scope
// CLAIM-COVERAGE: docs/assure/reference/README.md#family-content-scope
// CLAIM-COVERAGE: docs/assure/reference/schemas.md#family-content-scope
// CLAIM-COVERAGE: docs/assure/reference/verify-profiles.md#family-content-scope
// CLAIM-COVERAGE: docs/concepts/README.md#family-content-scope
// CLAIM-COVERAGE: docs/concepts/gate.md#family-content-scope
// CLAIM-COVERAGE: docs/concepts/approval.md#family-content-scope
// CLAIM-COVERAGE: docs/concepts/decision-and-effect.md#family-content-scope
// CLAIM-COVERAGE: docs/concepts/replay-and-trust.md#family-content-scope
// CLAIM-COVERAGE: docs/concepts/glossary.md#family-content-scope
// CLAIM-COVERAGE: docs/evidence/README.md#family-content-scope
// CLAIM-COVERAGE: docs/evidence/dependencies.md#family-content-scope
// CLAIM-COVERAGE: docs/evidence/proofs.md#family-content-scope
// CLAIM-COVERAGE: docs/evidence/correspondence.md#family-content-scope
// CLAIM-COVERAGE: docs/evidence/conformance.md#family-content-scope
// CLAIM-COVERAGE: docs/guide/first-approval.md#family-content-scope
// CLAIM-COVERAGE: docs/guide/lifecycle.md#family-content-scope
// CLAIM-COVERAGE: docs/evidence/sources.md#family-content-scope

// CLAIM-COVERAGE: docs/archive/pass2-captures.md#family-content-scope
