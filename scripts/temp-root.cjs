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
const os = require("node:os");
const path = require("node:path");

const testScopedRoots = new Set();
const processScopedRoots = new Set();
let testCleanupHooked = false;
let processCleanupHooked = false;

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
  ]) || path.join(path.dirname(path.resolve(repoRoot)), ".seal-tmp");
}

function makeTempRoot(repoRoot, name) {
  const parent = defaultParent(repoRoot);
  fs.mkdirSync(parent, { recursive: true });
  return fs.realpathSync(fs.mkdtempSync(path.join(parent, `${name}-`)));
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
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) chmodTree(full);
    else {
      try { fs.chmodSync(full, 0o600); } catch { /* continue */ }
    }
  }
}

function cleanup(root = process.env.TMPGUARD_RUN_ROOT, options = {}) {
  if (!root) return;
  const keep = process.env.KEEP_TMP;
  if (keep === "1" || keep === "true") return;
  if (isUnderTmp(root)) return;
  if (
    process.env.TMPGUARD_RUN_ROOT
    && path.resolve(root) === path.resolve(process.env.TMPGUARD_RUN_ROOT)
    && options.allowRunRoot !== true
  ) return;
  try {
    chmodTree(root);
    fs.rmSync(root, { recursive: true, force: true });
  } catch {
    /* best-effort: a leftover owned root is a finding, not a /tmp write */
  }
}

function cleanupProcessScopedRoots() {
  for (const root of testScopedRoots) cleanup(root);
  for (const root of processScopedRoots) cleanup(root);
  testScopedRoots.clear();
  processScopedRoots.clear();
}

function hookProcessCleanup() {
  if (processCleanupHooked) return;
  processCleanupHooked = true;
  process.once("exit", cleanupProcessScopedRoots);
}

function hookTestCleanup() {
  if (testCleanupHooked) return;
  testCleanupHooked = true;
  const { after } = require("node:test");
  after(() => {
    for (const root of testScopedRoots) cleanup(root);
    testScopedRoots.clear();
  });
  hookProcessCleanup();
}

function testTmpdir(prefix, options = {}) {
  const resolvedPrefix = path.dirname(prefix) === "." ? path.join(os.tmpdir(), prefix) : prefix;
  const root = fs.realpathSync(fs.mkdtempSync(resolvedPrefix));
  if (options.keep === true) {
    processScopedRoots.add(root);
  } else {
    testScopedRoots.add(root);
  }
  hookTestCleanup();
  return root;
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
    process.once("exit", () => cleanup(root, { allowRunRoot: true }));
    process.once("SIGTERM", () => {
      cleanup(root, { allowRunRoot: true });
      process.exit(143);
    });
    process.once("SIGINT", () => {
      cleanup(root, { allowRunRoot: true });
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
    cleanup(process.argv[3] || process.env.TMPGUARD_RUN_ROOT, { allowRunRoot: true });
    return;
  }
  console.error("usage: temp-root.cjs --make <repoRoot> <name> | --cleanup [root]");
  process.exit(2);
}

if (require.main !== module && process.env.NODE_TEST_CONTEXT) hookTestCleanup();
if (require.main === module) main();

module.exports = {
  install,
  makeTempRoot,
  cleanup,
  isUnderTmp,
  firstOwnedParent,
  testTmpdir,
};
