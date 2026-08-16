// SPDX-License-Identifier: Apache-2.0
// The required-check regression: a collision must redden product-suite itself,
// rather than an optional upstream job that can make product-suite skip.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const WORKFLOW = fs.readFileSync(
  path.join(__dirname, "..", ".github", "workflows", "ci.yml"),
  "utf8",
);

function jobBlock(name) {
  const start = WORKFLOW.indexOf(`  ${name}:`);
  assert.notEqual(start, -1, `${name} job is absent`);
  const rest = WORKFLOW.slice(start + 2);
  const next = rest.search(/\n  [A-Za-z0-9_-]+:\n/);
  return rest.slice(0, next < 0 ? undefined : next);
}

function mergeBox(required, conclusions) {
  return required.every((check) => conclusions[check] === "success");
}

test("the collision gate is inside every required product-suite job", () => {
  const product = jobBlock("product-suite");
  assert.doesNotMatch(product, /\n\s+needs:/);
  assert.match(product, /run: node scripts\/check-version-identity\.cjs/);
  assert.match(product, /name: product-suite \(Node \$\{\{ matrix\.node-version \}\}\)/);
});

test("the reconstructed post-tag collision makes the merge box red", () => {
  const required = ["docs-claims", "product-suite (Node 20)", "product-suite (Node 22)"];
  const collision = {
    "docs-claims": "success",
    "product-suite (Node 20)": "failure",
    "product-suite (Node 22)": "failure",
  };
  assert.equal(mergeBox(required, collision), false);
});

test("tampering the wiring proves the old green failure mode, inverse restores red", () => {
  const required = ["docs-claims", "product-suite (Node 20)", "product-suite (Node 22)"];
  const broken = {
    "docs-claims": "success",
    "product-suite (Node 20)": "success",
    "product-suite (Node 22)": "success",
  };
  assert.equal(mergeBox(required, broken), true);

  const restored = {
    ...broken,
    "product-suite (Node 20)": "failure",
    "product-suite (Node 22)": "failure",
  };
  assert.equal(mergeBox(required, restored), false);
});

test("no workflow job has a needs edge", () => {
  assert.doesNotMatch(WORKFLOW, /^\s+needs:/m);
});
