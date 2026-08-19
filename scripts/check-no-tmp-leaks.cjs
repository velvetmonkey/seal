#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Snapshot the names directly under /tmp, run a command, fail if any new
// name appeared. Unreadable /tmp is a finding, not a pass.
"use strict";

const fs = require("node:fs");
const { spawnSync } = require("node:child_process");

function snapshotTmp() {
  try {
    return fs.readdirSync("/tmp");
  } catch (error) {
    console.error(`TEMP LEAK CHECK: cannot read /tmp: ${error.message}`);
    process.exit(1);
  }
}

function newTmpNames(before) {
  return snapshotTmp().filter((name) => !before.has(name)).sort();
}

function reportLeaks(names) {
  if (!names.length) return false;
  console.error(`TEMP LEAK: created directly under /tmp: ${names.map((name) => `/tmp/${name}`).join(", ")}`);
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
