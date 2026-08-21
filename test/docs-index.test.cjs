// SPDX-License-Identifier: Apache-2.0
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.join(__dirname, "..");
const DOCS = path.join(ROOT, "docs");
const INDEX = path.join(DOCS, "assurance", "README.md");
const README = path.join(ROOT, "README.md");

function markdownFilesUnder(directory, relativeTo = directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      return markdownFilesUnder(entryPath, relativeTo);
    }
    return entry.isFile() && entry.name.endsWith(".md")
      ? [path.relative(relativeTo, entryPath).split(path.sep).join("/")]
      : [];
  });
}

test("docs index names every Markdown file in docs", () => {
  const index = fs.readFileSync(INDEX, "utf8");
  const files = markdownFilesUnder(DOCS).filter((file) => !["archive/README.md", "archive/findings.md"].includes(file)).sort();
  const missing = files.filter((file) => !index.includes(file));
  assert.deepEqual(missing, [], `docs/assurance/README.md omits:\n${missing.join("\n")}`);
});

test("repository README links the full docs index", () => {
  const readme = fs.readFileSync(README, "utf8");
  const linksDocsIndex = /\]\(docs\/assurance\/README\.md(?:#[^)]+)?\)/.test(readme);
  assert.ok(linksDocsIndex, "README.md must link docs/assurance/README.md");
});
