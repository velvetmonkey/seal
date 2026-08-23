#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Correspondence contract: compare the canonical() declaration, scalar/string/
// array encodings, UTF-8 object-key ordering, object encoding, and closing brace.
// Deliberately excluded from the sealer are its undefined/non-finite refusal
// region and its unsupported-non-object refusal region; the checker omits both.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const CHECKER = "checker/seal-receipt-check.mjs";
const SEALER = "spine/receipt-seal.cjs";

function canonicalLines(file) {
  const lines = readFileSync(resolve(ROOT, file), "utf8").split("\n");
  const first = lines.findIndex((line) => line === "function canonical(value) {");
  if (first === -1) throw new Error(`${file}: canonical(value) declaration is missing`);
  const lastOffset = lines.slice(first + 1).findIndex((line) => line === "}");
  if (lastOffset === -1) throw new Error(`${file}:${first + 1}: canonical(value) closing brace is missing`);
  return lines.slice(first, first + lastOffset + 2).map((text, index) => ({ text, line: first + index + 1 }));
}

function omitSealerRefusals(entries) {
  const kept = [];
  const omitted = [];
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    if (entry.text.includes("if (value === undefined)")) {
      omitted.push(entry);
      continue;
    }
    if (entry.text.includes('if (typeof value === "number" && !Number.isFinite(value))')) {
      omitted.push(entry, entries[index + 1], entries[index + 2]);
      index += 2;
      continue;
    }
    if (entry.text.includes('if (typeof value !== "object")')) {
      omitted.push(entry, entries[index + 1], entries[index + 2]);
      index += 2;
      continue;
    }
    kept.push(entry);
  }
  return { kept, omitted };
}

let checker;
let sealer;
try {
  checker = canonicalLines(CHECKER);
  sealer = omitSealerRefusals(canonicalLines(SEALER));
} catch (error) {
  console.error(`FAIL receipt canonicalization correspondence: ${CHECKER} and ${SEALER}: ${error.message}`);
  process.exit(1);
}

const length = Math.max(checker.length, sealer.kept.length);
for (let index = 0; index < length; index += 1) {
  const left = checker[index];
  const right = sealer.kept[index];
  if (left?.text.trim() !== right?.text.trim()) {
    console.error("FAIL receipt canonicalization correspondence");
    console.error(`${CHECKER}:${left?.line ?? "missing"}: ${left?.text.trim() ?? "<missing>"}`);
    console.error(`${SEALER}:${right?.line ?? "missing"}: ${right?.text.trim() ?? "<missing>"}`);
    console.error(`differing corresponding line ${index + 1}; both files must implement the same declared receipt canonicalization rule`);
    process.exit(1);
  }
}

const omissionLines = sealer.omitted.map(({ line }) => line);
console.log(
  `PASS receipt canonicalization correspondence: ${CHECKER} and ${SEALER}; ` +
  `compared ${checker.length} shared lines; deliberately omitted sealer refusal lines ${omissionLines.join(",")}`,
);
