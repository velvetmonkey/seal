// SPDX-License-Identifier: Apache-2.0
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.join(__dirname, "..");

test("boundary list names the implemented limits", () => {
  const readme = fs.readFileSync(path.join(ROOT, "README.md"), "utf8");
  const limits = readme.match(/## What Seal covers, and what it does not\n\n([\s\S]*?)(?=\n## )/);
  assert.ok(limits, "README must contain the boundary list");

  for (const phrase of [
    "stdio MCP server entry",
    "automatic elicitation hook",
    "local wall clock",
    "separately pinned runtime from GitHub",
    "Claude Code, whose configuration and backups remain after Unprotect",
    "user-writable prefix",
  ]) {
    assert.ok(limits[1].includes(phrase), `boundary list must name: ${phrase}`);
  }
});
