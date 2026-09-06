// SPDX-License-Identifier: Apache-2.0
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");
const { testTmpdir } = require("../scripts/temp-root.cjs");

const { productIdentity, artifactName } = require("../scripts/product-identity.cjs");

const ROOT = path.join(__dirname, "..");
const VERSION = fs.readFileSync(path.join(ROOT, "VERSION"), "utf8").trim();
// Two names, because they answer two questions. The built name identifies the
// tree this build came from; the released name identifies the published bytes.
const builtName = artifactName(productIdentity({ root: ROOT }).identity);
// Check every root Markdown file and every live Markdown document under docs/;
// exclude docs/archive because it preserves historical references on purpose.
const READER_FACING_VERSION_SEARCH_ROOTS = [
  "root Markdown files (case-insensitive)",
  "docs/** Markdown files (case-insensitive)",
  "!docs/archive/**", // Historical archive; stale release-note mentions are intentional here.
];
// The Markdown extension set is .md, .livemd, .markdown, .mdown, .mdwn, .mkd, .mkdn, .mkdown, .ronn, .scd, and .workbook.
const MARKDOWN_EXTENSIONS = new Set([
  ".md",
  ".livemd",
  ".markdown",
  ".mdown",
  ".mdwn",
  ".mkd",
  ".mkdn",
  ".mkdown",
  ".ronn",
  ".scd",
  ".workbook",
]);
const FILENAME_EXTENSION = "[A-Za-z][A-Za-z0-9_-]*";

function run(file, args, options = {}) {
  const result = spawnSync(file, args, { encoding: "utf8", ...options });
  return { code: result.status, stdout: result.stdout || "", stderr: result.stderr || "" };
}

function scratchRoot() {
  const temporary = os.tmpdir();
  const relative = path.relative(ROOT, path.resolve(temporary));
  if (relative && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)) {
    const outsideRoot = path.join(path.dirname(ROOT), ".seal-test-scratch");
    fs.mkdirSync(outsideRoot, { recursive: true });
    return outsideRoot;
  }
  return temporary;
}

function isMarkdownFilename(filename) {
  return MARKDOWN_EXTENSIONS.has(path.extname(filename).toLowerCase());
}

function addMarkdownFiles(files, directory, excludedDirectory) {
  if (!fs.existsSync(directory)) return;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory() && target !== excludedDirectory) addMarkdownFiles(files, target, excludedDirectory);
    else if (entry.isFile() && isMarkdownFilename(entry.name)) files.push(target);
  }
}

function readerFacingMarkdownFiles(root) {
  const files = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (entry.isFile() && isMarkdownFilename(entry.name)) files.push(path.join(root, entry.name));
  }
  const docsRoot = path.join(root, "docs");
  if (!fs.existsSync(docsRoot)) return files;
  addMarkdownFiles(files, docsRoot, path.join(docsRoot, "archive")); // Historical archive; stale release-note mentions are intentional here.
  return files;
}

function staleVersionMatches(root, version) {
  const oldLiteral = staleVersionLiteral(version);
  return readerFacingMarkdownFiles(root)
    .filter((file) => {
      if (/^RELEASE-NOTES-v\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?\.md$/.test(path.basename(file))) {
        return false; // Immutable release records retain the version they describe.
      }
      const humanMaintained = fs.readFileSync(file, "utf8").replace(
        /<!-- generated from published release; do not edit -->[\s\S]*?<!-- end generated release docs -->/g,
        "",
      ).replace(/\bRELEASE-NOTES-v\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?\.md\b/g, "");
      return oldLiteral.test(humanMaintained);
    })
    .map((file) => path.relative(root, file).replaceAll(path.sep, "/"))
    .sort();
}

function makeScopedScratch() {
  const scratch = testTmpdir(path.join(os.tmpdir(), "seal-version-scope-"));
  fs.mkdirSync(path.join(scratch, "docs", "archive"), { recursive: true });
  fs.mkdirSync(path.join(scratch, "docs", "guide"), { recursive: true });
  fs.mkdirSync(path.join(scratch, "docs", "start"), { recursive: true });
  fs.mkdirSync(path.join(scratch, "docs", "assurance"), { recursive: true });
  fs.writeFileSync(path.join(scratch, "README.md"), "# Scratch\n");
  return scratch;
}

function writeScopedDoc(root, relative, text) {
  const target = path.join(root, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, text);
}

