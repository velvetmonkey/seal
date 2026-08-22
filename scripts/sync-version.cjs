#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// VERSION is the one declared release identity. This script materializes it in
// package metadata and reader-facing release copy before a release build.
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const version = fs.readFileSync(path.join(ROOT, "VERSION"), "utf8").trim();
const releaseNotes = `RELEASE-NOTES-v${version}.md`;

if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.test(version)) throw new Error(`VERSION is not exact SemVer: ${version}`);

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

const notesCandidates = fs.readdirSync(path.join(ROOT, "docs", "assurance")).filter((file) => /^RELEASE-NOTES-v\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?\.md$/.test(file));
if (notesCandidates.length !== 1) throw new Error(`expected one versioned release-notes file, found ${notesCandidates.join(", ")}`);
if (notesCandidates[0] !== releaseNotes) fs.renameSync(path.join(ROOT, "docs", "assurance", notesCandidates[0]), path.join(ROOT, "docs", "assurance", releaseNotes));
for (const file of fs.readdirSync(path.join(ROOT, "docs", "assurance")).filter((file) => file.endsWith(".md"))) {
  replaceIfPresent(path.join("docs", "assurance", file), /RELEASE-NOTES-v\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?\.md/g, releaseNotes);
}
// Reader-facing routes outside assurance cite the release-note filename too.
// Keep those links attached to the note when VERSION renames it.
for (const file of [
  "README.md",
  "docs/archive/CLAIMS-MATRIX.md",
  "docs/archive/TRUTH-BOX.md",
  "docs/archive/LIMITATIONS.md",
  "docs/archive/AUTHORIZATION-MESH.md",
  "docs/archive/WHY-DIFFERENT.md",
  "docs/archive/WHAT-SEAL-IS.md",
]) {
  replaceIfPresent(file, /RELEASE-NOTES-v\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?\.md/g, releaseNotes);
}
replaceIfPresent("docs/assurance/index.html", /RELEASE-NOTES-v\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?\.md/g, releaseNotes);
replaceIfPresent("docs/assurance/README.md", /what v\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)? contains/g, `what v${version} contains`);
replaceIfPresent("docs/assurance/README.md", /how v\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)? got its shape/g, `how v${version} got its shape`);

for (const file of ["README.md", "docs/assurance/distribution.md", "docs/start/install.md", path.join("docs/assurance", releaseNotes), "docs/assurance/index.html", "spine/platform.cjs", "scripts/install.cjs", "scripts/seal-launch.cjs"]) {
  replace(file, /Seal v\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?/g, `Seal v${version}`);
}

// These are release claims addressed to readers, but do not carry the "Seal"
// prefix. Keep their version identity in step with VERSION as well.
for (const file of ["README.md", "docs/start/install.md", "docs/start/evaluator-walk.md", path.join("docs", "guide", "when-something-looks-wrong.md")]) {
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
replace("README.md", ARTIFACT_NAME, renameArtifact);
// Download instructions derive the artifact name from the checksum asset from
// the same release, so these guides intentionally have no versioned filename.
replaceIfPresent("docs/assurance/distribution.md", ARTIFACT_NAME, renameArtifact);
replaceIfPresent("docs/guide/README.md", ARTIFACT_NAME, renameArtifact);

for (const file of ["README.md", "docs/guide/README.md", "docs/start/install.md"]) {
  replaceIfPresent(file, /installed seal \d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)? linux-x64/g, `installed seal ${version} linux-x64`);
}
