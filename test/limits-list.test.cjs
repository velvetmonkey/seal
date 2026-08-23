// SPDX-License-Identifier: Apache-2.0
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.join(__dirname, "..");

test("boundary list names the implemented limits", () => {
  const readme = fs.readFileSync(path.join(ROOT, "README.md"), "utf8");
  const limits = readme.match(/## The boundary\n\n([\s\S]*?)(?=\n## )/);
  assert.ok(limits, "README must contain the boundary list");

  for (const phrase of [
    ["Seal controls calls that pass through the protected MCP server path"].join("") + ".",
    "It does not control Bash, direct file writes, network access, subprocesses,\nother MCP servers, or another route to the same effect.",
    ["Seal is a gate, not a sandbox"].join("") + ".",
    ["One approval covers the displayed call only", "A failure before forwarding can\nspend it without running the call", "If a human approves a malicious-but-valid\nrequest, Seal runs it", "Approval expiry follows the local wall clock"].join(". ") + ".",
    "The decision program is bundled as WebAssembly. Its byte-pinned answer is\nrequired before forwarding. A failure or disagreement refuses; there is no\nJavaScript authorization fallback.",
    "Receipts are signed records, not evidence that an event happened.",
  ]) {
    assert.ok(limits[1].includes(phrase), `boundary list must name: ${phrase}`);
  }
});
