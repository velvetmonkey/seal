import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const SCOPE_BLOCK = [
  "> Scope: This document describes the Seal family product, not the Node CLI shipped by this repository.",
  "> This repository ships a Node CLI whose gate is the JavaScript retry contract.",
  "> For the truth about what you installed, read [docs/RELEASE-NOTES-v1.1.md](RELEASE-NOTES-v1.1.md) and the [README](../README.md).",
].join("\n");
const SCOPED_FILES = [
  "ARCHITECTURE.md",
  "AUTHORIZATION-MESH.md",
  "CLAIMS-MATRIX.md",
  "LIMITATIONS.md",
  "TRUTH-BOX.md",
  "WHAT-SEAL-IS.md",
  "WHY-DIFFERENT.md",
];

test("all family-scope documents carry the exact scope signpost", () => {
  for (const name of SCOPED_FILES) {
    const text = readFileSync(resolve(ROOT, "docs", name), "utf8");
    assert.equal(text.startsWith(`${SCOPE_BLOCK}\n\n`), true, `${name} is missing its scope block at the top`);
  }
});
