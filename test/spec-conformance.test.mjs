import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const ROOT = resolve(import.meta.dirname, "..");
const read = (file) => readFileSync(resolve(ROOT, file), "utf8");

function requireText(file, text, pattern, claim) {
  assert.match(text, pattern, `${file}: ${claim}`);
}

test("canonicalization specification states the implemented number-domain split", () => {
  const file = "docs/spec/canonicalization.md";
  const spec = read(file);
  const source = read("contract/canonical.cjs");
  requireText(file, spec, /\*\*safe integers only\*\*: finite, integral, and within ±9007199254740991/u, "must state Rule A's safe-integer domain"); // CLAIM-COVERAGE: docs/spec/canonicalization.md
  requireText(file, spec, /\*\*any finite IEEE-754 double\*\*, rendered by ECMAScript `Number::toString`/u, "must state Rule B's finite-double domain");
  requireText(file, source, /Number\.isInteger\(value\).*non-integer number has no canonical form in the contract/u, "contract source must refuse non-integers");
  assert.doesNotMatch(spec, /\bSeal(?:\s+canonicalization)?\s+guarantees?\s+impossible unicorn transport\./iu, `${file}: false guarantee claim is not supported by the canonicalization contract`);
});

test("receipt specification binds acceptance to the signed canonical receipt", () => {
  const file = "docs/spec/receipt-seal-spine-v1.md";
  const spec = read(file);
  const source = read("spine/receipt-seal.cjs");
  requireText(file, spec, /Establishes: the parsed receipt has exactly the canonical value \(Rule B\)/u, "must limit ACCEPT to the signed canonical receipt"); // CLAIM-COVERAGE: docs/spec/receipt-seal-spine-v1.md
  requireText(file, spec, /Does not establish: that the decision happened/u, "must retain the decision-occurrence limitation");
  requireText(file, spec, /this limitation lifts only when a separately\s+specified verification system supplies a separately authenticated record/u, "must state the condition that lifts the limitation");
  requireText(file, source, /const committed = \{ \.\.\.body, seal: \{ alg: "ed25519", \.\.\.commitments \} \};/u, "sealer source must commit the receipt body");
});

test("approval specification states retry expiry and the source implements it", () => {
  const file = "docs/spec/approval-contract-rs1.md";
  const spec = read(file);
  const source = read("contract/contract.cjs");
  requireText(file, spec, /contract stops the \*\*client\*\* altering the continuation\. It does \*\*not\*\*\s+prove a human clicked Accept\./u, "must distinguish continuation binding from human presence"); // CLAIM-COVERAGE: docs/spec/approval-contract-rs1.md
  requireText(file, spec, /step\s+2 journals `expired` and step\s+6 journals `declined`\/`cancelled`/u, "must record the observed retry side effects");
  requireText(file, source, /if \(record\.status === "expired" \|\| now\(\) > record\.expires_at\)/u, "retry source must refuse an expired approval");
});
