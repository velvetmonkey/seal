#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
const { spawnSync } = require("node:child_process");
const path = require("node:path");

const ROOT = process.env.SEAL_PINMANIFEST_ROOT || path.join(__dirname, "..");
const MANIFEST = "scripts/installed-tree-pin-sites.json";
const RULING_DOCUMENT = "docs/PINMANIFEST-RULINGS.json";

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
    return { error: result.stdout + result.stderr, status: result.status || 1 };
  }
  return { changed: result.stdout.split(/\r?\n/).includes(MANIFEST) };
}

function diffDetail(args) {
  const result = git(["diff", "--stat", ...args, "--", MANIFEST]);
  return result.status === 0 && result.stdout ? `\n${result.stdout}` : "";
}

function resolveCommit(ref, label) {
  const result = git(["rev-parse", "--verify", "--end-of-options", `${ref}^{commit}`]);
  if (result.status !== 0) {
    const reason = (result.stderr || result.stdout).trim() || `git exited ${result.status || 1}`;
    fail(`${label} ref "${ref}" is unresolvable: ${reason}`);
    return null;
  }
  return result.stdout.trim();
}

// CLAIM-COVERAGE: docs/PINMANIFEST-RULINGS.json
function exactRuling(mergeBase, head, changedPaths) {
  const record = git(["show", `${head}:${RULING_DOCUMENT}`]);
  if (record.status !== 0) return null;
  let ruling;
  try {
    ruling = JSON.parse(record.stdout);
  } catch {
    return null;
  }
  const detail = ruling?.ruling;
  if (!detail || detail.base !== mergeBase || !Array.isArray(detail.files) || detail.files.length === 0) return null;
  const recorded = detail.files.map((file) => file?.path).sort();
  if (new Set(recorded).size !== recorded.length
    || detail.files.some((file) => !file || typeof file.path !== "string"
      || typeof file.blob !== "string" || !/^[0-9a-f]{40}$/.test(file.blob)
      || file.path !== MANIFEST)) return null;
  const actual = [...changedPaths].sort();
  if (actual.length !== recorded.length || actual.some((value, index) => value !== recorded[index])) return null;
  for (const file of detail.files) {
    const actualBlob = git(["rev-parse", "--verify", `${head}:${file.path}`]);
    if (actualBlob.status !== 0 || actualBlob.stdout.trim() !== file.blob) return null;
  }
  return detail;
}

const options = parseArgs(process.argv.slice(2));
if (!options) {
  usage();
} else if (options.base) {
  const requestedHead = options.head || "HEAD";
  const base = resolveCommit(options.base, "base");
  const head = resolveCommit(requestedHead, "head");
  if (base && head) {
    const result = changedByDiff([base, head]);
    if (result.error) {
      fail(`could not compare ${MANIFEST} between base ref "${options.base}" and head ref "${requestedHead}": ${result.error.trim()}`);
    } else if (result.changed) {
      const mergeBase = git(["merge-base", base, head]);
      const ruling = mergeBase.status === 0
        ? exactRuling(mergeBase.stdout.trim(), head, [MANIFEST])
        : null;
      if (ruling) {
        process.stdout.write(`PINMANIFEST REVIEW OK: recorded human ruling for ${ruling.base}: ${MANIFEST}.\n`);
      } else {
        fail(`${MANIFEST} changed between ${options.base} and ${requestedHead}.`, diffDetail([base, head]));
      }
    } else {
      process.stdout.write(`PINMANIFEST REVIEW OK: ${MANIFEST} unchanged between ${options.base} and ${requestedHead}.\n`);
    }
  }
} else {
  const unstaged = changedByDiff([]);
  const staged = changedByDiff(["--cached"]);
  if (unstaged.error || staged.error) {
    const error = unstaged.error || staged.error;
    fail(`could not inspect local changes to ${MANIFEST}: ${error.trim()}`);
  } else if (unstaged.changed || staged.changed) {
    fail(`${MANIFEST} has staged or unstaged local changes.`, diffDetail(["HEAD"]));
  } else {
    process.stdout.write(`PINMANIFEST REVIEW OK: ${MANIFEST} has no staged or unstaged local changes.\n`);
  }
}
