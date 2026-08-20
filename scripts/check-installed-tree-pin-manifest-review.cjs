#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
const { spawnSync } = require("node:child_process");
const path = require("node:path");

const ROOT = process.env.SEAL_PINMANIFEST_ROOT || path.join(__dirname, "..");
const MANIFEST = "scripts/installed-tree-pin-sites.json";

function git(args) {
  return spawnSync("git", ["-C", ROOT, ...args], { encoding: "utf8" });
}

function fail(message, detail = "") {
  process.stderr.write(
    `::error file=${MANIFEST}::PINMANIFEST REVIEW REQUIRED (INJECTED): ${message}\n` +
      "PINMANIFEST REVIEW REQUIRED (INJECTED)\n" +
      "Human control: Ben must review every added, removed, or moved installed-tree pin site.\n" +
      "Required check: compare this manifest diff against the surrounding documentation diff and confirm each quoted store/tree hash site still has exactly one declared file, line, column, kind, and role.\n" +
      "This job is a loud review brake only; it does not make the repository-local manifest an enforced source of truth.\n" +
      detail,
  );
  process.exitCode = 1;
}

function usage() {
  process.stderr.write(
    "usage: node scripts/check-installed-tree-pin-manifest-review.cjs [--base <rev> --head <rev>] [--worktree-only]\n",
  );
  process.exitCode = 2;
}

function parseArgs(argv) {
  const options = { base: "", head: "HEAD", worktreeOnly: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--base") {
      options.base = argv[++index] || "";
    } else if (arg === "--head") {
      options.head = argv[++index] || "";
    } else if (arg === "--worktree-only") {
      options.worktreeOnly = true;
    } else {
      return null;
    }
  }
  if (options.worktreeOnly && options.base) return null;
  return options;
}

function changedByDiff(args) {
  const result = git(["diff", "--name-only", ...args, "--", MANIFEST]);
  if (result.status !== 0) {
    process.stderr.write(result.stdout + result.stderr);
    process.exitCode = result.status || 1;
    return false;
  }
  return result.stdout.split(/\r?\n/).includes(MANIFEST);
}

function diffDetail(args) {
  const result = git(["diff", "--stat", ...args, "--", MANIFEST]);
  return result.status === 0 && result.stdout ? `\n${result.stdout}` : "";
}

const options = parseArgs(process.argv.slice(2));
if (!options) {
  usage();
} else if (options.base) {
  const head = options.head || "HEAD";
  if (changedByDiff([options.base, head])) {
    fail(`${MANIFEST} changed between ${options.base} and ${head}.`, diffDetail([options.base, head]));
  } else {
    process.stdout.write(`PINMANIFEST REVIEW OK: ${MANIFEST} unchanged between ${options.base} and ${head}.\n`);
  }
} else {
  const unstaged = changedByDiff([]);
  const staged = changedByDiff(["--cached"]);
  if (unstaged || staged) {
    fail(`${MANIFEST} has staged or unstaged local changes.`, diffDetail(["HEAD"]));
  } else {
    process.stdout.write(`PINMANIFEST REVIEW OK: ${MANIFEST} has no staged or unstaged local changes.\n`);
  }
}