function assertStaleMatches(version, files, expected, message) {
  const root = makeScopedScratch();
  for (const [relative, text] of Object.entries(files)) writeScopedDoc(root, relative, text);
  assert.deepEqual(staleVersionMatches(root, version), expected, message);
}

// Compare one exact version identity. A prerelease or build suffix belongs to
// the SemVer identity, so a final version must not match its prefix. A
// filename extension is not part of the identity; requiring it to start with
// a letter keeps `v0.2.0.1` unmatched.
function staleVersionLiteral(version) {
  return new RegExp(`(?<![0-9.])${version.replaceAll(".", "\\.")}(?=(?:\\.${FILENAME_EXTENSION})\\b|$|[^0-9A-Za-z.+-])`);
}

test("every emitted release identity derives from VERSION", () => {
  assert.match(VERSION, /^\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")).version, VERSION);
  const binary = run(process.execPath, [path.join(ROOT, "bin", "seal"), "--version"]);
  assert.equal(binary.code, 0, binary.stderr);
  assert.equal(binary.stdout.trim(), VERSION);
  for (const file of ["docs/guide/when-something-looks-wrong.md"]) {
    assert.match(fs.readFileSync(path.join(ROOT, file), "utf8"), new RegExp(`\\bv${VERSION}\\b`), `${file} must carry bare v${VERSION}`);
  }

  const out = testTmpdir(path.join(os.tmpdir(), "seal-version-identity-"));
  const build = run(process.execPath, [path.join(ROOT, "scripts", "build-dist.cjs"), "--out", out]);
  assert.equal(build.code, 0, build.stderr);
  const artifact = path.join(out, builtName);
  assert.ok(fs.existsSync(artifact), build.stdout);
  const [digest, bytes, named] = fs.readFileSync(path.join(out, "SHA256SUMS"), "utf8").trim().split(/\s+/);
  assert.equal(named, builtName);
  assert.equal(digest, crypto.createHash("sha256").update(fs.readFileSync(artifact)).digest("hex"));
  assert.equal(Number(bytes), fs.statSync(artifact).size);

  const prefix = path.join(out, "prefix");
  const install = run(artifact, ["--sha256", digest, "--bytes", bytes, "--prefix", prefix]);
  assert.equal(install.code, 0, install.stderr);
  assert.match(install.stdout, new RegExp(`installed seal ${VERSION} linux-x64`));
  const record = JSON.parse(fs.readFileSync(path.join(prefix, "lib", "seal", "install.json"), "utf8"));
  assert.equal(record.version, VERSION);
  const installed = run(process.execPath, [path.join(prefix, "bin", "seal"), "--version"]);
  assert.equal(installed.code, 0, installed.stderr);
  assert.equal(installed.stdout.trim(), VERSION);

  // Downloaded releases carry their authoritative SHA256SUMS asset. The
  // repository root is intentionally empty between releases.
  for (const file of ["README.md", "docs/assurance/distribution.md", "docs/guide/README.md", "docs/assurance/version-identity.md"]) {
    const text = fs.readFileSync(path.join(ROOT, file), "utf8");
    assert.match(text, /release asset|release's `SHA256SUMS` asset|co-published `SHA256SUMS`|`SHA256SUMS`\s+asset\s+attached to the same release/i);
  }
  const publishedVersion = fs.readFileSync(path.join(ROOT, "README.md"), "utf8")
    .match(/^SEAL_VERSION=v(.+)$/m)?.[1];
  assert.ok(publishedVersion, "README must name the published release version");
  assert.doesNotThrow(() => fs.statSync(path.join(ROOT, ".git")));
  assert.equal(run("git", ["cat-file", "-e", `v${publishedVersion}^{commit}`], { cwd: ROOT }).code, 0, `published v${publishedVersion} tag must resolve`);
  for (const file of ["docs/start/install.md", "docs/guide/README.md"]) {
    const text = fs.readFileSync(path.join(ROOT, file), "utf8");
    assert.match(text, new RegExp(`installed seal ${publishedVersion.replaceAll(".", "\\.")} linux-x64`));
  }
  for (const file of ["docs/assurance/distribution.md", "spine/platform.cjs", "scripts/install.cjs", "scripts/seal-launch.cjs"]) {
    assert.match(fs.readFileSync(path.join(ROOT, file), "utf8"), new RegExp(`Seal v${VERSION}`));
  }
  const releaseWorkflow = fs.readFileSync(path.join(ROOT, ".github", "workflows", "release.yml"), "utf8");
  assert.match(releaseWorkflow, /Seal v\$\{version\}/);
  assert.doesNotMatch(releaseWorkflow, /seal-vVERSION/);
  assert.equal(fs.readFileSync(path.join(ROOT, "SHA256SUMS"), "utf8").trim(), "");
});

test("sync leaves no old product version in human-maintained reader-facing prose", () => {
  const oldVersion = VERSION;
  const scratch = testTmpdir(path.join(scratchRoot(), "seal-version-stale-"));
  fs.cpSync(ROOT, scratch, {
    recursive: true,
    filter(source) {
      const relative = path.relative(ROOT, source);
      const temporary = path.relative(ROOT, path.resolve(os.tmpdir()));
      return ![".family", ".git", "dist", "kernel", temporary].includes(relative)
        && !relative.startsWith(`${temporary}${path.sep}`)
        && !/^spine\/.*\.wasm(?:\..*)?$/.test(relative);
    },
  });
  const publishedDocs = [
    "README.md",
    "docs/start/install.md",
    "docs/start/evaluator-walk.md",
    "docs/guide/README.md",
    "docs/assurance/README.md",
    "docs/assurance/architecture.md",
    "docs/archive/AUTHORIZATION-MESH.md",
    "docs/archive/CLAIMS-MATRIX.md",
    "docs/archive/LIMITATIONS.md",
    "docs/archive/TRUTH-BOX.md",
    "docs/archive/WHAT-SEAL-IS.md",
    "docs/archive/WHY-DIFFERENT.md",
  ];
  const bumpedVersion = VERSION === "9.9.9" ? "9.9.10" : "9.9.9";
  fs.writeFileSync(
    path.join(scratch, "docs", "assurance", `RELEASE-NOTES-v${bumpedVersion}.md`),
    `# Seal v${bumpedVersion} release notes\n`,
  );
  const publishedBeforeCut = new Map(publishedDocs.map((file) => [file, fs.readFileSync(path.join(scratch, file), "utf8")]));
  const notesDirectory = path.join(scratch, "docs", "assurance");
  const historicalNotes = fs.readdirSync(notesDirectory).filter((file) => /^RELEASE-NOTES-.*\.md$/.test(file)).sort();
  const historicalBytes = new Map(historicalNotes.map((file) => [file, fs.readFileSync(path.join(notesDirectory, file))]));
  const checkerReleaseRoute = /\/releases\/download\/v[^/]+\/seal-receipt-(?:check|v2)\.mjs/;
  const publishedRouteBeforeCut = new Map([
    ["docs/assurance/distribution.md", fs.readFileSync(path.join(scratch, "docs/assurance/distribution.md"), "utf8").match(checkerReleaseRoute)?.[0]],
    ["docs/assurance/index.html", fs.readFileSync(path.join(scratch, "docs/assurance/index.html"), "utf8").match(/RELEASE-NOTES-v[^\"]+\.md/)?.[0]],
  ]);
  assert.ok(publishedRouteBeforeCut.get("docs/assurance/distribution.md"), "published checker route must be present before a candidate cut");
  fs.writeFileSync(path.join(scratch, "VERSION"), `${bumpedVersion}\n`);
  const sync = run(process.execPath, [path.join(scratch, "scripts", "sync-version.cjs")]);
  assert.equal(sync.code, 0, sync.stderr);
  for (const file of publishedDocs) {
    assert.equal(fs.readFileSync(path.join(scratch, file), "utf8"), publishedBeforeCut.get(file), `${file} must continue to describe the latest published release during a cut`);
  }
  assert.deepEqual(
    fs.readdirSync(notesDirectory).filter((file) => /^RELEASE-NOTES-.*\.md$/.test(file)).sort(),
    historicalNotes,
    "sync must not add, remove, or rename historical release notes",
  );
  for (const [file, bytes] of historicalBytes) {
    assert.deepEqual(fs.readFileSync(path.join(notesDirectory, file)), bytes, `${file} must remain byte-identical across a candidate version bump`);
  }
  assert.equal(
    fs.readFileSync(path.join(scratch, "docs/assurance/distribution.md"), "utf8").match(checkerReleaseRoute)?.[0],
    publishedRouteBeforeCut.get("docs/assurance/distribution.md"),
    "candidate sync must not rewrite the published checker route",
  );
  assert.equal(
    fs.readFileSync(path.join(scratch, "docs/assurance/index.html"), "utf8").match(/RELEASE-NOTES-v[^\"]+\.md/)?.[0],
    publishedRouteBeforeCut.get("docs/assurance/index.html"),
    "candidate sync must not rewrite release-note navigation",
  );
  assert.match(
    fs.readFileSync(path.join(scratch, "docs/assurance/distribution.md"), "utf8"),
    new RegExp(`Seal v${bumpedVersion.replaceAll(".", "\\.")}`),
    "candidate sync must still update the source-version heading around the preserved published route",
  );
  assert.deepEqual(
    staleVersionMatches(scratch, oldVersion).filter((file) => ![...publishedDocs, "docs/assurance/distribution.md"].includes(file)),
    [],
    `reader-facing search surface retains old ${oldVersion}; search surface: ${READER_FACING_VERSION_SEARCH_ROOTS.join(", ")}`,
  );
});

test("sync refuses when the current VERSION release note is absent", () => {
  const scratch = testTmpdir(path.join(scratchRoot(), "seal-version-notes-"));
  fs.cpSync(ROOT, scratch, {
    recursive: true,
    filter(source) {
      const relative = path.relative(ROOT, source);
      const temporary = path.relative(ROOT, path.resolve(os.tmpdir()));
      return ![".family", ".git", "dist", "kernel", temporary].includes(relative)
        && !relative.startsWith(`${temporary}${path.sep}`)
        && !/^spine\/.*\.wasm(?:\..*)?$/.test(relative);
    },
  });
  const currentNotes = path.join(scratch, "docs", "assurance", `RELEASE-NOTES-v${VERSION}.md`);
  fs.rmSync(currentNotes);
  const sync = run(process.execPath, [path.join(scratch, "scripts", "sync-version.cjs")]);
  assert.notEqual(sync.code, 0, "sync must go red when the current release note is absent");
  assert.match(sync.stderr, new RegExp(`current release notes are absent: docs/assurance/RELEASE-NOTES-v${VERSION.replaceAll(".", "\\.")}\\.md`));
});

test("stale-version scope preserves a historical release-note filename in a live document", () => {
  assertStaleMatches(
    "0.2.0",
    {
      "docs/guide/live.md": "See docs/assurance/RELEASE-NOTES-v0.2.0-rc.2.md for the old release.\n",
    },
    [],
    "release-note paths identify immutable history rather than candidate version state",
  );
});

test("stale-version scope preserves an immutable release-note body", () => {
  assertStaleMatches(
    "0.2.0",
    {
      "docs/assurance/RELEASE-NOTES-v0.2.0.md": "# Seal v0.2.0 release notes\n\nSeal v0.2.0 remains this record's identity.\n",
    },
    [],
    "an immutable release record must retain the version it describes",
  );
});

test("stale-version matcher does not equate a final version with a prerelease identity", () => {
  assert.equal(
    staleVersionLiteral("0.2.0").test("RELEASE-NOTES-v0.2.0-rc.2.md"),
    false,
    "0.2.0 and 0.2.0-rc.2 are distinct SemVer identities",
  );
});

test("stale-version scope ignores the same historical release-note filename in an archived document", () => {
  assertStaleMatches(
    "0.2.0",
    {
      "docs/archive/history.md": "Archive note: docs/assurance/RELEASE-NOTES-v0.2.0-rc.2.md stayed here on purpose.\n",
    },
    [],
    "archived docs must stay out of the stale-version search surface",
  );
});

test("stale-version scope catches a stale .txt filename in a live document", () => {
  assertStaleMatches(
    "0.2.0",
    {
      "docs/start/live.txt-check.md": "This live page still points at PRODUCT-v0.2.0.txt and must be updated.\n",
    },
    ["docs/start/live.txt-check.md"],
    "live docs must still catch stale unknown-extension filenames",
  );
});

test("stale-version matcher does not flag a four-part version in a live document", () => {
  assertStaleMatches(
    "0.2.0",
    {
      "docs/guide/non-stale.md": "Version history: v0.2.0.1 was a different line.\n",
    },
    [],
    "four-part versions must stay unflagged",
  );
});

test("stale-version scope checks a new active document in docs/reference by default", () => {
  assertStaleMatches(
    "0.2.0",
    {
      "docs/reference/new-active-doc.md": "New reference page still describes product v0.2.0 and must be updated.\n",
    },
    ["docs/reference/new-active-doc.md"],
    "new live docs in docs/reference must be checked without updating any scope list",
  );
});

test("stale-version matcher does not flag sentence-ending prose in a live document", () => {
  assertStaleMatches(
    "0.2.0",
    {
      "docs/guide/non-stale.md": "We shipped 0.2.0.\n",
    },
    [],
    "sentence-ending prose must stay unflagged",
  );
});

test("stale-version matcher does not accept alphabetic suffix prefixes as version identity", () => {
  const distinctIdentities = [
    "v0.2.0rc",
    "v0.2.0beta",
    "pre0.2.0post",
    "x0.2.0y",
    "0.2.0foo",
    "v0.2.0a1",
    "0.2.0RC2",
    "version0.2.0next",
  ];
  assert.deepEqual(
    distinctIdentities.filter((text) => staleVersionLiteral("0.2.0").test(text)),
    [],
    "an alphabetic suffix is not the exact final-version identity",
  );
});

test("stale-version scope checks every root Markdown file", () => {
  assertStaleMatches(
    "0.2.0",
    {
      "CONTRIBUTING.md": "This contribution guide still describes product v0.2.0 and must be updated.\n",
    },
    ["CONTRIBUTING.md"],
    "root Markdown files, not only README.md, must be checked",
  );
});

test("stale-version scope checks uppercase Markdown extensions", () => {
  assertStaleMatches(
    "0.2.0",
    {
      "docs/start/NOTES.MD": "This live page still describes product v0.2.0 and must be updated.\n",
    },
    ["docs/start/NOTES.MD"],
    "uppercase Markdown extensions must be checked",
  );
});

test("stale-version scope checks the Markdown extension set", () => {
  const extensionFiles = [
    "docs/field-notes/stranger.md",
    "docs/field-notes/stranger.livemd",
    "docs/field-notes/stranger.markdown",
    "docs/field-notes/stranger.mdown",
    "docs/field-notes/stranger.mdwn",
    "docs/field-notes/stranger.mkd",
    "docs/field-notes/stranger.mkdn",
    "docs/field-notes/stranger.mkdown",
    "docs/field-notes/stranger.ronn",
    "docs/field-notes/stranger.scd",
    "docs/field-notes/stranger.workbook",
  ];
  const expected = extensionFiles.sort();
  const root = makeScopedScratch();
  for (const file of extensionFiles) writeScopedDoc(root, file, "This live document still says product version v0.2.0 and must be updated.\n");
  let actual;
  assert.deepEqual(
    actual = staleVersionMatches(root, "0.2.0"),
    expected,
    "every Markdown extension, including .markdown, must be checked for stale release-note references",
  );
  assert.equal(actual.length, expected.length, "the extension-set assertion must not become vacuous");
});

test("stale-version exclusions remain unflagged together", () => {
  assertStaleMatches(
    "0.2.0",
    {
      "docs/archive/history.md": "Archive note: RELEASE-NOTES-v0.2.0-rc.2.md stayed here on purpose.\n",
      "docs/guide/four-part.md": "Version history: v0.2.0.1 was a different line.\n",
      "docs/guide/prose.md": "We shipped 0.2.0.\n",
      "docs/guide/history-link.md": "See RELEASE-NOTES-v0.2.0-rc.2.md for the historical release.\n",
    },
    [],
    "archive references, historical note paths, four-part versions, and sentence-ending prose must stay unflagged",
  );
});

test("stale-version scope checks a new active docs/field-notes directory by default", () => {
  assertStaleMatches(
    "0.2.0",
    {
      "docs/field-notes/new-active-doc.md": "This field note still describes product v0.2.0 and must be updated.\n",
    },
    ["docs/field-notes/new-active-doc.md"],
    "new live docs directories must be checked without updating any scope list",
  );
});

test("stale-version scope keeps archive-substring directories live and does not follow archive symlinks", () => {
  const root = makeScopedScratch();
  writeScopedDoc(root, "docs/my-archive/live.md", "This live page still describes product v0.2.0 and must be updated.\n");
  writeScopedDoc(root, "docs/archive/history.md", "Historical link: RELEASE-NOTES-v0.2.0-rc.2.md.\n");
  fs.symlinkSync(path.join(root, "docs", "archive"), path.join(root, "docs", "assurance", "from-archive"));
  assert.deepEqual(
    staleVersionMatches(root, "0.2.0"),
    ["docs/my-archive/live.md"],
    "only docs/archive is excluded; archive-substring directories stay live and archive symlinks do not alter scope",
  );
});
