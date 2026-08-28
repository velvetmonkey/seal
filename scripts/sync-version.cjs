#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// VERSION is the candidate build identity. This script materializes it in
// package metadata and candidate-facing copy. Published-release install copy
// is owned by generate-release-docs.mjs and must survive a cut unchanged.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

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
for (const file of ["docs/assurance/distribution.md", "spine/platform.cjs", "scripts/install.cjs", "scripts/seal-launch.cjs"]) {
  replace(file, /Seal v\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?/g, `Seal v${version}`);
}

// These are release claims addressed to readers, but do not carry the "Seal"
// prefix. Keep their version identity in step with VERSION as well.
for (const file of [path.join("docs", "guide", "when-something-looks-wrong.md")]) {
  replace(file, /(?<!seal-)\bv\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?\b/g, (match) => match.endsWith(".md") ? match : `v${version}`);
}

// REVIEWED_GUIDE_GENERATED_VERSION_SLOT: the release version in this guide is
// generated from VERSION. Canonicalize only this anchored, exact-version slot
// before hashing; every other byte remains covered by the reviewed-guide pin.
const generatedVersionSlotSource = String.raw`(?<=^Printed by the installer, the installed launcher, and the demo alike for Seal\n)v${version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=\. Seal publishes Linux x86-64 and macOS ARM64 artifacts for this version\.$)`;
const generatedVersionSlot = new RegExp(generatedVersionSlotSource, "gm");
const guidePath = path.join(ROOT, "docs", "guide", "when-something-looks-wrong.md");
const guideText = fs.readFileSync(guidePath, "utf8");
if ([...guideText.matchAll(generatedVersionSlot)].length !== 1) throw new Error("reviewed guide must contain exactly one generated version slot");
const reviewedGuideSha256 = crypto.createHash("sha256").update(guideText.replace(generatedVersionSlot, "v<generated-version>")).digest("hex");

const canonicalizer = `
const VERSIONED_GUIDE = "docs/guide/when-something-looks-wrong.md";
const EXPECTED_RELEASE_VERSION = \`v\${readFileSync(resolve(ROOT, "VERSION"), "utf8").trim()}\`;
const GENERATED_VERSION_SLOT = new RegExp(${JSON.stringify(generatedVersionSlotSource)}, "gm");

function canonicalReviewedGuide(file, text) {
  if (file !== VERSIONED_GUIDE) return text;
  const matches = [...text.matchAll(GENERATED_VERSION_SLOT)];
  assert.equal(matches.length, 1, \`${"${file}"}: expected exactly one generated release-version slot containing \${EXPECTED_RELEASE_VERSION}\`);
  return text.replace(GENERATED_VERSION_SLOT, "v<generated-version>");
}
`;

function installReviewedGuideCanonicalizer() {
  const file = "test/guide-tokens.test.mjs";
  const target = path.join(ROOT, file);
  const before = fs.readFileSync(target, "utf8");
  let after = before.replace(
    /const GUIDE_SHA256 = "[0-9a-f]+";\n/,
    `const GUIDE_SHA256 = "${reviewedGuideSha256}";\n`,
  );
  const needsMigration = !after.includes("const GENERATED_VERSION_SLOT =");
  if (needsMigration) {
    after = after
      .replace(/const GUIDE_SHA256 = "[0-9a-f]+";\n/, `$&${canonicalizer}`)
      .replace('createHash("sha256").update(text).digest("hex")', 'createHash("sha256").update(canonicalReviewedGuide(GUIDE, text)).digest("hex")')
      .replace("sha256(text),\n    entry.sha256,", "sha256(canonicalReviewedGuide(entry.file, text)),\n    entry.sha256,");
  }
  const canonicalizerStart = after.indexOf('const VERSIONED_GUIDE = "docs/guide/when-something-looks-wrong.md";');
  if (canonicalizerStart !== -1) {
    const canonicalizerEnd = after.indexOf("// Where refusal tokens live", canonicalizerStart);
    if (canonicalizerEnd === -1) throw new Error(`reviewed guide canonicalizer end marker not found in ${file}`);
    after = `${after.slice(0, canonicalizerStart)}${canonicalizer.trimStart()}\n${after.slice(canonicalizerEnd)}`;
  }
  if (needsMigration && after === before) throw new Error(`reviewed guide canonicalizer migration marker not found in ${file}`);
  if (after !== before) fs.writeFileSync(target, after);
}

installReviewedGuideCanonicalizer();

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
