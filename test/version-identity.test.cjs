// SPDX-License-Identifier: Apache-2.0
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const ROOT = path.join(__dirname, "..");
const VERSION = fs.readFileSync(path.join(ROOT, "VERSION"), "utf8").trim();
const artifactName = `seal-v${VERSION}-linux-x64`;
// Named search surface for the stale-version check below: all Markdown readers
// can receive release copy, including the top-level README and every guide.
const READER_FACING_VERSION_SEARCH_ROOTS = ["README.md", "docs/**/*.md"];

function run(file, args, options = {}) {
  const result = spawnSync(file, args, { encoding: "utf8", ...options });
  return { code: result.status, stdout: result.stdout || "", stderr: result.stderr || "" };
}

function readerFacingMarkdownFiles(root) {
  const docs = path.join(root, "docs");
  const files = [path.join(root, "README.md")];
  function visit(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(target);
      else if (entry.isFile() && entry.name.endsWith(".md")) files.push(target);
    }
  }
  visit(docs);
  return files;
}

test("every emitted release identity derives from VERSION", () => {
  assert.match(VERSION, /^\d+\.\d+\.\d+$/);
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
  const artifact = path.join(out, artifactName);
  assert.ok(fs.existsSync(artifact));
  const [digest, bytes, named] = fs.readFileSync(path.join(out, "SHA256SUMS"), "utf8").trim().split(/\s+/);
  assert.equal(named, artifactName);
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

  const [pinnedDigest, pinnedBytes, pinnedName] = fs.readFileSync(path.join(ROOT, "SHA256SUMS"), "utf8").trim().split(/\s+/);
  for (const file of ["README.md", "docs/DISTRIBUTION.md", "docs/guide/README.md"]) {
    const text = fs.readFileSync(path.join(ROOT, file), "utf8");
    assert.match(text, new RegExp(`${artifactName} --sha256 ${pinnedDigest}`));
  }
  for (const file of ["README.md", "docs/guide/README.md"]) {
    const text = fs.readFileSync(path.join(ROOT, file), "utf8");
    assert.match(text, new RegExp(`installed seal ${VERSION} linux-x64`));
  }
  for (const file of ["README.md", "docs/DISTRIBUTION.md", `docs/RELEASE-NOTES-v${VERSION}.md`, "spine/platform.cjs", "scripts/install.cjs", "scripts/seal-launch.cjs", ".github/workflows/release.yml"]) {
    assert.match(fs.readFileSync(path.join(ROOT, file), "utf8"), new RegExp(`Seal v${VERSION}`));
  }
  assert.match(pinnedDigest, /^[0-9a-f]{64}$/);
  assert.match(pinnedBytes, /^\d+$/);
  assert.equal(pinnedName, artifactName);
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
  const oldLiteral = new RegExp(`(?<![0-9.])${oldVersion.replaceAll(".", "\\.")}(?![0-9.])`);
  for (const file of readerFacingMarkdownFiles(scratch)) {
    assert.doesNotMatch(fs.readFileSync(file, "utf8"), oldLiteral, `${path.relative(scratch, file)} retains old ${oldVersion}; search surface: ${READER_FACING_VERSION_SEARCH_ROOTS.join(", ")}`);
  }
});
