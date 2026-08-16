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

const notesCandidates = fs.readdirSync(path.join(ROOT, "docs")).filter((file) => /^RELEASE-NOTES-v\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?\.md$/.test(file));
if (notesCandidates.length !== 1) throw new Error(`expected one versioned release-notes file, found ${notesCandidates.join(", ")}`);
if (notesCandidates[0] !== releaseNotes) fs.renameSync(path.join(ROOT, "docs", notesCandidates[0]), path.join(ROOT, "docs", releaseNotes));
for (const file of fs.readdirSync(path.join(ROOT, "docs")).filter((file) => file.endsWith(".md"))) {
  replaceIfPresent(path.join("docs", file), /RELEASE-NOTES-v\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?\.md/g, releaseNotes);
}
replaceIfPresent("index.html", /RELEASE-NOTES-v\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?\.md/g, releaseNotes);
replaceIfPresent("docs/README.md", /what v\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)? contains/g, `what v${version} contains`);
replaceIfPresent("docs/README.md", /how v\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)? got its shape/g, `how v${version} got its shape`);

for (const file of ["README.md", "docs/DISTRIBUTION.md", path.join("docs", releaseNotes), "index.html", "spine/platform.cjs", "scripts/install.cjs", "scripts/seal-launch.cjs", ".github/workflows/release.yml"]) {
  replace(file, /Seal v\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?/g, `Seal v${version}`);
}

// These are release claims addressed to readers, but do not carry the "Seal"
// prefix. Keep their version identity in step with VERSION as well.
for (const file of ["README.md", path.join("docs", "guide", "README.md"), path.join("docs", "guide", "when-something-looks-wrong.md")]) {
  replace(file, /(?<!seal-)\bv\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?\b/g, `v${version}`);
}

for (const file of ["README.md", "docs/DISTRIBUTION.md", "docs/guide/README.md"]) {
  replace(file, /seal-v\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?-linux-x64/g, `seal-v${version}-linux-x64`);
}

for (const file of ["README.md", "docs/guide/README.md"]) {
  replaceIfPresent(file, /installed seal \d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)? linux-x64/g, `installed seal ${version} linux-x64`);
}
