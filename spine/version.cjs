// SPDX-License-Identifier: Apache-2.0
// One version string. VERSION is the release number; package.json must match.
const fs = require("node:fs");
const path = require("node:path");

function sealVersion() {
  return fs.readFileSync(path.join(__dirname, "..", "VERSION"), "utf8").trim();
}

function packageVersion() {
  return require("../package.json").version;
}

function requireMatchingVersion() {
  const version = sealVersion();
  const pkg = packageVersion();
  if (pkg !== version) {
    const error = new Error(`package.json version ${pkg} does not match VERSION ${version}`);
    error.code = "version_mismatch";
    throw error;
  }
  return version;
}

module.exports = { sealVersion, packageVersion, requireMatchingVersion };
