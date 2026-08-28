#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const FORBIDDEN = "/home/" + "monkey";

function filesBelow(directory) {
  const found = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const candidate = path.join(directory, entry.name);
    if (entry.isDirectory()) found.push(...filesBelow(candidate));
    else if (entry.isFile()) found.push(candidate);
  }
  return found;
}

function findForbiddenHostPaths(root = ROOT) {
  const github = path.join(root, ".github");
  if (!fs.existsSync(github)) return [];
  const findings = [];
  for (const file of filesBelow(github)) {
    const text = fs.readFileSync(file, "utf8");
    for (const [index, line] of text.split(/\r?\n/u).entries()) {
      if (line.includes(FORBIDDEN)) {
        findings.push(`${path.relative(root, file)}:${index + 1}:${line.trim()}`);
      }
    }
  }
  return findings;
}

function main() {
  const findings = findForbiddenHostPaths();
  if (findings.length > 0) {
    process.stderr.write("REFUSE workflow_host_path: repository workflows contain a development-box path:\n");
    process.stderr.write(`${findings.join("\n")}\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write("PASS workflow_host_path: no development-box path under .github\n");
}

if (require.main === module) main();

module.exports = { findForbiddenHostPaths };
