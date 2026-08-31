#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Snapshot Seal test directories under os.tmpdir(), run a command, and fail
// if any new seal-* or f5-* directory remains.
"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

function isSuiteDirectory(name) {
  return name.startsWith("seal-") || name.startsWith("f5-");
}

function snapshotTmp(root = os.tmpdir()) {
  try {
    return fs.readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && isSuiteDirectory(entry.name))
      .map((entry) => entry.name);
  } catch (error) {
    console.error(`TEMP LEAK CHECK: cannot read ${root}: ${error.message}`);
    process.exit(1);
  }
}

function newTmpNames(before, root = os.tmpdir()) {
  return snapshotTmp(root).filter((name) => !before.has(name)).sort();
}

function reportLeaks(names, root = os.tmpdir()) {
  if (!names.length) return false;
  console.error(`TEMP LEAK: suite directories survived under ${root}: ${names.map((name) => path.join(root, name)).join(", ")}`);
  return true;
}

function main() {
  const command = process.argv[2];
  const args = process.argv.slice(3);
  if (!command) {
    console.error("usage: check-no-tmp-leaks.cjs <command> [args...]");
    process.exit(2);
  }

  const before = new Set(snapshotTmp());
  const result = spawnSync(command, args, { stdio: "inherit", env: process.env });
  if (reportLeaks(newTmpNames(before))) process.exitCode = 1;
  if (result.error) {
    console.error(result.error.message);
    process.exitCode = 1;
  } else if (result.status !== 0) {
    process.exitCode = result.status ?? 1;
  }
}

if (require.main === module) main();

module.exports = { snapshotTmp, newTmpNames, reportLeaks };
