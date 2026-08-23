// SPDX-License-Identifier: Apache-2.0
// Normative vectors for the future decimal-capable approval canonicalizer.
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { canonicalString } = require("./canonical.cjs");

const source = readFileSync(new URL("./decimal-canonical-vectors.json", `file://${__dirname}/`), "utf8");
const { vectors } = JSON.parse(source);
const values = {
  "0.5": 0.5, "1.5": 1.5, "-1.5": -1.5, "0.1": 0.1, "0.2": 0.2,
  "0.1 + 0.2": 0.1 + 0.2, "1e-7": 1e-7, "1e21": 1e21, "-0.0": -0.0,
  "0.0": 0.0, "1.0": 1.0, "123.456": 123.456, "1 / 3": 1 / 3,
  "Number.EPSILON": Number.EPSILON, "Number.MAX_SAFE_INTEGER": Number.MAX_SAFE_INTEGER,
  "-Number.MAX_SAFE_INTEGER": -Number.MAX_SAFE_INTEGER,
  "Number.MAX_SAFE_INTEGER + 1": Number.MAX_SAFE_INTEGER + 1,
  "Number.MAX_VALUE": Number.MAX_VALUE, "Number.MIN_VALUE": Number.MIN_VALUE,
  "5e-324": 5e-324, NaN, Infinity, "-Infinity": -Infinity,
};
const integersOnly = process.argv.includes("--integers");
const selected = integersOnly ? vectors.filter((vector) => ["max-safe-integer", "min-safe-integer", "minus-zero-point-zero", "zero-point-zero", "one-point-zero"].includes(vector.id)) : vectors;

for (const vector of selected) {
  const value = values[vector.expression];
  if (Object.hasOwn(vector, "expected")) {
    let actual;
    try {
      actual = canonicalString(value);
    } catch (error) {
      assert.fail(`value ${vector.expression}: expected canonical bytes ${JSON.stringify(vector.expected)}, canonicalizer refused: ${error.message}`);
    }
    assert.equal(actual, vector.expected, `value ${vector.expression}: expected canonical bytes ${JSON.stringify(vector.expected)}, got ${JSON.stringify(actual)}`);
  } else {
    assert.throws(() => canonicalString(value), new Error(vector.refused), `value ${vector.expression}: expected refusal ${JSON.stringify(vector.refused)}`);
  }
}
process.stdout.write(`decimal canonical vectors PASS mode=${integersOnly ? "integers" : "all"} count=${selected.length}\n`);
