// SPDX-License-Identifier: Apache-2.0
// Test-fixture temp directories. Removed after the file's tests finish,
// including assertion failures. Set KEEP_TMP=1 to retain them as evidence.
"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { after } = require("node:test");

const owned = new Set();
let hooked = false;

function keep() {
  const value = process.env.KEEP_TMP;
  return value === "1" || value === "true";
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
      try { fs.chmodSync(full, 0o600); } catch { /* best-effort */ }
    }
  }
}

function rm(dir) {
  if (keep() || !dir) return;
  try {
    chmodTree(dir);
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* best-effort */
  }
}

function hook() {
  if (hooked) return;
  hooked = true;
  after(() => {
    for (const dir of owned) rm(dir);
    owned.clear();
  });
  process.on("exit", () => {
    for (const dir of owned) rm(dir);
    owned.clear();
  });
}

function track(dir, t) {
  if (t && typeof t.after === "function") {
    t.after(() => rm(dir));
  } else {
    owned.add(dir);
    hook();
  }
  return dir;
}

function tmpdir(a, b) {
  const t = typeof a === "object" && a && typeof a.after === "function" ? a : b;
  const prefix = typeof a === "string" ? a : b;
  if (typeof prefix !== "string" || prefix.length === 0) {
    throw new Error("tmpdir requires a prefix");
  }
  return track(fs.mkdtempSync(path.join(os.tmpdir(), prefix)), t);
}

hook();

module.exports = { tmpdir, track, keep };
