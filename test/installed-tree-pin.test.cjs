// SPDX-License-Identifier: Apache-2.0
// A documentation paste that names an installed store must name the tree that
// paste is actually about. A block that installs the published release asset
// is not the same claim as a block that describes a fresh build of this tree.
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
const ROLE_MARKER = /^<!-- seal-store-hash-role: ([A-Za-z0-9][A-Za-z0-9-]*) -->\r?$/;
const KNOWN_ROLES = new Set(["published-asset", "fresh-build"]);
const MARKER = "\n// --SEAL-PAYLOAD--\n";

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
        "<!-- seal-store-hash-role: published-asset --> or " +
        "<!-- seal-store-hash-role: fresh-build --> immediately before its fenced block",
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

function buildDist() {
  const out = fs.mkdtempSync(path.join(scratchRoot(), "seal-installed-tree-pin-"));
  const built = spawnSync(process.execPath, [BUILD, "--out", out], { encoding: "utf8" });
  assert.equal(built.status, 0, built.stdout + built.stderr);
  const artifact = namedArtifact(out, built.stdout);
  let stat;
  try {
    stat = fs.lstatSync(artifact, { bigint: true });
  } catch (error) {
    if (error && error.code === "ENOENT") {
      refuse("artifact_missing", `built artifact absent: ${artifact}`);
    }
    refuse("artifact_unreadable", `built artifact unreadable: ${artifact}: ${error.message}`);
  }
  if (stat.isSymbolicLink()) {
    refuse("artifact_identity_mismatch", `build emitted a symbolic-link alias: ${artifact}`);
  }
  if (!stat.isFile()) {
    refuse("artifact_missing", `built artifact absent: ${artifact}`);
  }
  return {
    out,
    built,
    identity: { dev: stat.dev, ino: stat.ino, nlink: stat.nlink },
  };
}

function refuse(code, reason) {
  assert.fail(`REFUSE ${code}: ${reason}`);
}

function insideOutputDir(out, candidate) {
  const outRoot = path.resolve(out);
  const resolved = path.resolve(candidate);
  const rel = path.relative(outRoot, resolved);
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}

function emittedArtifactPath(out, buildStdout) {
  const firstLine = String(buildStdout || "").split("\n")[0].trim();
  if (!firstLine) {
    refuse("locator_unbound", "build did not print the emitted artifact path");
  }
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
    if ((stat.mode & 0o444) === 0) {
      refuse("meta_unreadable", `metadata unreadable: ${metaPath}: file has no read bits`);
    }
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
  if (typeof meta.artifact !== "string" || !/\S/.test(meta.artifact)) {
    refuse("locator_absent", "metadata does not name the artifact");
  }
  if (meta.artifact !== path.basename(meta.artifact)) {
    refuse("locator_escape", `metadata artifact escapes output directory: ${meta.artifact}`);
  }
  const located = path.resolve(out, meta.artifact);
  if (!insideOutputDir(out, located)) {
    refuse("locator_escape", `metadata artifact escapes output directory: ${meta.artifact}`);
  }
  if (located !== emitted) {
    refuse(
      "locator_mismatch",
      `metadata artifact ${meta.artifact} is not the emitted artifact ${path.basename(emitted)}`,
    );
  }
  return emitted;
}

