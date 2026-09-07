#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// VERSION is the candidate build identity. This script materializes it in
// package metadata and candidate-facing copy. Published-release install copy
// is owned by generate-release-docs.mjs and must survive a cut unchanged.
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const version = fs.readFileSync(path.join(ROOT, "VERSION"), "utf8").trim();

if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.test(version)) throw new Error(`VERSION is not exact SemVer: ${version}`);

// A candidate is not releasable until its reader-facing record exists. This is
// deliberately a presence check only: release notes are human-maintained,
// immutable release records, so version synchronization must never create,
// rename, move, or rewrite one.
const releaseNotes = path.join(ROOT, "docs", "assurance", `RELEASE-NOTES-v${version}.md`);
if (!fs.existsSync(releaseNotes) || !fs.statSync(releaseNotes).isFile()) {
  throw new Error(`current release notes are absent: docs/assurance/RELEASE-NOTES-v${version}.md`);
}

function replace(file, expression, replacement) {
  const target = path.join(ROOT, file);
  const before = fs.readFileSync(target, "utf8");
  if (!before.match(expression)) throw new Error(`version marker not found in ${file}`);
  const after = before.replace(expression, replacement);
  if (after !== before) fs.writeFileSync(target, after);
}

const packagePath = path.join(ROOT, "package.json");
const packageJson = JSON.parse(fs.readFileSync(packagePath, "utf8"));
packageJson.version = version;
// build-dist can run concurrently (including from separate test files).  Keep
// readers from ever observing a partially written package manifest.
const packageTempPath = `${packagePath}.${process.pid}.tmp`;
fs.writeFileSync(packageTempPath, `${JSON.stringify(packageJson, null, 2)}\n`);
fs.renameSync(packageTempPath, packagePath);

// RELEASE-NOTES-* files are immutable records of releases that happened.
// Candidate version materialization must never rename them, rewrite their
// bytes, or retarget citations to them. Published-release navigation is owned
// by generate-release-docs.mjs after publication, not by VERSION.
for (const file of ["docs/assurance/distribution.md", "docs/assurance/index.html", "spine/platform.cjs", "scripts/install.cjs", "scripts/seal-launch.cjs"]) {
  replace(file, /Seal v\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?/g, `Seal v${version}`);
}

// Only the unsupported-platform paragraph describes the current source here.
// The earlier recovery caveat names the published release and stays historical.
replace("docs/guide/when-something-looks-wrong.md",
  /^v\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?=\. Seal supports install, demo and receipt checking)/m,
  `v${version}`);

// Distribution download filenames, checksums and checker routes describe the
// published assets; generate-release-docs.mjs owns them after publication.
