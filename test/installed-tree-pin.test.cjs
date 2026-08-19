// SPDX-License-Identifier: Apache-2.0
// A documentation paste that names an installed store must name the tree a
// fresh artifact builds. Keep this separate from the artifact-byte pin: the
// two values can drift separately.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");
const { sha256Hex, treeDigest, unpackPayload } = require("../spine/integrity.cjs");

const ROOT = path.join(__dirname, "..");
const BUILD = path.join(ROOT, "scripts", "build-dist.cjs");
const TREE = /\btree:?\s+([0-9a-f]{64})\b/g;
const STORE = /\/store\/([0-9a-f]{64})(?=\/|\b)/g;
const MARKER = "\n// --SEAL-PAYLOAD--\n";

function scratchRoot() {
  return process.env.RUNNER_TEMP || os.tmpdir();
}

function quotedTreeHashes(text) {
  return [...text.matchAll(TREE), ...text.matchAll(STORE)].map((match) => match[1]);
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

function buildDist() {
  const out = fs.mkdtempSync(path.join(scratchRoot(), "seal-installed-tree-pin-"));
  const built = spawnSync(process.execPath, [BUILD, "--out", out], { encoding: "utf8" });
  assert.equal(built.status, 0, built.stdout + built.stderr);
  return { out, built };
}

function namedArtifact(out, buildStdout) {
  const metaPath = fs.readdirSync(out).find((name) => name.endsWith(".meta.json"));
  assert.ok(metaPath, `build did not write metadata\n${buildStdout || ""}`);
  const meta = JSON.parse(fs.readFileSync(path.join(out, metaPath), "utf8"));
  assert.equal(typeof meta.artifact, "string");
  assert.match(meta.artifact, /\S/);
  return path.join(out, meta.artifact);
}

function refuse(code, reason) {
  assert.fail(`REFUSE ${code}: ${reason}`);
}

function readArtifactBytes(artifactPath) {
  let stat;
  try {
    stat = fs.statSync(artifactPath);
  } catch (error) {
    if (error && error.code === "ENOENT") {
      refuse("artifact_missing", `built artifact absent: ${artifactPath}`);
    }
    refuse("artifact_unreadable", `built artifact unreadable: ${artifactPath}: ${error.message}`);
  }
  if (!stat.isFile()) {
    refuse("artifact_missing", `built artifact absent: ${artifactPath}`);
  }
  if (stat.size === 0) {
    refuse("artifact_empty", `built artifact is empty: ${artifactPath}`);
  }
  let bytes;
  try {
    bytes = fs.readFileSync(artifactPath);
  } catch (error) {
    refuse("artifact_unreadable", `built artifact unreadable: ${artifactPath}: ${error.message}`);
  }
  if (bytes.length === 0) {
    refuse("artifact_empty", `built artifact is empty: ${artifactPath}`);
  }
  return bytes;
}

function treeSha256FromArtifactBytes(bytes) {
  const marker = Buffer.from(MARKER, "utf8");
  const at = bytes.indexOf(marker);
  if (at < 0) {
    refuse("artifact_malformed", "built artifact carries no payload");
  }
  const { files } = unpackPayload(bytes.subarray(at + marker.length));
  return treeDigest(files.map((file) => ({
    path: file.path,
    bytes: file.data.length,
    sha256: sha256Hex(file.data),
  })));
}

function treeSha256FromBuiltArtifact(out, buildStdout) {
  return treeSha256FromArtifactBytes(readArtifactBytes(namedArtifact(out, buildStdout)));
}

function assertNamedRefuse(fn, code) {
  let failed = null;
  try {
    fn();
  } catch (error) {
    failed = error;
  }
  assert.ok(failed, `expected REFUSE ${code}, but the pin accepted the artifact`);
  assert.match(String(failed.message), new RegExp(`^REFUSE ${code}:`));
}

test("quoted installed-tree hashes match a freshly built artifact", (t) => {
  const { out, built } = buildDist();
  t.after(() => removeScratch(out));

  const expected = treeSha256FromBuiltArtifact(out, built.stdout);
  assert.match(expected, /^[0-9a-f]{64}$/);

  let quoted = 0;
  for (const relative of trackedFiles()) {
    const hashes = quotedTreeHashes(fs.readFileSync(path.join(ROOT, relative), "utf8"));
    for (const actual of hashes) {
      quoted += 1;
      assert.equal(actual, expected, `${relative} installed-tree hash mismatch: quoted ${actual}, fresh build ${expected}`);
    }
  }
  assert.ok(quoted > 0, "the repository must quote at least one installed-tree hash");
});

test("a missing built artifact is a named refusal", (t) => {
  const { out, built } = buildDist();
  t.after(() => removeScratch(out));
  const artifact = namedArtifact(out, built.stdout);
  fs.rmSync(artifact);
  assertNamedRefuse(() => treeSha256FromBuiltArtifact(out, built.stdout), "artifact_missing");
});

test("an empty built artifact is a named refusal", (t) => {
  const { out, built } = buildDist();
  t.after(() => removeScratch(out));
  const artifact = namedArtifact(out, built.stdout);
  fs.rmSync(artifact);
  fs.writeFileSync(artifact, Buffer.alloc(0), { mode: 0o555 });
  assert.equal(fs.statSync(artifact).size, 0);
  assertNamedRefuse(() => treeSha256FromBuiltArtifact(out, built.stdout), "artifact_empty");
});

test("an unreadable built artifact is a named refusal", (t) => {
  const { out, built } = buildDist();
  t.after(() => {
    const artifact = namedArtifact(out, built.stdout);
    try { fs.chmodSync(artifact, 0o644); } catch { /* restore before cleanup */ }
    removeScratch(out);
  });
  const artifact = namedArtifact(out, built.stdout);
  fs.chmodSync(artifact, 0);
  assert.equal(fs.statSync(artifact).mode & 0o777, 0);
  assertNamedRefuse(() => treeSha256FromBuiltArtifact(out, built.stdout), "artifact_unreadable");
});
