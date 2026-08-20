// SPDX-License-Identifier: Apache-2.0
// Independent over-broad detector for installed-tree pin claims that sit
// outside the shared three-file array. This module must not call the pin
// scanner it polices: a file the scanner cannot classify is exactly the file
// this watchdog reports.
const fs = require("node:fs");
const path = require("node:path");

// Duplicated on purpose. Importing the scanner module would couple the
// watchdog to the grammar it is meant to police. A test asserts this list
// still equals listInstalledTreePinFiles().
const LISTED_PIN_FILES = Object.freeze([
  "README.md",
  "docs/guide/README.md",
  "docs/COMPREHENSION-CHECK.md",
]);

function listedPinFiles() {
  return LISTED_PIN_FILES;
}

function isHashShapedToken(token) {
  if (/^[0-9a-fA-F]{32,}$/.test(token)) return true;
  if (/^0x[0-9a-fA-F]{32,}$/i.test(token)) return true;
  const stripped = token.replace(/[:._-]/g, "");
  if (stripped !== token && /^[0-9a-fA-F]+$/.test(stripped) && stripped.length >= 32) return true;
  if (/^[A-Za-z0-9+/]{40,}={0,2}$/.test(token) && token.length >= 40 && token.length <= 48) return true;
  return false;
}

function detectUnlistedPinSuspects(text) {
  const reasons = [];
  for (const match of text.matchAll(/\/store\/([^\s/]+)/g)) {
    if (isHashShapedToken(match[1])) {
      reasons.push(`store_path:${match[1]}`);
    }
  }
  for (const match of text.matchAll(/\btree(:(?:[ \t]*)|[ \t]+)([^\s]+)/g)) {
    if (isHashShapedToken(match[2])) {
      reasons.push(`tree_hash:${match[2]}`);
    }
  }
  if (reasons.length > 0 && /Seal installed-tree pin role/i.test(text)) {
    reasons.unshift("role_marker");
  }
  return reasons;
}

function watchUnlistedInstalledTreePinFiles(root, trackedFiles) {
  const listed = new Set(LISTED_PIN_FILES);
  const strays = [];
  for (const relative of trackedFiles) {
    if (listed.has(relative)) continue;
    let text;
    try {
      text = fs.readFileSync(path.join(root, relative), "utf8");
    } catch (error) {
      strays.push({
        file: relative,
        reasons: [`unreadable:${error.message}`],
      });
      continue;
    }
    const reasons = detectUnlistedPinSuspects(text);
    if (reasons.length > 0) {
      strays.push({ file: relative, reasons });
    }
  }
  return { strays };
}

module.exports = {
  LISTED_PIN_FILES,
  listedPinFiles,
  isHashShapedToken,
  detectUnlistedPinSuspects,
  watchUnlistedInstalledTreePinFiles,
};
