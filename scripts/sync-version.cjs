#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// VERSION is the one declared release identity. This script materializes it in
// package metadata and reader-facing release copy before a release build.
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const version = fs.readFileSync(path.join(ROOT, "VERSION"), "utf8").trim();
const releaseNotes = `RELEASE-NOTES-v${version}.md`;

if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`VERSION is not exact SemVer: ${version}`);

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
fs.writeFileSync(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);

const notesCandidates = fs.readdirSync(path.join(ROOT, "docs")).filter((file) => /^RELEASE-NOTES-v\d+\.\d+(?:\.\d+)?\.md$/.test(file));
if (notesCandidates.length !== 1) throw new Error(`expected one versioned release-notes file, found ${notesCandidates.join(", ")}`);
if (notesCandidates[0] !== releaseNotes) fs.renameSync(path.join(ROOT, "docs", notesCandidates[0]), path.join(ROOT, "docs", releaseNotes));
for (const file of fs.readdirSync(path.join(ROOT, "docs")).filter((file) => file.endsWith(".md"))) {
  replaceIfPresent(path.join("docs", file), /RELEASE-NOTES-v\d+\.\d+(?:\.\d+)?\.md/g, releaseNotes);
}
replaceIfPresent("docs/README.md", /what v\d+\.\d+(?:\.\d+)? contains/g, `what v${version} contains`);
replaceIfPresent("docs/README.md", /how v\d+\.\d+(?:\.\d+)? got its shape/g, `how v${version} got its shape`);

for (const file of ["README.md", "docs/DISTRIBUTION.md", path.join("docs", releaseNotes), "spine/platform.cjs", "scripts/install.cjs", "scripts/seal-launch.cjs", ".github/workflows/release.yml"]) {
  replace(file, /Seal v\d+\.\d+(?:\.\d+)?/g, `Seal v${version}`);
}

for (const file of ["README.md", "docs/DISTRIBUTION.md", "docs/guide/README.md"]) {
  replace(file, /seal-v\d+\.\d+\.\d+-linux-x64/g, `seal-v${version}-linux-x64`);
}

for (const file of ["README.md", "docs/guide/README.md"]) {
  replaceIfPresent(file, /installed seal \d+\.\d+\.\d+ linux-x64/g, `installed seal ${version} linux-x64`);
}
