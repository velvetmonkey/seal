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
for (const file of ["docs/assurance/distribution.md", "docs/assurance/index.html", "spine/platform.cjs", "scripts/install.cjs", "scripts/seal-launch.cjs"]) {
  replace(file, /Seal v\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?/g, `Seal v${version}`);
}

// These are release claims addressed to readers, but do not carry the "Seal"
// prefix. Keep their version identity in step with VERSION as well.
for (const file of [path.join("docs", "guide", "when-something-looks-wrong.md")]) {
  replace(file, /(?<!seal-)\bv\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?\b/g, (match) => match.endsWith(".md") ? match : `v${version}`);
}

// REVIEWED_GUIDE_CANONICALIZED_SLOTS: sync-version.cjs generates the one
// anchored release-version slot. This canonicalizer maps only that slot to a
// stable marker before hashing. GUIDE_SHA256 does not cover the generated
// version slot. The pin covers every other byte in the guide.
// End the slot match at the version's own period. This keeps the generated
// slot stable when the following platform-support prose changes.
const generatedVersionSlotSource = String.raw`(?<=^Printed by the installer, the installed launcher, and the demo alike for Seal\n)v${version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=\.)`;
const generatedVersionSlot = new RegExp(generatedVersionSlotSource, "gm");
const guidePath = path.join(ROOT, "docs", "guide", "when-something-looks-wrong.md");
const guideText = fs.readFileSync(guidePath, "utf8");
if ([...guideText.matchAll(generatedVersionSlot)].length !== 1) throw new Error("reviewed guide must contain exactly one generated version slot");
function canonicalReviewedGuideText(text) {
  return text.replace(generatedVersionSlot, "v<generated-version>");
}
const reviewedGuideSha256 = crypto.createHash("sha256").update(canonicalReviewedGuideText(guideText)).digest("hex");

const canonicalizer = `
// REVIEWED_GUIDE_CANONICALIZED_SLOTS: sync-version.cjs generates the one
// anchored release-version slot. This canonicalizer maps only that slot to a
// stable marker before hashing. GUIDE_SHA256 does not cover the generated
// version slot. The pin covers every other byte in the guide.
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
  const pinnedDigest = before.match(/^const GUIDE_SHA256 = "([0-9a-f]{64})";$/m);
  if (!pinnedDigest) throw new Error(`reviewed guide digest pin not found in ${file}`);
  if (reviewedGuideSha256 !== pinnedDigest[1]) {
    throw new Error(`${file}: reviewed guide digest changed; a human must review the guide and update GUIDE_SHA256`);
  }
  const canonicalizerBodyStart = before.indexOf('const VERSIONED_GUIDE = "docs/guide/when-something-looks-wrong.md";');
  if (canonicalizerBodyStart === -1) throw new Error(`reviewed guide canonicalizer marker not found in ${file}`);
  const canonicalizerCommentStart = before.lastIndexOf("// REVIEWED_GUIDE_CANONICALIZED_SLOTS:", canonicalizerBodyStart);
  const canonicalizerStart = canonicalizerCommentStart === -1 ? canonicalizerBodyStart : canonicalizerCommentStart;
  const canonicalizerEnd = before.indexOf("// Where refusal tokens live", canonicalizerStart);
  if (canonicalizerEnd === -1) throw new Error(`reviewed guide canonicalizer end marker not found in ${file}`);
  const after = `${before.slice(0, canonicalizerStart)}${canonicalizer.trimStart()}\n${before.slice(canonicalizerEnd)}`;
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
