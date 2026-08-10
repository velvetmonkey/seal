#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// The README is intentionally brief. This inventory makes every relocated
// claim, caveat, and non-claim name a real documentation home, and fails if
// either the home or its identifying text disappears.
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const inventory = [
  ["default-deny exact-target gate", "docs/CLAIMS-MATRIX.md", "matching live approval record for that exact target"],
  ["one-use approvals expire", "docs/CLAIMS-MATRIX.md", "Approvals are single-use and expire"],
  ["kernel proof scope", "docs/LIMITATIONS.md", "mediation KERNEL, not of the whole deployed system"],
  ["deployment conformance", "docs/CLAIMS-MATRIX.md", "byte-for-byte over the conformance corpus"],
  ["receipt verification", "docs/CLAIMS-MATRIX.md", "Decision receipts (schema v2) validate"],
  ["sufficiency is tested", "docs/CLAIMS-MATRIX.md", "**Tested** (finite refinement analysis)"],
  ["pre-v2 collision and args_hash", "docs/CLAIMS-MATRIX.md", "v2's `args_hash` is the field that closes it"],
  ["proprietary witness-check", "docs/CLAIMS-MATRIX.md", "private sufficiency analyzer"],
  ["authorization not intent", "docs/LIMITATIONS.md", "guarantees AUTHORIZATION match, not INTENT match"],
  ["custody assumption", "docs/TRUTH-BOX.md", "identity and key-custody assumption"],
  ["host and operator compromise", "docs/LIMITATIONS.md", "does NOT prevent compromise of hosts, browsers, build systems, keys, operators"],
  ["audit evidence boundary", "docs/LIMITATIONS.md", "tamper-EVIDENT, not tamper-IMPOSSIBLE"],
  ["no hallucination claim", "docs/LIMITATIONS.md", "does NOT make the AI smarter or prevent hallucinations"],
  ["cryptographic assumption", "docs/LIMITATIONS.md", "does NOT prove SHA-256 collision resistance"],
  ["fleet shared-store counterexample", "docs/CLAIMS-MATRIX.md", "shared DB"],
  ["fleet safe shapes", "docs/CLAIMS-MATRIX.md", "sealv2_partitioned_safe"],
  ["fleet TTL scope", "docs/AUTHORIZATION-MESH.md", "within the approval's TTL window"],
  ["mesh is separate architecture", "docs/AUTHORIZATION-MESH.md", "Model-level"],
  ["MCP is an adapter", "docs/WHAT-SEAL-IS.md", "transport question is a deployment detail"],
  ["ambient authority boundary", "docs/WHAT-SEAL-IS.md", "ambient authority we do not see"],
  ["attack replay provenance", "docs/WHY-DIFFERENT.md", "same destructive call, blocked with Seal on"],
  ["trust boundaries", "docs/LIMITATIONS.md", "## Trust boundaries"],
  ["receipt record shape", "docs/AUTHORIZATION-RECORD.md", "The four-leg authorization record"],
  ["family architecture", "docs/ARCHITECTURE.md", "Seal family architecture"],
  ["contribution and repo boundary", "docs/REPO-TOPOLOGY.md", "Repository topology and deployment model"],
];

let failures = 0;
for (const [name, file, needle] of inventory) {
  const path = resolve(root, file);
  if (!existsSync(path)) {
    console.error(`MISSING HOME  ${name}: ${file}`);
    failures++;
  } else if (!readFileSync(path, "utf8").includes(needle)) {
    console.error(`LOST CLAIM  ${name}: ${file} no longer contains ${JSON.stringify(needle)}`);
    failures++;
  }
}
console.log(`claim-inventory: ${inventory.length} entries, ${failures} lost`);
process.exit(failures ? 1 : 0);
