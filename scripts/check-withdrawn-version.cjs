#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Offline release-withdrawal policy. Judge committed inputs, including on main.
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const ROOT = path.join(__dirname, "..");
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

function checkWithdrawal(version, withdrawn) {
  if (typeof version !== "string" || !SEMVER.test(version)) {
    throw new Error("withdrawal check: VERSION is not exact SemVer");
  }
  if (!Array.isArray(withdrawn) || withdrawn.length === 0) {
    throw new Error("withdrawal check: withdrawal record must be a nonempty array");
  }
  const seen = new Set();
  for (const entry of withdrawn) {
    if (!entry || typeof entry.version !== "string" || !SEMVER.test(entry.version)
        || typeof entry.reason !== "string" || !entry.reason.trim() || seen.has(entry.version)) {
      throw new Error("withdrawal check: invalid or duplicate withdrawal record");
    }
    seen.add(entry.version);
  }
  const entry = withdrawn.find((item) => item.version === version);
  if (entry) throw new Error(`withdrawal check REFUSED: v${version}: ${entry.reason}`);
  return `withdrawal check OK: v${version} is not listed as withdrawn`;
}

function committed(file) {
  const result = spawnSync("git", ["show", `HEAD:${file}`], { cwd: ROOT, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`withdrawal check: cannot read committed ${file}`);
  return result.stdout;
}

if (require.main === module) {
  try {
    const version = committed("VERSION").trim();
    const withdrawn = JSON.parse(committed("scripts/withdrawn-versions.json"));
    process.stdout.write(`${checkWithdrawal(version, withdrawn)}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
module.exports = { checkWithdrawal };
