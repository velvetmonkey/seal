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
