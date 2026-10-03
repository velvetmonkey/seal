// SPDX-License-Identifier: Apache-2.0
// This test binds the normative receipt page to the executable canonicalisers
// and to the workflow named by the page.
import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";

import { canonical as checkerCanonical } from "../checker/seal-receipt-v2.mjs";
import producer from "../spine/receipt-v2.cjs";

const { canonical: producerCanonical } = producer;
const page = fs.readFileSync(new URL("../docs/SEAL-RECEIPT-V2.md", import.meta.url), "utf8");
const workflow = fs.readFileSync(new URL("../.github/workflows/authorization-seam-differential.yml", import.meta.url), "utf8");

test("receipt v2 schema fields match the checker and producer", () => {
  const checker = fs.readFileSync(new URL("../checker/seal-receipt-v2.mjs", import.meta.url), "utf8");
  const schemaPage = fs.readFileSync(new URL("../docs/SEAL-RECEIPT-V2.md", import.meta.url), "utf8");
  const block = schemaPage.match(/```json\n([\s\S]*?)\n```/);
  assert.ok(block, "receipt schema JSON block is present");
  const schema = JSON.parse(block[1]);
  const sourceArray = (name) => {
    const literal = checker.match(new RegExp(`const ${name} = (\\[[^;]+\\]);`));
    assert.ok(literal, `${name} is visible in the runtime checker`);
    return JSON.parse(literal[1]);
  };
  const order = sourceArray("ORDER");
  assert.deepEqual(Object.keys(schema), order, "checker envelope order versus schema page");
  const record = {
    tool: "demo.read", arguments: {}, now: 0, kernel_config: {}, granted_capabilities: [],
    kernel_inputs: { approvals: [], votes: "", grants: "", forecasts: "", approval_handle_sha256: "0".repeat(64) },
    verdict: "BLOCK", reason: "test",
  };
  const signer = producer.generateSigner();
  const emitted = producer.sealReceipt(signer, record, "BLOCK");
  assert.deepEqual(Object.keys(emitted), order, "producer envelope versus checker order");
  const inputFields = new Set([...checker.matchAll(/r\.kernel_inputs\.([a-z_][a-z_0-9]*)/g)].map((match) => match[1]));
  assert.deepEqual(Object.keys(schema.kernel_inputs).sort(), [...inputFields].sort(), "kernel input fields versus checker");
  assert.deepEqual(Object.keys(emitted.kernel_inputs).sort(), Object.keys(schema.kernel_inputs).sort(),
    "producer kernel input fields versus schema page");
  assert.deepEqual(Object.keys(emitted.replay), Object.keys(schema.replay), "producer replay fields versus schema page");
  assert.deepEqual(Object.keys(emitted.signature).sort(), sourceArray("SIGNATURE_KEYS_SORTED").sort(),
    "producer signature fields versus checker");
  assert.deepEqual(Object.keys(schema.signature).sort(), Object.keys(emitted.signature).sort(),
    "signature fields versus schema page");
});

test("receipt v2 page matches executable canonicalisation and workflow controls", () => { // CLAIM-COVERAGE: docs/SEAL-RECEIPT-V2.md#receipt-v2
  assert.match(page, /Object members are canonicalised in ECMAScript own-property enumeration order\s+after parsing: integer-index keys in ascending numeric order, followed by other\s+string keys in insertion order\./u);
  assert.match(page, /Seal uses this rule for the receipt arguments commitment\./u);

  const value = JSON.parse('{"10":1,"2":2,"b":3,"a":4}');
  const expected = '{"2":2,"10":1,"b":3,"a":4}';
  const producerBytes = producerCanonical(value);
  const checkerBytes = checkerCanonical(value);
  assert.equal(producerBytes, checkerBytes, "producer and checker canonicalisers diverged");
  assert.equal(checkerBytes, expected, "checker departed from ECMAScript own-property enumeration order");

  assert.match(workflow, /^name: Authorization seam differential$/mu);
  assert.match(workflow, /node --test test-support\/authorization-seam-differential\.test\.cjs/u);
});
