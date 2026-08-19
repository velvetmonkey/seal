#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// One choke point for test-harness temporary directories.
// Honour a caller-owned TMPDIR/TMP/TEMP. Treat /tmp (the OS default) as
// unset and fall back to <repo>/.tmp. Create one run-scoped child and put
// it on the process environment so os.tmpdir() and mktemp follow it.
// Remove that child on exit, including a failing run, unless KEEP_TMP=1.
// Never remove anything under /tmp.
"use strict";

const fs = require("node:fs");
const path = require("node:path");

function isUnderTmp(root) {
  const resolved = path.resolve(root);
  return resolved === "/tmp" || resolved.startsWith("/tmp/");
}

function firstOwnedParent(candidates) {
  for (const candidate of candidates) {
    if (typeof candidate !== "string") continue;
    const trimmed = candidate.trim();
    if (!trimmed) continue;
    if (isUnderTmp(trimmed)) continue;
    return trimmed;
  }
  return null;
}

function defaultParent(repoRoot) {
  return firstOwnedParent([
    process.env.TMPDIR,
    process.env.TMP,
    process.env.TEMP,
    process.env.RUNNER_TEMP,
  ]) || path.join(repoRoot, ".tmp");
}

function makeTempRoot(repoRoot, name) {
  const parent = defaultParent(repoRoot);
  fs.mkdirSync(parent, { recursive: true });
  return fs.mkdtempSync(path.join(parent, `${name}-`));
}

function chmodTree(dir) {
  try {
    fs.chmodSync(dir, 0o700);
  } catch {
    return;
  }
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory() && !entry.isSymbolicLink()) chmodTree(full);
    else {
      try { fs.chmodSync(full, 0o600); } catch { /* continue */ }
    }
  }
}

function cleanup(root = process.env.TMPGUARD_RUN_ROOT) {
  if (!root) return;
  const keep = process.env.KEEP_TMP;
  if (keep === "1" || keep === "true") return;
  if (isUnderTmp(root)) return;
  try {
    chmodTree(root);
    fs.rmSync(root, { recursive: true, force: true });
  } catch {
    /* best-effort: a leftover owned root is a finding, not a /tmp write */
  }
}

function install(repoRoot, name) {
  const root = process.env.TMPGUARD_RUN_ROOT || makeTempRoot(repoRoot, name);
  process.env.TMPDIR = root;
  process.env.TMP = root;
  process.env.TEMP = root;
  process.env.TMPGUARD_RUN_ROOT = root;
  if (!process.env.GIT_CEILING_DIRECTORIES) {
    process.env.GIT_CEILING_DIRECTORIES = root;
  }
  if (process.env.TMPGUARD_CLEANUP_HOOKED !== "1") {
    process.env.TMPGUARD_CLEANUP_HOOKED = "1";
    process.once("exit", () => cleanup(root));
    process.once("SIGTERM", () => {
      cleanup(root);
      process.exit(143);
    });
    process.once("SIGINT", () => {
      cleanup(root);
      process.exit(130);
    });
  }
  return root;
}

function main() {
  const mode = process.argv[2];
  if (mode === "--make") {
    const repoRoot = process.argv[3];
    const name = process.argv[4];
    if (!repoRoot || !name) {
      console.error("usage: temp-root.cjs --make <repoRoot> <name>");
      process.exit(2);
    }
    process.stdout.write(`${makeTempRoot(repoRoot, name)}\n`);
    return;
  }
  if (mode === "--cleanup") {
    cleanup(process.argv[3] || process.env.TMPGUARD_RUN_ROOT);
    return;
  }
  console.error("usage: temp-root.cjs --make <repoRoot> <name> | --cleanup [root]");
  process.exit(2);
}

if (require.main === module) main();

module.exports = { install, makeTempRoot, cleanup, isUnderTmp, firstOwnedParent };
