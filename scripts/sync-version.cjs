#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// VERSION is the one declared release identity. This script materializes it in
// package metadata and reader-facing release copy before a release build.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const ROOT = path.join(__dirname, "..");
const requestedVersion = require.main === module ? process.argv[2] : undefined;
const version = requestedVersion || fs.readFileSync(path.join(ROOT, "VERSION"), "utf8").trim();
const releaseNotes = `RELEASE-NOTES-v${version}.md`;

if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.test(version)) throw new Error(`VERSION is not exact SemVer: ${version}`);
if (requestedVersion) fs.writeFileSync(path.join(ROOT, "VERSION"), `${version}\n`);

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
replace("scripts/claim-bearing-files.json", /"docs\/RELEASE-NOTES-v\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?\.md":/g, `"docs/${releaseNotes}":`);
for (const file of fs.readdirSync(path.join(ROOT, "docs")).filter((file) => file.endsWith(".md"))) {
  replaceIfPresent(path.join("docs", file), /RELEASE-NOTES-v\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?\.md/g, releaseNotes);
}
replaceIfPresent("index.html", /RELEASE-NOTES-v\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?\.md/g, releaseNotes);
replaceIfPresent("docs/README.md", /what v\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)? contains/g, `what v${version} contains`);
replaceIfPresent("docs/README.md", /how v\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)? got its shape/g, `how v${version} got its shape`);

for (const file of ["README.md", "docs/DISTRIBUTION.md", path.join("docs", releaseNotes), "index.html", "spine/platform.cjs", "scripts/install.cjs", "scripts/seal-launch.cjs"]) {
  replace(file, /Seal v\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?/g, `Seal v${version}`);
}

// These are release claims addressed to readers, but do not carry the "Seal"
// prefix. Keep their version identity in step with VERSION as well.
for (const file of ["README.md", path.join("docs", "guide", "when-something-looks-wrong.md")]) {
  replace(file, /(?<!seal-)\bv\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?\b/g, `v${version}`);
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
replaceIfPresent("docs/DISTRIBUTION.md", ARTIFACT_NAME, renameArtifact);
replaceIfPresent("docs/guide/README.md", ARTIFACT_NAME, renameArtifact);

for (const file of ["README.md", "docs/guide/README.md"]) {
  replaceIfPresent(file, /installed seal \d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)? linux-x64/g, `installed seal ${version} linux-x64`);
}

// Migrate the two reviewed-guide checks from a contradictory whole-file pin
// to a pin over reviewed bytes with exactly one generated release-version slot
// canonicalized. This migration is deliberately one-shot: later syncs must not
// silently re-pin any other guide edit.
const generatedVersionSlotSource = String.raw`(?<=^Printed by the installer, the installed launcher, and the demo alike: Seal\n)v${version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?= supports Linux x86-64 only, refuses everything else, and changes no\nfiles when it refuses\.$)`;
const generatedVersionSlot = new RegExp(generatedVersionSlotSource, "gm");
const guidePath = path.join(ROOT, "docs", "guide", "when-something-looks-wrong.md");
const guideText = fs.readFileSync(guidePath, "utf8");
if ([...guideText.matchAll(generatedVersionSlot)].length !== 1) throw new Error("reviewed guide must contain exactly one generated version slot");
const reviewedGuideSha256 = crypto.createHash("sha256").update(guideText.replace(generatedVersionSlot, "v<generated-version>")).digest("hex");

function installGuideFreezeTest(file, transform) {
  const target = path.join(ROOT, file);
  const before = fs.readFileSync(target, "utf8");
  let after = before;
  const needsMigration = !after.includes("const GENERATED_VERSION_SLOT =");
  if (needsMigration) after = transform(after);
  after = after.replace(
    /const VERSIONED_GUIDE = "docs\/guide\/when-something-looks-wrong\.md";\n(?:const EXPECTED_RELEASE_VERSION = .*?;\n)?const GENERATED_VERSION_SLOT = new RegExp\([\s\S]*?\n}\n/,
    canonicalizer.trimStart(),
  );
  if (needsMigration && after === before) throw new Error(`guide freeze migration marker not found in ${file}`);
  if (after !== before) fs.writeFileSync(target, after);
}

const canonicalizer = `\nconst VERSIONED_GUIDE = "docs/guide/when-something-looks-wrong.md";\nconst EXPECTED_RELEASE_VERSION = \`v\${readFileSync(resolve(ROOT, "VERSION"), "utf8").trim()}\`;\nconst GENERATED_VERSION_SLOT = new RegExp(${JSON.stringify(generatedVersionSlotSource)}, "gm");\n\nfunction canonicalReviewedGuide(file, text) {\n  if (file !== VERSIONED_GUIDE) return text;\n  const matches = [...text.matchAll(GENERATED_VERSION_SLOT)];\n  assert.equal(matches.length, 1, \`${"${file}"}: expected exactly one generated release-version slot containing \${EXPECTED_RELEASE_VERSION}\`);\n  return text.replace(GENERATED_VERSION_SLOT, "v<generated-version>");\n}\n`;

installGuideFreezeTest("test/guide-claims.test.mjs", (text) => text
  .replace('const ROOT = resolve(import.meta.dirname, "..");\n', `const ROOT = resolve(import.meta.dirname, "..");\n${canonicalizer}`)
  .replace('sha256: "1f0ec25264a06146d4b653c401572f3531ae8d9321935f53015d62c392d3dedd"', `sha256: "${reviewedGuideSha256}"`)
  .replace("    sha256(text),\n", "    sha256(canonicalReviewedGuide(entry.file, text)),\n")
  .replace("// This is deliberately a whole-file pin, not a marker-located section parser:\n", "// This pins the whole reviewed guide after canonicalizing one exact generated\n// release-version slot, not a marker-located section:\n")
  .replace('test("whole-file pin rejects locator defeats and earlier claim tampering",', 'test("reviewed-prose pin rejects locator defeats and earlier claim tampering",')
);

installGuideFreezeTest("test/guide-tokens.test.mjs", (text) => text
  .replace('const GUIDE_SHA256 = "1f0ec25264a06146d4b653c401572f3531ae8d9321935f53015d62c392d3dedd";\n', `const GUIDE_SHA256 = "${reviewedGuideSha256}";\n${canonicalizer}`)
  .replace('  const digest = createHash("sha256").update(text).digest("hex");\n', '  const digest = createHash("sha256").update(canonicalReviewedGuide(GUIDE, text)).digest("hex");\n')
);

const guideClaimsLines = fs.readFileSync(path.join(ROOT, "test", "guide-claims.test.mjs"), "utf8").split("\n");
for (const guide of ["docs/guide/when-something-looks-wrong.md", "docs/guide/what-is-protected-right-now.md"]) {
  const line = guideClaimsLines.findIndex((text) => text.includes(`// CLAIM-COVERAGE: ${guide}`)) + 1;
  if (line === 0) throw new Error(`claim coverage marker not found for ${guide}`);
  replace(
    "scripts/claim-bearing-files.json",
    new RegExp(`("${guide.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}": \\{ "coveredBy": \\["test/guide-claims\\.test\\.mjs:)\\d+("\\] \\})`),
    `$1${line}$2`,
  );
}
