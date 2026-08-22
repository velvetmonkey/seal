// SPDX-License-Identifier: Apache-2.0
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const { productIdentity, artifactName } = require("../scripts/product-identity.cjs");

const ROOT = path.join(__dirname, "..");
const VERSION = fs.readFileSync(path.join(ROOT, "VERSION"), "utf8").trim();
// Two names, because they answer two questions. The built name identifies the
// tree this build came from; the released name identifies the published bytes.
const builtName = artifactName(productIdentity({ root: ROOT }).identity);
// Check the repository README and the live Markdown trees in docs/assurance,
// docs/guide, and docs/start; docs/archive is historical and out of scope.
const READER_FACING_VERSION_SEARCH_ROOTS = [
  "README.md",
  "docs/assurance/**/*.md",
  "docs/guide/**/*.md",
  "docs/start/**/*.md",
];
const FILENAME_EXTENSION = "[A-Za-z][A-Za-z0-9_-]*";

function run(file, args, options = {}) {
  const result = spawnSync(file, args, { encoding: "utf8", ...options });
  return { code: result.status, stdout: result.stdout || "", stderr: result.stderr || "" };
}

function addMarkdownFiles(files, directory) {
  if (!fs.existsSync(directory)) return;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) addMarkdownFiles(files, target);
    else if (entry.isFile() && entry.name.endsWith(".md")) files.push(target);
  }
}

function readerFacingMarkdownFiles(root) {
  const files = [path.join(root, "README.md")];
  for (const directory of ["docs/assurance", "docs/guide", "docs/start"]) {
    addMarkdownFiles(files, path.join(root, directory));
  }
  return files;
}

function staleVersionMatches(root, version) {
  const oldLiteral = staleVersionLiteral(version);
  return readerFacingMarkdownFiles(root)
    .filter((file) => oldLiteral.test(fs.readFileSync(file, "utf8")))
    .map((file) => path.relative(root, file).replaceAll(path.sep, "/"))
    .sort();
}

function makeScopedScratch() {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "seal-version-scope-"));
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

// Match an old version only when it ends cleanly, starts a prerelease/build
// suffix, or is immediately followed by a filename extension. Requiring the
// extension to start with a letter keeps `v0.2.0.1` unmatched.
function staleVersionLiteral(version) {
  return new RegExp(`(?<![0-9.])${version.replaceAll(".", "\\.")}(?=(?:\\.${FILENAME_EXTENSION})\\b|$|[^0-9A-Za-z.])`);
}

test("every emitted release identity derives from VERSION", () => {
  assert.match(VERSION, /^\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")).version, VERSION);
  const binary = run(process.execPath, [path.join(ROOT, "bin", "seal"), "--version"]);
  assert.equal(binary.code, 0, binary.stderr);
  assert.equal(binary.stdout.trim(), VERSION);
  for (const file of ["README.md", "docs/guide/when-something-looks-wrong.md"]) {
    assert.match(fs.readFileSync(path.join(ROOT, file), "utf8"), new RegExp(`\\bv${VERSION}\\b`), `${file} must carry bare v${VERSION}`);
  }

  const out = fs.mkdtempSync(path.join(os.tmpdir(), "seal-version-identity-"));
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
  for (const file of ["README.md", "docs/guide/README.md"]) {
    const text = fs.readFileSync(path.join(ROOT, file), "utf8");
    assert.match(text, new RegExp(`installed seal ${VERSION} linux-x64`));
  }
  for (const file of ["README.md", "docs/assurance/distribution.md", "docs/assurance/RELEASE-NOTES-v0.2.0-rc.2.md", "spine/platform.cjs", "scripts/install.cjs", "scripts/seal-launch.cjs"]) {
    assert.match(fs.readFileSync(path.join(ROOT, file), "utf8"), new RegExp(`Seal v${VERSION}`));
  }
  const releaseWorkflow = fs.readFileSync(path.join(ROOT, ".github", "workflows", "release.yml"), "utf8");
  assert.match(releaseWorkflow, /Seal v\$\{version\}/);
  assert.doesNotMatch(releaseWorkflow, /seal-vVERSION/);
  assert.equal(fs.readFileSync(path.join(ROOT, "SHA256SUMS"), "utf8").trim(), "");
});

test("sync leaves no old product version in the named reader-facing search surface", () => {
  const oldVersion = VERSION;
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "seal-version-stale-"));
  fs.cpSync(ROOT, scratch, {
    recursive: true,
    filter(source) {
      const relative = path.relative(ROOT, source);
      return ![".git", "dist", "kernel"].includes(relative) && !/^spine\/.*\.wasm(?:\..*)?$/.test(relative);
    },
  });
  const bumpedVersion = VERSION === "9.9.9" ? "9.9.10" : "9.9.9";
  fs.writeFileSync(path.join(scratch, "VERSION"), `${bumpedVersion}\n`);
  const sync = run(process.execPath, [path.join(scratch, "scripts", "sync-version.cjs")]);
  assert.equal(sync.code, 0, sync.stderr);
  assert.deepEqual(
    staleVersionMatches(scratch, oldVersion),
    [],
    `reader-facing search surface retains old ${oldVersion}; search surface: ${READER_FACING_VERSION_SEARCH_ROOTS.join(", ")}`,
  );
});

test("stale-version scope catches a stale release-note filename in a live document", () => {
  assertStaleMatches(
    "0.2.0",
    {
      "docs/guide/live.md": "See docs/assurance/RELEASE-NOTES-v0.2.0-rc.2.md for the old release.\n",
    },
    ["docs/guide/live.md"],
    "live docs must be checked for stale release-note filenames",
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
      "docs/start/live.txt-check.md": "This live page still points at RELEASE-NOTES-v0.2.0-rc.2.txt.\n",
    },
    ["docs/start/live.txt-check.md"],
    "live docs must still catch stale unknown-extension filenames",
  );
});

test("stale-version matcher does not flag a four-part version or sentence-ending prose in a live document", () => {
  assertStaleMatches(
    "0.2.0",
    {
      "docs/guide/non-stale.md": "Version history: v0.2.0.1 was a different line, and we shipped 0.2.0.\n",
    },
    [],
    "four-part versions and sentence-ending prose must stay unflagged",
  );
});

test("stale-version scope checks a new active document by default", () => {
  assertStaleMatches(
    "0.2.0",
    {
      "docs/guide/new-active-doc.md": "New guide page, stale link: RELEASE-NOTES-v0.2.0-rc.2.md.\n",
    },
    ["docs/guide/new-active-doc.md"],
    "new live docs under the checked trees must be checked without updating the scope list",
  );
});
