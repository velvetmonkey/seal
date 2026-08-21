#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Merge transaction: materialise the post-merge tree, then refresh and record.
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ROOT = path.join(__dirname, "..");
const LEDGER = path.join(ROOT, "docs", "INSTALLED-TREE-REFRESHES.json");
const HASH = /^[0-9a-f]{64}$/;

function run(command, args) {
  const result = spawnSync(command, args, { cwd: ROOT, encoding: "utf8", stdio: "inherit" });
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed with ${result.status}`);
}

function pin() {
  const text = fs.readFileSync(path.join(ROOT, "docs/install.md"), "utf8");
  const match = text.match(/\*\*Seal installed-tree pin role:\*\* `fresh-build`[\s\S]*?tree: ([0-9a-f]{64})/);
  if (!match) throw new Error("REFUSE fresh_build_pin_absent: docs/install.md has no fresh-build tree pin");
  return match[1];
}

function main() {
  const merge = process.argv[2];
  if (!merge || process.argv.length !== 3) throw new Error("usage: node scripts/merge-tree-refresh.cjs <branch-or-commit>");
  run("git", ["merge", "--no-commit", "--no-ff", merge]);
  try {
    const old = pin();
    run(process.execPath, [path.join(ROOT, "scripts", "sync-installed-tree-pin.cjs")]);
    const fresh = pin();
    if (!HASH.test(old) || !HASH.test(fresh)) throw new Error("REFUSE malformed fresh-build pin");
    const mergeSha = spawnSync("git", ["rev-parse", "MERGE_HEAD"], { cwd: ROOT, encoding: "utf8" }).stdout.trim();
    if (!/^[0-9a-f]{40}$/.test(mergeSha)) throw new Error("REFUSE merge_sha_absent: MERGE_HEAD is unavailable");
    const ledger = JSON.parse(fs.readFileSync(LEDGER, "utf8"));
    if (!Array.isArray(ledger.entries)) throw new Error("REFUSE ledger_invalid: entries array is absent");
    ledger.entries.push({ old, new: fresh, merge: mergeSha });
    fs.writeFileSync(LEDGER, `${JSON.stringify(ledger, null, 2)}\n`);
    run("git", ["add", "docs/install.md", "docs/INSTALLED-TREE-REFRESHES.json"]);
    process.stdout.write(`Prepared merge ${mergeSha}: installed-tree pin ${old} -> ${fresh}; commit the merge to main.\n`);
  } catch (error) {
    run("git", ["merge", "--abort"]);
    throw error;
  }
}

try { main(); } catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
