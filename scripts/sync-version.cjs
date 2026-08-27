#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// VERSION is the one declared release identity. This script materializes it in
// package metadata and reader-facing release copy before a release build.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

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

const notesCandidates = fs.readdirSync(path.join(ROOT, "docs", "assurance"))
  .filter((file) => /^RELEASE-NOTES-v\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?\.md$/.test(file))
  .sort();
if (notesCandidates.length === 0) throw new Error("expected at least one versioned release-notes file");
let currentNotes = notesCandidates.includes(releaseNotes) ? releaseNotes : notesCandidates.at(-1);
const priorNotesVersion = currentNotes.match(/^RELEASE-NOTES-v(.+)\.md$/)[1];
const priorReleaseNotesPattern = new RegExp(`RELEASE-NOTES-v${priorNotesVersion.replaceAll(".", "\\.")}\\.md`, "g");
if (currentNotes !== releaseNotes) {
  fs.renameSync(path.join(ROOT, "docs", "assurance", currentNotes), path.join(ROOT, "docs", "assurance", releaseNotes));
  currentNotes = releaseNotes;
}
for (const file of fs.readdirSync(path.join(ROOT, "docs", "assurance")).filter((file) => file.endsWith(".md"))) {
  replaceIfPresent(path.join("docs", "assurance", file), priorReleaseNotesPattern, releaseNotes);
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
  replaceIfPresent(file, priorReleaseNotesPattern, releaseNotes);
}
replaceIfPresent("docs/assurance/index.html", priorReleaseNotesPattern, releaseNotes);
replaceIfPresent("docs/assurance/README.md", /what v\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)? contains/g, `what v${version} contains`);
replaceIfPresent("docs/assurance/README.md", /how v\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)? got its shape/g, `how v${version} got its shape`);

// The README is the published-release front door.  Its shell version slot and
// reader-facing prose must follow VERSION rather than retaining a prior tag.
replace("README.md", /^SEAL_VERSION=v\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/gm, `SEAL_VERSION=v${version}`);
replaceIfPresent("README.md", /Seal v\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?/g, `Seal v${version}`);
replaceIfPresent("README.md", /published v\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)? CLI/g, `published v${version} CLI`);
replaceIfPresent("docs/start/install.md", /^# Install Seal v\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/gm, `# Install Seal v${version}`);
replaceIfPresent("docs/start/install.md", /published v\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)? release asset/g, `published v${version} release asset`);
replaceIfPresent("docs/start/install.md", /^SEAL_VERSION=v\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/gm, `SEAL_VERSION=v${version}`);
replaceIfPresent("docs/start/install.md", /installed seal \d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)? linux-x64/g, `installed seal ${version} linux-x64`);
replaceIfPresent("docs/start/install.md", /published v\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)? asset/g, `published v${version} asset`);
replaceIfPresent("docs/start/evaluator-walk.md", /published GitHub release `v\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?`/g, `published GitHub release \`v${version}\``);

for (const file of ["docs/assurance/distribution.md", path.join("docs/assurance", releaseNotes), "docs/assurance/index.html", "spine/platform.cjs", "scripts/install.cjs", "scripts/seal-launch.cjs"]) {
  replace(file, /Seal v\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?/g, `Seal v${version}`);
}
replaceIfPresent(path.join("docs", "assurance", releaseNotes), new RegExp(`\\bv${priorNotesVersion.replaceAll(".", "\\.")}\\b`, "g"), `v${version}`);

// These are release claims addressed to readers, but do not carry the "Seal"
// prefix. Keep their version identity in step with VERSION as well.
for (const file of [path.join("docs", "guide", "when-something-looks-wrong.md")]) {
  replace(file, /(?<!seal-)\bv\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?\b/g, (match) => match.endsWith(".md") ? match : `v${version}`);
}

// REVIEWED_GUIDE_GENERATED_VERSION_SLOT: the release version in this guide is
// generated from VERSION. Canonicalize only this anchored, exact-version slot
// before hashing; every other byte remains covered by the reviewed-guide pin.
const generatedVersionSlotSource = String.raw`(?<=^Printed by the installer, the installed launcher, and the demo alike for Seal\n)v${version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=\. macOS source portability is CI-exercised for install, demo and receipt checking\.$)`;
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
  let after = before;
  const needsMigration = !after.includes("const GENERATED_VERSION_SLOT =");
  if (needsMigration) {
    after = after
      .replace(/const GUIDE_SHA256 = "[0-9a-f]+";\n/, `const GUIDE_SHA256 = "${reviewedGuideSha256}";\n${canonicalizer}`)
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
replace("README.md", ARTIFACT_NAME, renameArtifact);
replaceIfPresent("README.md", /installed seal \d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)? linux-x64/g, `installed seal ${version} linux-x64`);
// Download instructions derive the artifact name from the checksum asset from
// the same release, so these guides intentionally have no versioned filename.
replaceIfPresent("docs/assurance/distribution.md", ARTIFACT_NAME, renameArtifact);
replaceIfPresent("docs/guide/README.md", ARTIFACT_NAME, renameArtifact);
replaceIfPresent("docs/guide/README.md", /installed seal \d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)? linux-x64/g, `installed seal ${version} linux-x64`);

// Receipt checking is supplied as a sibling release asset, not by cloning a
// source checkout. Keep every live reader route to that asset on VERSION.
const RECEIPT_CHECKER_RELEASE_ASSET = /\/velvetmonkey\/seal\/releases\/download\/v\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?\/seal-receipt-check\.mjs/g;
for (const file of [
  "README.md",
  "docs/assurance/README.md",
  path.join("docs", "assurance", releaseNotes),
  "docs/assurance/distribution.md",
  "docs/start/install.md",
  "docs/guide/knowing-it-worked.md",
]) {
  replaceIfPresent(file, RECEIPT_CHECKER_RELEASE_ASSET, `/velvetmonkey/seal/releases/download/v${version}/seal-receipt-check.mjs`);
}
