// SPDX-License-Identifier: Apache-2.0
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.join(__dirname, "..");
const DOCS = path.join(ROOT, "docs");
const INDEX = path.join(DOCS, "README.md");

test("docs index names every Markdown file in docs", () => {
  const index = fs.readFileSync(INDEX, "utf8");
  const files = fs.readdirSync(DOCS)
    .filter((file) => file.endsWith(".md"))
    .sort();
  const missing = files.filter((file) => !index.includes(file));
  assert.deepEqual(missing, [], `docs/README.md omits:\n${missing.join("\n")}`);
});