function readArtifactBytes(artifactPath, expectedIdentity) {
  let physical;
  try {
    physical = fs.lstatSync(artifactPath, { bigint: true });
  } catch (error) {
    if (error && error.code === "ENOENT") {
      refuse("artifact_missing", `built artifact absent: ${artifactPath}`);
    }
    refuse("artifact_unreadable", `built artifact unreadable: ${artifactPath}: ${error.message}`);
  }
  if (physical.isSymbolicLink()) {
    refuse("artifact_identity_mismatch", `built artifact is a symbolic-link alias: ${artifactPath}`);
  }
  let stat;
  try {
    stat = fs.statSync(artifactPath, { bigint: true });
  } catch (error) {
    if (error && error.code === "ENOENT") {
      refuse("artifact_missing", `built artifact absent: ${artifactPath}`);
    }
    refuse("artifact_unreadable", `built artifact unreadable: ${artifactPath}: ${error.message}`);
  }
  if (!stat.isFile()) {
    refuse("artifact_missing", `built artifact absent: ${artifactPath}`);
  }
  if (stat.size === 0n) {
    refuse("artifact_empty", `built artifact is empty: ${artifactPath}`);
  }
  if ((stat.mode & 0o444n) === 0n) {
    refuse("artifact_unreadable", `built artifact unreadable: ${artifactPath}: file has no read bits`);
  }
  if (
    stat.dev !== expectedIdentity.dev ||
    stat.ino !== expectedIdentity.ino ||
    stat.nlink !== expectedIdentity.nlink
  ) {
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

function treeSha256FromBuiltArtifact(out, buildStdout, expectedIdentity) {
  return treeSha256FromArtifactBytes(readArtifactBytes(namedArtifact(out, buildStdout), expectedIdentity));
}

function downloadToFile(url, dest) {
  const result = spawnSync("curl", ["-fsSL", "--max-time", "30", "-o", dest, url], { encoding: "utf8" });
  if (result.status !== 0) {
    refuse(
      "published_asset_unreadable",
      `cannot download ${url}: ${(result.stderr || result.stdout || "").trim() || `exit ${result.status}`}`,
    );
  }
}

function publishedTreeSha256FromRelease() {
  const readme = fs.readFileSync(path.join(ROOT, "README.md"), "utf8");
  const match = readme.match(/^\$ SEAL_VERSION=(v[0-9.]+(?:-[0-9A-Za-z.-]+)?)$/m);
  if (!match) {
    refuse("published_tag_absent", "README.md has no release version command");
  }
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
    if (named !== name) {
      refuse("published_asset_unreadable", `SHA256SUMS names ${named}, expected ${name}`);
    }
    const bytes = fs.readFileSync(artifactPath);
    if (String(bytes.length) !== String(count)) {
      refuse("published_asset_unreadable", `published artifact is ${bytes.length} bytes, SHA256SUMS says ${count}`);
    }
    const actual = sha256Hex(bytes);
    if (actual !== digest) {
      refuse("published_asset_unreadable", `published artifact digest ${actual} does not match SHA256SUMS ${digest}`);
    }
    return treeSha256FromArtifactBytes(bytes);
  } finally {
    removeScratch(scratch);
  }
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

function rewriteMetadata(out, mutate) {
  const metaName = fs.readdirSync(out).find((name) => name.endsWith(".meta.json"));
  assert.ok(metaName, "build did not write metadata");
  const metaPath = path.join(out, metaName);
  const meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
  mutate(meta, metaPath);
  fs.writeFileSync(metaPath, `${JSON.stringify(meta, null, 2)}\n`);
}

test("published-asset markers govern four download shapes without prose inference", () => {
  const publishedShape = "a".repeat(64);
  const shapes = [
    "$ gh release download v0.2.0-rc.2 --pattern 'seal-*-linux-x64'",
    "$ cp /srv/internal-release-mirror/seal/v0.2.0-rc.2/linux-x64 ./seal",
    "$ gh api repos/velvetmonkey/seal/releases/assets/123456 > ./seal",
    "$ release-cache get velvetmonkey/seal v0.2.0-rc.2 linux-x64 > ./seal",
  ];
  for (const prose of shapes) {
    const text = [
      prose,
      "<!-- seal-store-hash-role: published-asset -->",
      "```output",
      `store: /home/x/.local/lib/seal/store/${publishedShape}`,
      "```",
    ].join("\n");
    const hits = quotedTreeHashHits(text, "shape.md");
    assert.equal(hits.length, 1);
    assert.equal(hits[0].role, "published-asset");
  }
});

test("a fresh-build marker wins when prose incidentally mentions releases/download", () => {
  const freshShape = "b".repeat(64);
  const text = [
    "Unlike releases/download/, this builds the checkout.",
    "<!-- seal-store-hash-role: fresh-build -->",
    "```text",
    `node "/scratch/.local/lib/seal/store/${freshShape}/checker/seal-receipt-check.mjs" receipt.json`,
    "```",
  ].join("\n");
  const hits = quotedTreeHashHits(text, "fresh.md");
  assert.equal(hits.length, 1);
  assert.equal(hits[0].role, "fresh-build");
});

test("an unmarked store hash is a named refusal with file, line, and required markers", () => {
  const text = ["```output", `store: /store/${"c".repeat(64)}`, "```"].join("\n");
  assertNamedRefuse(() => quotedTreeHashHits(text, "unmarked.md"), "role_marker_absent");
  assert.throws(
    () => quotedTreeHashHits(text, "unmarked.md"),
    /unmarked\.md:2.*seal-store-hash-role: published-asset.*seal-store-hash-role: fresh-build/,
  );
});

test("an unrecognised store-hash role is a named refusal", () => {
  const text = [
    "<!-- seal-store-hash-role: release-cache -->",
    "```output",
    `tree: ${"d".repeat(64)}`,
    "```",
  ].join("\n");
  assertNamedRefuse(() => quotedTreeHashHits(text, "unknown.md"), "role_marker_unknown");
  assert.throws(() => quotedTreeHashHits(text, "unknown.md"), /unknown\.md:1 unknown store-hash role "release-cache"/);
});

function markedBlockBytes(text, role) {
  const marker = `<!-- seal-store-hash-role: ${role} -->`;
  const blocks = [];
  let from = 0;
  while (true) {
    const start = text.indexOf(marker, from);
    if (start === -1) return blocks;
    const fence = text.indexOf("```", start + marker.length);
    const close = fence === -1 ? -1 : text.indexOf("```", fence + 3);
    assert.notEqual(fence, -1, `${role} marker has no opening fence`);
    assert.notEqual(close, -1, `${role} marker has no closing fence`);
    blocks.push(Buffer.from(text.slice(start, close + 3)));
    from = close + 3;
  }
}

test("repin refuses published-asset blocks by name and changes only marked fresh-build hashes", (t) => {
  const copy = fs.mkdtempSync(path.join(scratchRoot(), "seal-repin-role-"));
  t.after(() => removeScratch(copy));
  fs.cpSync(ROOT, copy, {
    recursive: true,
    filter(source) {
      return source !== path.join(ROOT, ".git") && !source.startsWith(path.join(ROOT, "dist"));
    },
  });

  const files = ["README.md", "docs/guide/README.md"];
  const before = new Map();
  for (const relative of files) {
    const target = path.join(copy, relative);
    let text = fs.readFileSync(target, "utf8");
    if (relative === "README.md") {
      text = text.replace(
        /(<!-- seal-store-hash-role: fresh-build -->[\s\S]*?\/store\/)[0-9a-f]{64}/,
        `$1${"f".repeat(64)}`,
      );
      fs.writeFileSync(target, text);
    }
    before.set(relative, markedBlockBytes(text, "published-asset"));
  }

  const repin = spawnSync(process.execPath, [path.join(copy, "scripts", "repin-dist.cjs")], {
    cwd: copy,
    encoding: "utf8",
  });
  assert.equal(repin.status, 1, repin.stdout + repin.stderr);
  assert.match(repin.stderr, /REFUSE published_asset_pin: README\.md:\d+ role published-asset/);
  assert.match(repin.stderr, /REFUSE published_asset_pin: docs\/guide\/README\.md:\d+ role published-asset/);
  for (const relative of files) {
    const after = markedBlockBytes(fs.readFileSync(path.join(copy, relative), "utf8"), "published-asset");
    assert.deepEqual(after, before.get(relative), `${relative} published-asset blocks changed`);
  }
  assert.doesNotMatch(fs.readFileSync(path.join(copy, "README.md"), "utf8"), new RegExp("f{64}"));
});

test("quoted installed-tree hashes match a freshly built artifact", (t) => {
  const { out, built, identity } = buildDist();
  t.after(() => removeScratch(out));

  const freshExpected = treeSha256FromBuiltArtifact(out, built.stdout, identity);
  assert.match(freshExpected, /^[0-9a-f]{64}$/);
  const publishedExpected = publishedTreeSha256FromRelease();
  assert.match(publishedExpected, /^[0-9a-f]{64}$/);

  let quoted = 0;
  let quotedPublished = 0;
  let quotedFresh = 0;
  for (const relative of trackedFiles()) {
    const hits = quotedTreeHashHits(fs.readFileSync(path.join(ROOT, relative), "utf8"), relative);
    for (const hit of hits) {
      quoted += 1;
      const expected = hit.role === "published-asset" ? publishedExpected : freshExpected;
      if (hit.role === "published-asset") quotedPublished += 1;
      else quotedFresh += 1;
      assert.equal(
        hit.hash,
        expected,
        `${relative}:${hit.line} ${hit.role} installed-tree hash mismatch: ` +
          `quoted ${hit.hash}, ${hit.role} ${expected}`,
      );
    }
  }
  assert.ok(quoted > 0, "the repository must quote at least one installed-tree hash");
  assert.ok(quotedPublished > 0, "the repository must quote at least one published-asset installed-tree hash");
  assert.ok(quotedFresh > 0, "the repository must quote at least one fresh-build installed-tree hash");
});

test("a missing built artifact is a named refusal", (t) => {
  const { out, built, identity } = buildDist();
  t.after(() => removeScratch(out));
  const artifact = namedArtifact(out, built.stdout);
  fs.rmSync(artifact);
  assertNamedRefuse(() => treeSha256FromBuiltArtifact(out, built.stdout, identity), "artifact_missing");
});

test("an empty built artifact is a named refusal", (t) => {
  const { out, built, identity } = buildDist();
  t.after(() => removeScratch(out));
  const artifact = namedArtifact(out, built.stdout);
  fs.rmSync(artifact);
  fs.writeFileSync(artifact, Buffer.alloc(0), { mode: 0o555 });
  assert.equal(fs.statSync(artifact).size, 0);
  assertNamedRefuse(() => treeSha256FromBuiltArtifact(out, built.stdout, identity), "artifact_empty");
});

test("an unreadable built artifact is a named refusal", (t) => {
  const { out, built, identity } = buildDist();
  t.after(() => {
    const artifact = namedArtifact(out, built.stdout);
    try { fs.chmodSync(artifact, 0o644); } catch { /* restore before cleanup */ }
    removeScratch(out);
  });
  const artifact = namedArtifact(out, built.stdout);
  fs.chmodSync(artifact, 0);
  assert.equal(fs.statSync(artifact).mode & 0o777, 0);
  assertNamedRefuse(() => treeSha256FromBuiltArtifact(out, built.stdout, identity), "artifact_unreadable");
});

test("a missing metadata locator is a named refusal", (t) => {
  const { out, built, identity } = buildDist();
  t.after(() => removeScratch(out));
  rewriteMetadata(out, (meta) => {
    delete meta.artifact;
  });
  assertNamedRefuse(() => treeSha256FromBuiltArtifact(out, built.stdout, identity), "locator_absent");
});

test("an unreadable metadata file is a named refusal", (t) => {
  const { out, built, identity } = buildDist();
  t.after(() => {
    const metaName = fs.readdirSync(out).find((name) => name.endsWith(".meta.json"));
    if (metaName) {
      try { fs.chmodSync(path.join(out, metaName), 0o644); } catch { /* restore before cleanup */ }
    }
    removeScratch(out);
  });
  const metaName = fs.readdirSync(out).find((name) => name.endsWith(".meta.json"));
  assert.ok(metaName, "build did not write metadata");
  const metaPath = path.join(out, metaName);
  fs.chmodSync(metaPath, 0);
  assert.equal(fs.statSync(metaPath).mode & 0o777, 0);
  assertNamedRefuse(() => treeSha256FromBuiltArtifact(out, built.stdout, identity), "meta_unreadable");
});

test("a metadata artifact name cannot resolve through a symbolic-link alias", (t) => {
  const { out, built, identity } = buildDist();
  t.after(() => removeScratch(out));
  const artifact = namedArtifact(out, built.stdout);
  const target = path.join(out, `symlink-target-${path.basename(artifact)}`);
  fs.copyFileSync(artifact, target);
  fs.rmSync(artifact);
  fs.symlinkSync(path.basename(target), artifact);
  assertNamedRefuse(
    () => treeSha256FromBuiltArtifact(out, built.stdout, identity),
    "artifact_identity_mismatch",
  );
});

test("a metadata artifact name cannot resolve through a hardlink to another file", (t) => {
  const { out, built, identity } = buildDist();
  t.after(() => removeScratch(out));
  const artifact = namedArtifact(out, built.stdout);
  const target = path.join(out, `hardlink-target-${path.basename(artifact)}`);
  fs.copyFileSync(artifact, target);
  fs.rmSync(artifact);
  fs.linkSync(target, artifact);
  assertNamedRefuse(
    () => treeSha256FromBuiltArtifact(out, built.stdout, identity),
    "artifact_identity_mismatch",
  );
});

test("a metadata locator that names a different file in the output directory is a named refusal", (t) => {
  const { out, built, identity } = buildDist();
  t.after(() => removeScratch(out));
  const artifact = namedArtifact(out, built.stdout);
  const swapped = path.join(out, `swapped-${path.basename(artifact)}`);
  fs.copyFileSync(artifact, swapped);
  fs.rmSync(artifact);
  rewriteMetadata(out, (meta) => {
    meta.artifact = path.basename(swapped);
  });
  assertNamedRefuse(() => treeSha256FromBuiltArtifact(out, built.stdout, identity), "locator_mismatch");
});

test("a metadata locator that escapes the output directory is a named refusal", (t) => {
  const { out, built, identity } = buildDist();
  t.after(() => removeScratch(out));
  const artifact = namedArtifact(out, built.stdout);
  const outsideDir = fs.mkdtempSync(path.join(scratchRoot(), "seal-locator-outside-"));
  t.after(() => removeScratch(outsideDir));
  const outside = path.join(outsideDir, path.basename(artifact));
  fs.copyFileSync(artifact, outside);
  const escaped = path.relative(out, outside);
  assert.match(escaped, /^\.\./);
  rewriteMetadata(out, (meta) => {
    meta.artifact = escaped;
  });
  assertNamedRefuse(() => treeSha256FromBuiltArtifact(out, built.stdout, identity), "locator_escape");
});
