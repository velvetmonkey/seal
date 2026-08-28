// SPDX-License-Identifier: Apache-2.0
// Conformance control for docs/SEAL-RECEIPT-V2.md. The producer and checker
// remain separately maintained implementations; this test supplies their shared boundary.

import assert from "node:assert/strict";
import { test } from "node:test";

import { canonical as checkerCanonical } from "../checker/seal-receipt-v2.mjs";
import producer from "../spine/receipt-v2.cjs";

const { ReceiptRefusal, canonical: producerCanonical } = producer;

// These are JSON values only. `undefined` is deliberately outside this shared
// corpus: the producer names its absence receipt_value_absent, while the checker
// names the non-JSON value value_not_canonical.
const CORPUS = [
  {
    name: "reverse insertion order is retained, never sorted",
    value: { zebra: 1, alpha: 2, middle: 3 },
    expected: '{"zebra":1,"alpha":2,"middle":3}',
  },
  {
    name: "integer-index keys precede other string keys after parsing",
    value: JSON.parse('{"2":"two","1":"one","x":"other"}'),
    expected: '{"1":"one","2":"two","x":"other"}',
  },
  {
    name: "ordering is retained at every object depth",
    value: {
      outer_z: { inner_z: true, inner_a: false },
      outer_a: [{ item_z: null, item_a: "last" }, { second_z: 2, second_a: 1 }],
    },
    expected: '{"outer_z":{"inner_z":true,"inner_a":false},"outer_a":[{"item_z":null,"item_a":"last"},{"second_z":2,"second_a":1}]}',
  },
  {
    name: "member names and strings use JSON escaping without disturbing order",
    value: { 'z"key': "line\nfeed", "a\\key": "\ud800" },
    expected: '{"z\\"key":"line\\nfeed","a\\\\key":"\\ud800"}',
  },
  {
    name: "array order and canonical safe integers are retained",
    value: [9007199254740991, -9007199254740991, -0, { z: [], a: {} }],
    expected: '[9007199254740991,-9007199254740991,0,{"z":[],"a":{}}]',
  },
];

test("producer and checker canonicalisers conform to the v2 own-property enumeration specification", () => {
  for (const { name, value, expected } of CORPUS) {
    const producerBytes = producerCanonical(value);
    const checkerBytes = checkerCanonical(value);
    assert.equal(producerBytes, checkerBytes, `${name}: producer and checker diverged`);
    assert.equal(producerBytes, expected, `${name}: producer departed from the written specification`);
    assert.equal(checkerBytes, expected, `${name}: checker departed from the written specification`);
  }
});

test("undefined is a named non-JSON exclusion from the shared corpus", () => {
  assert.throws(
    () => producerCanonical(undefined),
    (error) => error instanceof ReceiptRefusal && error.code === "receipt_value_absent",
  );
  assert.throws(
    () => checkerCanonical(undefined),
    (error) => error?.code === "value_not_canonical",
  );
});
