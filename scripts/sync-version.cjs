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

function replaceIfPresent(file, expression, replacement) {
  const target = path.join(ROOT, file);
  const before = fs.readFileSync(target, "utf8");
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

// These are release claims addressed to readers, but do not carry the "Seal"
// prefix. Keep their version identity in step with VERSION as well.
for (const file of [path.join("docs", "guide", "when-something-looks-wrong.md")]) {
  replace(file, /(?<!seal-)\bv\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?\b/g, (match) => match.endsWith(".md") ? match : `v${version}`);
}

// An artifact filename carries the product identity, not the release version
// alone: a build that is not the tag says so in its own name. A version bump
// re-versions the name and leaves the commit it identifies alone.
const ARTIFACT_NAME = /seal-v\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?-linux-x64/g;
function renameArtifact(match) {
  const development = match.match(/-dev\.g([0-9a-f]{7,40})-linux-x64$/);
  return development ? `seal-v${version}-dev.g${development[1]}-linux-x64` : `seal-v${version}-linux-x64`;
}
// Download instructions derive the artifact name from the checksum asset from
// the same release, so these guides intentionally have no versioned filename.
replaceIfPresent("docs/assurance/distribution.md", ARTIFACT_NAME, renameArtifact);
