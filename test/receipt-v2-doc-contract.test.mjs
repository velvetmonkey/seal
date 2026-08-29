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

test("receipt v2 page matches executable canonicalisation and workflow controls", () => { // CLAIM-COVERAGE: docs/SEAL-RECEIPT-V2.md
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
