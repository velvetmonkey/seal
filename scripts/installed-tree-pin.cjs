// SPDX-License-Identifier: Apache-2.0
// Shared installed-tree pin derivation and quote discovery. The test is the
// consumer/gate; sync-installed-tree-pin.cjs is the producer.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { sha256Hex, treeDigest, unpackPayload } = require("../spine/integrity.cjs");

const ROOT = path.join(__dirname, "..");
const BUILD = path.join(ROOT, "scripts", "build-dist.cjs");
const TREE = /\btree:?\s+([0-9a-f]{64})\b/g;
const STORE = /\/store\/([0-9a-f]{64})(?=\/|\b)/g;
const ROLE_MARKER = /^\*\*Seal installed-tree pin role:\*\* `([A-Za-z0-9][A-Za-z0-9-]*)`\r?$/;
const KNOWN_ROLES = new Set(["published-asset", "fresh-build"]);
const MARKER = "\n// --SEAL-PAYLOAD--\n";

function refuse(code, reason) {
  assert.fail(`REFUSE ${code}: ${reason}`);
}

function scratchRoot() {
  return process.env.RUNNER_TEMP || os.tmpdir();
}

function lineNumber(text, index) {
  return text.slice(0, index).split("\n").length;
}

function fencedBlocks(text) {
  const lines = text.split("\n");
  const blocks = [];
  let offset = 0;
  let open = null;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].replace(/\r$/, "");
    const width = lines[index].length + (index < lines.length - 1 ? 1 : 0);
    if (/^```/.test(line)) {
      if (open === null) {
        open = {
          start: offset,
          end: text.length,
          markerLine: index > 0 ? lines[index - 1].replace(/\r$/, "") : "",
          markerLineNumber: index,
        };
      } else {
        open.end = offset + width;
        blocks.push(open);
        open = null;
      }
    }
    offset += width;
  }
  if (open !== null) blocks.push(open);
  return blocks;
}

function declaredHashRole(text, index, file, blocks) {
  const line = lineNumber(text, index);
  const block = blocks.find((candidate) => index >= candidate.start && index < candidate.end);
  const marker = block ? block.markerLine.match(ROLE_MARKER) : null;
  if (!marker) {
    refuse(
      "role_marker_absent",
      `${file}:${line} store hash has no role marker; add ` +
        "**Seal installed-tree pin role:** `published-asset` or " +
        "**Seal installed-tree pin role:** `fresh-build` immediately before its fenced block",
    );
  }
  const role = marker[1];
  if (!KNOWN_ROLES.has(role)) {
    refuse(
      "role_marker_unknown",
      `${file}:${block.markerLineNumber} unknown store-hash role ${JSON.stringify(role)} for hash at line ${line}`,
    );
  }
  return { role, line };
}

function quotedTreeHashHits(text, file = "<memory>") {
  const blocks = fencedBlocks(text);
  return [...text.matchAll(TREE), ...text.matchAll(STORE)].map((match) => {
    const declared = declaredHashRole(text, match.index, file, blocks);
    return {
      hash: match[1],
      index: match.index,
      role: declared.role,
      line: declared.line,
    };
  });
}

function trackedFiles() {
  const listed = spawnSync("git", ["-C", ROOT, "ls-files"], { encoding: "utf8" });
  assert.equal(listed.status, 0, listed.stdout + listed.stderr);
  return listed.stdout.trim().split("\n").filter(Boolean);
}

function removeScratch(dir) {
  spawnSync("chmod", ["-R", "u+w", dir], { encoding: "utf8" });
  fs.rmSync(dir, { recursive: true, force: true });
}

function insideOutputDir(out, candidate) {
  const outRoot = path.resolve(out);
  const resolved = path.resolve(candidate);
  const rel = path.relative(outRoot, resolved);
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}

function emittedArtifactPath(out, buildStdout) {
  const firstLine = String(buildStdout || "").split("\n")[0].trim();
  if (!firstLine) refuse("locator_unbound", "build did not print the emitted artifact path");
  const emitted = path.resolve(firstLine);
  if (!insideOutputDir(out, emitted)) {
    refuse("locator_unbound", `build printed an artifact path outside the output directory: ${firstLine}`);
  }
  return emitted;
}

function readMetadata(out, buildStdout) {
  const metaName = fs.readdirSync(out).find((name) => name.endsWith(".meta.json"));
  assert.ok(metaName, `build did not write metadata\n${buildStdout || ""}`);
  const metaPath = path.join(out, metaName);
  let raw;
  try {
    const stat = fs.statSync(metaPath);
    if ((stat.mode & 0o444) === 0) refuse("meta_unreadable", `metadata unreadable: ${metaPath}: file has no read bits`);
    raw = fs.readFileSync(metaPath, "utf8");
  } catch (error) {
    if (String(error && error.message).startsWith("REFUSE meta_unreadable:")) throw error;
    refuse("meta_unreadable", `metadata unreadable: ${metaPath}: ${error.message}`);
  }
  try {
    return { meta: JSON.parse(raw), metaPath };
  } catch (error) {
    refuse("meta_unreadable", `metadata unreadable: ${metaPath}: ${error.message}`);
  }
}

function namedArtifact(out, buildStdout) {
  const emitted = emittedArtifactPath(out, buildStdout);
  const { meta } = readMetadata(out, buildStdout);
  if (typeof meta.artifact !== "string" || !/\S/.test(meta.artifact)) refuse("locator_absent", "metadata does not name the artifact");
  if (meta.artifact !== path.basename(meta.artifact)) refuse("locator_escape", `metadata artifact escapes output directory: ${meta.artifact}`);
  const located = path.resolve(out, meta.artifact);
  if (!insideOutputDir(out, located)) refuse("locator_escape", `metadata artifact escapes output directory: ${meta.artifact}`);
  if (located !== emitted) {
    refuse("locator_mismatch", `metadata artifact ${meta.artifact} is not the emitted artifact ${path.basename(emitted)}`);
  }
  return emitted;
}

function buildDist() {
  const out = fs.mkdtempSync(path.join(scratchRoot(), "seal-installed-tree-pin-"));
  const built = spawnSync(process.execPath, [BUILD, "--out", out], { encoding: "utf8" });
  assert.equal(built.status, 0, built.stdout + built.stderr);
  const artifact = namedArtifact(out, built.stdout);
  let stat;
  try {
    stat = fs.lstatSync(artifact, { bigint: true });
  } catch (error) {
    if (error && error.code === "ENOENT") refuse("artifact_missing", `built artifact absent: ${artifact}`);
    refuse("artifact_unreadable", `built artifact unreadable: ${artifact}: ${error.message}`);
  }
  if (stat.isSymbolicLink()) refuse("artifact_identity_mismatch", `build emitted a symbolic-link alias: ${artifact}`);
  if (!stat.isFile()) refuse("artifact_missing", `built artifact absent: ${artifact}`);
  return { out, built, identity: { dev: stat.dev, ino: stat.ino, nlink: stat.nlink } };
}

function readArtifactBytes(artifactPath, expectedIdentity) {
  let physical;
  try {
    physical = fs.lstatSync(artifactPath, { bigint: true });
  } catch (error) {
    if (error && error.code === "ENOENT") refuse("artifact_missing", `built artifact absent: ${artifactPath}`);
    refuse("artifact_unreadable", `built artifact unreadable: ${artifactPath}: ${error.message}`);
  }
  if (physical.isSymbolicLink()) refuse("artifact_identity_mismatch", `built artifact is a symbolic-link alias: ${artifactPath}`);
  let stat;
  try {
    stat = fs.statSync(artifactPath, { bigint: true });
  } catch (error) {
    if (error && error.code === "ENOENT") refuse("artifact_missing", `built artifact absent: ${artifactPath}`);
    refuse("artifact_unreadable", `built artifact unreadable: ${artifactPath}: ${error.message}`);
  }
  if (!stat.isFile()) refuse("artifact_missing", `built artifact absent: ${artifactPath}`);
  if (stat.size === 0n) refuse("artifact_empty", `built artifact is empty: ${artifactPath}`);
  if ((stat.mode & 0o444n) === 0n) refuse("artifact_unreadable", `built artifact unreadable: ${artifactPath}: file has no read bits`);
  if (stat.dev !== expectedIdentity.dev || stat.ino !== expectedIdentity.ino || stat.nlink !== expectedIdentity.nlink) {
    refuse(
      "artifact_identity_mismatch",
      `built artifact physical identity changed: ${artifactPath}; ` +
        `expected dev=${expectedIdentity.dev} ino=${expectedIdentity.ino} nlink=${expectedIdentity.nlink}, ` +
        `found dev=${stat.dev} ino=${stat.ino} nlink=${stat.nlink}`,
    );
  }
  let bytes;
  try {
    bytes = fs.readFileSync(artifactPath);
  } catch (error) {
    refuse("artifact_unreadable", `built artifact unreadable: ${artifactPath}: ${error.message}`);
  }
  if (bytes.length === 0) refuse("artifact_empty", `built artifact is empty: ${artifactPath}`);
  return bytes;
}

function treeSha256FromArtifactBytes(bytes) {
  const marker = Buffer.from(MARKER, "utf8");
  const at = bytes.indexOf(marker);
  if (at < 0) refuse("artifact_malformed", "built artifact carries no payload");
  const { files } = unpackPayload(bytes.subarray(at + marker.length));
  return treeDigest(files.map((file) => ({
    path: file.path,
    bytes: file.data.length,
    sha256: sha256Hex(file.data),
  })));
}

function treeSha256FromBuiltArtifact(out, buildStdout, expectedIdentity) {
  return treeSha256FromArtifactBytes(readArtifactBytes(namedArtifact(out, buildStdout), expectedIdentity));
}

function downloadToFile(url, dest) {
  const result = spawnSync("curl", ["-fsSL", "--max-time", "30", "-o", dest, url], { encoding: "utf8" });
  if (result.status !== 0) {
    refuse("published_asset_unreadable", `cannot download ${url}: ${(result.stderr || result.stdout || "").trim() || `exit ${result.status}`}`);
  }
}

function publishedTreeSha256FromRelease() {
  const readme = fs.readFileSync(path.join(ROOT, "README.md"), "utf8");
  const match = readme.match(/^(?:\$ )?SEAL_VERSION=(v[0-9.]+(?:-[0-9A-Za-z.-]+)?)$/m);
  if (!match) refuse("published_tag_absent", "README.md has no release version command");
  const tag = match[1];
  const name = `seal-${tag}-linux-x64`;
  const scratch = fs.mkdtempSync(path.join(scratchRoot(), "seal-published-tree-"));
  try {
    const artifactPath = path.join(scratch, name);
    const sumsPath = path.join(scratch, "SHA256SUMS");
    const base = `https://github.com/velvetmonkey/seal/releases/download/${tag}`;
    downloadToFile(`${base}/SHA256SUMS`, sumsPath);
    downloadToFile(`${base}/${name}`, artifactPath);
    const [digest, count, named] = fs.readFileSync(sumsPath, "utf8").trim().split(/\s+/);
    if (named !== name) refuse("published_asset_unreadable", `SHA256SUMS names ${named}, expected ${name}`);
    const bytes = fs.readFileSync(artifactPath);
    if (String(bytes.length) !== String(count)) refuse("published_asset_unreadable", `published artifact is ${bytes.length} bytes, SHA256SUMS says ${count}`);
    const actual = sha256Hex(bytes);
    if (actual !== digest) refuse("published_asset_unreadable", `published artifact digest ${actual} does not match SHA256SUMS ${digest}`);
    return treeSha256FromArtifactBytes(bytes);
  } finally {
    removeScratch(scratch);
  }
}

module.exports = {
  ROOT,
  buildDist,
  namedArtifact,
  publishedTreeSha256FromRelease,
  quotedTreeHashHits,
  readArtifactBytes,
  removeScratch,
  trackedFiles,
  treeSha256FromArtifactBytes,
  treeSha256FromBuiltArtifact,
};
