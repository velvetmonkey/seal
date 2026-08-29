#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const STATE = "(?:PENDING RESTART|ACTIVE|STALE|DRIFTED|BROKEN)";
const oldProtectionState = new RegExp(`Protection:\\s+(?:- outside Seal|${STATE})`);
const sealedRouteState = new RegExp(`Sealed MCP route(?:\\s+[^:]+)?:\\s+(?:- outside Seal|${STATE})`);
const forbiddenFuturePhrase = ["Effect", "protected"].join(" ");

function repositoryFiles(dir = ROOT, prefix = "") {
  const ignored = new Set([".git", "node_modules", "dist", "coverage"]);
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ignored.has(entry.name)) continue;
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...repositoryFiles(full, relative));
    else if (entry.isFile()) out.push(relative);
  }
  return out;
}

function isText(bytes) {
  return !bytes.includes(0);
}

function isScannedProductOrDoc(file) {
  if (file.startsWith("docs/archive/")) return false;
  // Tests may contain deliberate tamper strings that this product control must not reject.
  if (file.startsWith("test/") || file.startsWith("test-support/")) return false;
  return true;
}

function boundaryBlockFrom(lines, start) {
  const out = [];
  for (let i = start; i < lines.length; i += 1) {
    if (i > start && sealedRouteState.test(lines[i])) break;
    out.push(lines[i]);
  }
  return out.join("\n");
}

function checkText(file, text) {
  const failures = [];
  if (text.includes(forbiddenFuturePhrase)) {
    failures.push(`${file}: contains reserved future broker phrase`);
  }
  const lines = text.split(/\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (oldProtectionState.test(line)) {
      failures.push(`${file}:${i + 1}: emits old unbounded Protection state`);
    }
    if (sealedRouteState.test(line)) {
      const boundaryBlock = boundaryBlockFrom(lines, i);
      if (!boundaryBlock.includes("Gated through this route:") || !boundaryBlock.includes("Not controlled:")) {
        failures.push(`${file}:${i + 1}: sealed route state lacks boundary statement`);
      }
    }
  }
  return failures;
}

export function authorizationStatusBoundaryFailures(files = repositoryFiles()) {
  const failures = [];
  for (const file of files.filter(isScannedProductOrDoc)) {
    const full = path.join(ROOT, file);
    const bytes = fs.readFileSync(full);
    if (!isText(bytes)) continue;
    failures.push(...checkText(file, bytes.toString("utf8")));
  }
  return failures;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const failures = authorizationStatusBoundaryFailures();
  if (failures.length > 0) {
    for (const failure of failures) process.stderr.write(`${failure}\n`);
    process.exit(1);
  }
  assert.equal(failures.length, 0);
}
