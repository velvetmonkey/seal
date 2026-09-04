// SPDX-License-Identifier: Apache-2.0
// The reference output is a checked rendering, not a hand-maintained transcript.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { format, verify } from "../checker/seal-receipt-v2.mjs";

const page = new URL("../docs/reference/receipt-operations.md", import.meta.url);
const vector = new URL("../docs/reference/receipt-operations-v1/receipt-block.json", import.meta.url);
const vectorReadme = new URL("../docs/reference/receipt-operations-v1/README.md", import.meta.url);

function includesClaim(markdown, claim, message) {
  assert.ok(markdown.replace(/\s+/gu, " ").includes(claim.replace(/\s+/gu, " ")), message);
}

test("receipt operations reference matches the shipped verifier format", async () => {
  const markdown = readFileSync(page, "utf8");
  const receipt = readFileSync(vector, "utf8");
  const result = await verify(receipt);
  const match = markdown.match(/<!-- receipt-operations-format -->\n```output\n([\s\S]*?)\n```/u);
  assert.ok(match, "receipt operations page must contain its checked output fence");
  assert.equal(match[1], format(result));
});

test("receipt vector README records the shipped kernel decision", async () => {
  const markdown = readFileSync(vectorReadme, "utf8");
  const receipt = JSON.parse(readFileSync(vector, "utf8"));
  const result = await verify(JSON.stringify(receipt));
  includesClaim(
    markdown,
    `recorded\nkernel decision is \`${receipt.verdict}\`.`,
    "vector README must state the decision recorded by its vector", // CLAIM-COVERAGE: docs/reference/receipt-operations-v1/README.md#receipt-vector
  );
  assert.equal(result.receipt.verdict, receipt.verdict);
  assert.equal(receipt.verdict, "BLOCK");
});

test("canonical receipt operations prose matches shipped verifier behavior", async () => {
  const markdown = readFileSync(page, "utf8");
  const receipt = readFileSync(vector, "utf8");
  const result = await verify(receipt);

  includesClaim(markdown, "**READ** parses and displays the receipt.", "READ prose must describe the shipped operation");
  includesClaim(markdown, "**VALIDATE** performs non-executing integrity checks:", "VALIDATE prose must describe the shipped operation");
  includesClaim(markdown, "**REPLAY** loads the receipt's recorded inputs, recomputes with the verifier's local kernel,", "REPLAY prose must describe the shipped operation");
  includesClaim(markdown, "**VERIFY** applies a NAMED profile to the available evidence and trust inputs,", "VERIFY prose must describe the shipped operation");
  assert.equal(result.read, true);
  assert.equal(result.validate, true);
  assert.equal(result.replay, true);
  assert.equal(result.verify, false); // CLAIM-COVERAGE: docs/reference/receipt-operations.md#receipt-operations-verify
  includesClaim(markdown, "The verifier currently returns `verify: false` for every receipt.", "canonical page must state the shipped VERIFY result");

  for (const [option, expected] of [["authorityRoot", "authority roots cannot be checked by the v2 verifier"], ["occurrenceWitness", "occurrence witnesses cannot be checked by the v2 verifier"]]) {
    for (const value of ["", null, 0, false]) {
      await assert.rejects(verify(receipt, { [option]: value }), new RegExp(expected));
    }
    assert.match(markdown, new RegExp(expected.replaceAll(" ", "\\s+")), `canonical page must state the ${option} refusal`);
  }

  assert.equal(result.authority, "NOT ESTABLISHED");
  assert.equal(result.occurrence, "NOT ESTABLISHED");
  includesClaim(markdown, "`REPLAY` does not establish authority, and no row establishes occurrence.", "canonical page must state the trust ceiling"); // CLAIM-COVERAGE: docs/reference/receipt-operations.md#receipt-operations
});
