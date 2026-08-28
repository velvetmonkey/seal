// SPDX-License-Identifier: Apache-2.0
// The reference output is a checked rendering, not a hand-maintained transcript.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { format, verify } from "../checker/seal-receipt-v2.mjs";

const page = new URL("../docs/reference/receipt-operations.md", import.meta.url);
const vector = new URL("../docs/reference/receipt-operations-v1/receipt-block.json", import.meta.url);

test("receipt operations reference matches the shipped verifier format", async () => {
  const markdown = readFileSync(page, "utf8");
  const receipt = readFileSync(vector, "utf8");
  const result = await verify(receipt);
  const match = markdown.match(/<!-- receipt-operations-format -->\n```output\n([\s\S]*?)\n```/u);
  assert.ok(match, "receipt operations page must contain its checked output fence");
  assert.equal(match[1], format(result));
});
