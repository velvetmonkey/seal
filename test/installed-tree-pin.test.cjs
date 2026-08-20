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
let REGION_BOUNDARY;
let INSTALLED_TREE_PIN_FILES;
let FENCE_LINE;
let STORE_PATHS_CASE_SENSITIVE;
let formatInstalledTreeRefusal;
let listInstalledTreePinFiles;
let listMarkdownFenceSpans;
let classifyHashToken;
let scanInstalledTreeRegions;
let scanInstalledTreePinFiles;
try {
  ({
    REGION_BOUNDARY,
    INSTALLED_TREE_PIN_FILES,
    FENCE_LINE,
    STORE_PATHS_CASE_SENSITIVE,
    formatInstalledTreeRefusal,
    listInstalledTreePinFiles,
    listMarkdownFenceSpans,
    classifyHashToken,
    scanInstalledTreeRegions,
    scanInstalledTreePinFiles,
  } = require("../scripts/installed-tree-pin-regions.cjs"));
} catch (error) {
  if (error && error.code === "MODULE_NOT_FOUND") {
    process.stderr.write(
      "REFUSE shared_module_missing: cannot load scripts/installed-tree-pin-regions.cjs\n",
    );
    process.exit(1);
  }
  throw error;
}
const {
  LISTED_PIN_FILES,
  detectUnlistedPinSuspects,
  watchUnlistedInstalledTreePinFiles,
} = require("../scripts/installed-tree-pin-watchdog.cjs");

const ROOT = path.join(__dirname, "..");
const BUILD = path.join(ROOT, "scripts", "build-dist.cjs");
const MARKER = "\n// --SEAL-PAYLOAD--\n";

function scratchRoot() {
  return process.env.RUNNER_TEMP || os.tmpdir();
}

function quotedTreeHashHits(text, file = "<memory>") {
  const scanned = scanInstalledTreeRegions(text, file);
  if (scanned.issues.length > 0) {
    assert.fail(scanned.issues.map(formatInstalledTreeRefusal).join("\n"));
  }
  return scanned.hits;
}

function docsFenceSpans(source) {
  const lines = source.split(/\r?\n/);
  let fence = null;
  const spans = [];
  lines.forEach((line, index) => {
    const match = line.match(/^( {0,3})(`{3,}|~{3,})(.*)$/);
    if (!match) return;
    const [, , marker, info] = match;
    if (!fence) {
      fence = { marker: marker[0], length: marker.length, line: index };
      return;
    }
    if (marker[0] === fence.marker && marker.length >= fence.length && !info.trim()) {
      spans.push({ open: fence.line, close: index });
      fence = null;
    }
  });
  if (fence) spans.push({ open: fence.line, close: null });
  return spans;
}

function trackedFiles() {
  const listed = spawnSync("git", ["-C", ROOT, "ls-files"], { encoding: "utf8" });
  assert.equal(listed.status, 0, listed.stdout + listed.stderr);
  return listed.stdout.trim().split("\n").filter(Boolean);
}

function stackedMarkers(betweenLines = [], upperSuffix = "") {
  return [
    `**Seal installed-tree pin role:** \`published-asset\`${upperSuffix}`,
    ...betweenLines,
    "**Seal installed-tree pin role:** `fresh-build`",
    "```output",
    `tree: ${"e".repeat(64)}`,
    "```",
  ].join("\n");
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

function publishedTreeSha256FromRelease(tagOverride = null) {
  let tag = tagOverride;
  if (tag === null) {
    const readme = fs.readFileSync(path.join(ROOT, "README.md"), "utf8");
    const match = readme.match(/^\$ SEAL_VERSION=(v[0-9.]+(?:-[0-9A-Za-z.-]+)?)$/m);
    if (!match) {
      refuse("published_tag_absent", "README.md has no release version command");
    }
    tag = match[1];
  }
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

const silenceProbe = process.env.SEAL_INSTALLED_TREE_PIN_SILENCE_PROBE;
if (silenceProbe) {
  test(`silence probe: ${silenceProbe}`, (t) => {
    if (silenceProbe === "release_unreachable") {
      publishedTreeSha256FromRelease("v999999.0.0-pinconflict-unreachable");
      return;
    }

    const { out, built, identity } = buildDist();
    t.after(() => removeScratch(out));
    const artifact = namedArtifact(out, built.stdout);
    if (silenceProbe === "artifact_missing") {
      fs.rmSync(artifact);
    } else if (silenceProbe === "artifact_empty") {
      fs.rmSync(artifact);
      fs.writeFileSync(artifact, Buffer.alloc(0), { mode: 0o555 });
    } else if (silenceProbe === "artifact_unreadable") {
      fs.chmodSync(artifact, 0);
    } else if (silenceProbe === "locator_absent") {
      rewriteMetadata(out, (meta) => {
        delete meta.artifact;
      });
    } else if (silenceProbe === "meta_unreadable") {
      const metaName = fs.readdirSync(out).find((name) => name.endsWith(".meta.json"));
      assert.ok(metaName, "build did not write metadata");
      fs.chmodSync(path.join(out, metaName), 0);
    } else {
      assert.fail(`unknown silence probe ${JSON.stringify(silenceProbe)}`);
    }
    treeSha256FromBuiltArtifact(out, built.stdout, identity);
  });
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
      "**Seal installed-tree pin role:** `published-asset`",
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
    "**Seal installed-tree pin role:** `fresh-build`",
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
    /unmarked\.md:2.*Seal installed-tree pin role:.*published-asset.*Seal installed-tree pin role:.*fresh-build/,
  );
});

test("an unrecognised store-hash role is a named refusal", () => {
  const text = [
    "**Seal installed-tree pin role:** `release-cache`",
    "```output",
    `tree: ${"d".repeat(64)}`,
    "```",
  ].join("\n");
  assertNamedRefuse(() => quotedTreeHashHits(text, "unknown.md"), "role_marker_unknown");
  assert.throws(() => quotedTreeHashHits(text, "unknown.md"), /unknown\.md:1 unknown store-hash role "release-cache"/);
});

test("conflicting role markers refuse regardless of order or count", () => {
  const cases = [
    ["published-asset", "fresh-build"],
    ["fresh-build", "published-asset"],
    ["published-asset", "fresh-build", "published-asset"],
  ];
  for (const roles of cases) {
    const text = [
      ...roles.map((role) => `**Seal installed-tree pin role:** \`${role}\``),
      "```output",
      `tree: ${"e".repeat(64)}`,
      "```",
    ].join("\n");
    assertNamedRefuse(() => quotedTreeHashHits(text, "conflict.md"), "role_marker_conflict");
  }
});

test("conflicting role markers refuse when separated inside the declaration region", () => {
  assert.equal(REGION_BOUNDARY, "previous-fence-or-start-of-file");
  const cases = [
    stackedMarkers(["<!-- spacer -->"]),
    stackedMarkers([""]),
    stackedMarkers([], "   "),
    stackedMarkers([
      "",
      "This paragraph is ordinary prose in the same declaration region as both markers.",
      "A blocklist of spacers would miss it; the region scan must not.",
      "",
    ]),
    stackedMarkers(["  "], "\t"),
    [
      "  **Seal installed-tree pin role:** `published-asset`",
      "**Seal installed-tree pin role:** `fresh-build`",
      "```output",
      `tree: ${"e".repeat(64)}`,
      "```",
    ].join("\n"),
  ];
  for (const text of cases) {
    assertNamedRefuse(() => quotedTreeHashHits(text, "conflict.md"), "role_marker_conflict");
  }
});

test("a role marker on the far side of the previous fence is not this fence's declaration", () => {
  const published = "a".repeat(64);
  const text = [
    "**Seal installed-tree pin role:** `fresh-build`",
    "```bash",
    "$ echo hi",
    "```",
    "",
    "**Seal installed-tree pin role:** `published-asset`",
    "```output",
    `store: /store/${published}`,
    "```",
  ].join("\n");
  const hits = quotedTreeHashHits(text, "boundary.md");
  assert.equal(hits.length, 1);
  assert.equal(hits[0].role, "published-asset");
  assert.equal(hits[0].hash, published);
});

test("an indented single role marker is a marker, not an absence", () => {
  const published = "a".repeat(64);
  const text = [
    "  **Seal installed-tree pin role:** `published-asset`",
    "```output",
    `store: /store/${published}`,
    "```",
  ].join("\n");
  const hits = quotedTreeHashHits(text, "indented.md");
  assert.equal(hits.length, 1);
  assert.equal(hits[0].role, "published-asset");
});

test("tree colon without following whitespace is a named refusal", () => {
  const text = [
    "**Seal installed-tree pin role:** `fresh-build`",
    "```output",
    `tree:${"e".repeat(64)}`,
    "```",
  ].join("\n");
  assertNamedRefuse(() => quotedTreeHashHits(text, "nospace.md"), "tree_hash_spacing");
});

test("an uppercase store hash is classified, not invisible", () => {
  assert.equal(STORE_PATHS_CASE_SENSITIVE, process.platform === "linux");
  const upper = "E".repeat(64);
  const text = [
    "**Seal installed-tree pin role:** `published-asset`",
    "```output",
    `store: /store/${upper}`,
    "```",
  ].join("\n");
  const scanned = scanInstalledTreeRegions(text, "upper.md");
  const storeHits = scanned.hits.filter((hit) => hit.hash === "e".repeat(64));
  assert.equal(storeHits.length, 1, "uppercase hex must be a classified store-hash hit");
  assert.equal(storeHits[0].spelling, upper);
  assert.equal(storeHits[0].role, "published-asset");
  assert.ok(
    scanned.issues.some((issue) => issue.code === "store_hash_case"),
    scanned.issues.map(formatInstalledTreeRefusal).join("\n"),
  );
});

test("conflicting role markers refuse when the region's hash is uppercase", () => {
  const text = stackedMarkers(["<!-- spacer -->"]).replace(/e{64}/, "E".repeat(64));
  assertNamedRefuse(() => quotedTreeHashHits(text, "conflict-upper.md"), "role_marker_conflict");
});

test("a four-backtick outer fence agrees with the repository Markdown fence parser", () => {
  const hash = "a".repeat(64);
  const text = [
    "**Seal installed-tree pin role:** `fresh-build`",
    "````output",
    "inner triple-backtick example:",
    "```",
    `store: /store/${hash}`,
    "```",
    "````",
  ].join("\n");
  const scanned = scanInstalledTreeRegions(text, "four-backtick.md");
  const docsSpans = docsFenceSpans(text);
  const pinSpans = listMarkdownFenceSpans(text);
  assert.deepEqual(
    pinSpans.map((span) => [span.openIndex, span.closeIndex]),
    docsSpans.map((span) => [span.open, span.close]),
  );
  assert.equal(scanned.regions.length, 1);
  assert.equal(scanned.hits.length, 1);
  assert.equal(scanned.hits[0].role, "fresh-build");
  assert.equal(scanned.hits[0].hash, hash);
  assert.equal(scanned.issues.length, 0);
});

test("a tilde fence agrees with the repository Markdown fence parser", () => {
  const hash = "b".repeat(64);
  const text = [
    "**Seal installed-tree pin role:** `published-asset`",
    "~~~output",
    `store: /store/${hash}`,
    "~~~",
  ].join("\n");
  const scanned = scanInstalledTreeRegions(text, "tilde.md");
  const docsSpans = docsFenceSpans(text);
  const pinSpans = listMarkdownFenceSpans(text);
  assert.deepEqual(
    pinSpans.map((span) => [span.openIndex, span.closeIndex]),
    docsSpans.map((span) => [span.open, span.close]),
  );
  assert.equal(scanned.regions.length, 1);
  assert.equal(scanned.hits.length, 1);
  assert.equal(scanned.hits[0].role, "published-asset");
  assert.equal(scanned.issues.length, 0);
});

test("an orphan role marker with no fence after it is a named refusal", () => {
  const text = "**Seal installed-tree pin role:** `fresh-build`\n";
  assertNamedRefuse(() => quotedTreeHashHits(text, "orphan.md"), "role_marker_orphan");
});

test("a hash-shaped string the recogniser cannot classify is a named refusal", () => {
  const text = [
    "**Seal installed-tree pin role:** `fresh-build`",
    "```output",
    `store: /store/0x${"c".repeat(64)}`,
    "```",
  ].join("\n");
  assertNamedRefuse(() => quotedTreeHashHits(text, "unclassified.md"), "unclassified_hash_shape");
  const classified = classifyHashToken(`0x${"c".repeat(64)}`);
  assert.equal(classified.hashShaped, true);
  assert.equal(classified.classified, null);
});

test("the pin fence regex is identical to the docs Markdown fence parser", () => {
  const docsSource = fs.readFileSync(path.join(ROOT, "docs", "check-fenced-languages.mjs"), "utf8");
  const regionsSource = fs.readFileSync(path.join(ROOT, "scripts", "installed-tree-pin-regions.cjs"), "utf8");
  const fenceLiteral = "/^( {0,3})(`{3,}|~{3,})(.*)$/";
  assert.equal(FENCE_LINE.toString(), fenceLiteral);
  assert.ok(docsSource.includes(fenceLiteral), "docs guard lost the CommonMark fence regex");
  assert.ok(regionsSource.includes(fenceLiteral), "pin scanner lost the CommonMark fence regex");
});

function markedBlockBytes(text, role) {
  const marker = `**Seal installed-tree pin role:** \`${role}\``;
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

function copyForRepin(prefix) {
  const copy = fs.mkdtempSync(path.join(scratchRoot(), prefix));
  fs.cpSync(ROOT, copy, {
    recursive: true,
    filter(source) {
      return source !== path.join(ROOT, ".git") && !source.startsWith(path.join(ROOT, "dist"));
    },
  });
  return copy;
}

function repinTrackedSnapshot(copy) {
  return new Map(
    [...listInstalledTreePinFiles(), "SHA256SUMS"].map((relative) => [
      relative,
      fs.readFileSync(path.join(copy, relative)),
    ]),
  );
}

function assertRepinSnapshotUnchanged(copy, before) {
  for (const [relative, bytes] of before) {
    assert.deepEqual(fs.readFileSync(path.join(copy, relative)), bytes, `${relative} changed`);
  }
  assert.equal(fs.existsSync(path.join(copy, "dist")), false, "repin built dist before structural refusal");
}

function runRepinConflict(copy, relative, original, replacement) {
  const target = path.join(copy, relative);
  fs.writeFileSync(target, original.replace(
    "**Seal installed-tree pin role:** `published-asset`",
    replacement,
  ));
  const before = repinTrackedSnapshot(copy);
  const repin = spawnSync(process.execPath, [path.join(copy, "scripts", "repin-dist.cjs")], {
    cwd: copy,
    encoding: "utf8",
  });
  assert.equal(repin.status, 1, repin.stdout + repin.stderr);
  assert.match(
    repin.stderr,
    new RegExp(`REFUSE role_marker_conflict: ${relative.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}:\\d+ conflicting installed-tree role markers`),
  );
  assertRepinSnapshotUnchanged(copy, before);
  return repin;
}

test("repin refuses conflicting role markers before touching files regardless of order or count", () => {
  const cases = [
    ["published-asset", "fresh-build"],
    ["fresh-build", "published-asset"],
    ["published-asset", "fresh-build", "published-asset"],
  ];
  for (const roles of cases) {
    const copy = copyForRepin("seal-repin-conflict-");
    const readmePath = path.join(copy, "README.md");
    const savedReadme = fs.readFileSync(readmePath);
    try {
      const marker = "**Seal installed-tree pin role:** `published-asset`";
      const stack = roles.map((role) => `**Seal installed-tree pin role:** \`${role}\``).join("\n");
      const original = savedReadme.toString("utf8");
      assert.equal(original.split(marker).length - 1, 1, "README published marker count changed");
      runRepinConflict(copy, "README.md", original, stack);
    } finally {
      fs.writeFileSync(readmePath, savedReadme);
      removeScratch(copy);
    }
  }
});

test("repin refuses role markers separated inside the declaration region before touching files", () => {
  const replacements = [
    "**Seal installed-tree pin role:** `published-asset`\n<!-- spacer -->\n**Seal installed-tree pin role:** `fresh-build`",
    "**Seal installed-tree pin role:** `published-asset`\n\n**Seal installed-tree pin role:** `fresh-build`",
    "**Seal installed-tree pin role:** `published-asset`   \n**Seal installed-tree pin role:** `fresh-build`",
    [
      "**Seal installed-tree pin role:** `published-asset`",
      "",
      "This paragraph is ordinary prose in the same declaration region as both markers.",
      "A blocklist of spacers would miss it; the region scan must not.",
      "",
      "**Seal installed-tree pin role:** `fresh-build`",
    ].join("\n"),
  ];
  for (const replacement of replacements) {
    const copy = copyForRepin("seal-repin-region-");
    const readmePath = path.join(copy, "README.md");
    const savedReadme = fs.readFileSync(readmePath);
    try {
      runRepinConflict(copy, "README.md", savedReadme.toString("utf8"), replacement);
    } finally {
      fs.writeFileSync(readmePath, savedReadme);
      removeScratch(copy);
    }
  }
});

test("repin refuses a conflict in COMPREHENSION-CHECK.md, which both consumers read from one file set", () => {
  assert.deepEqual(
    [...listInstalledTreePinFiles()],
    ["README.md", "docs/guide/README.md", "docs/COMPREHENSION-CHECK.md"],
  );
  assert.ok(
    INSTALLED_TREE_PIN_FILES.includes("docs/COMPREHENSION-CHECK.md"),
    "the I3 file must be in the shared file set even when it currently quotes no store hash",
  );
  const copy = copyForRepin("seal-repin-fileset-");
  const target = path.join(copy, "docs/COMPREHENSION-CHECK.md");
  const saved = fs.readFileSync(target);
  try {
    const planted = [
      saved.toString("utf8").replace(/\s*$/, ""),
      "",
      "**Seal installed-tree pin role:** `published-asset`",
      "<!-- spacer -->",
      "**Seal installed-tree pin role:** `fresh-build`",
      "```output",
      `store: /store/${"e".repeat(64)}`,
      "```",
      "",
    ].join("\n");
    fs.writeFileSync(target, planted);
    const before = repinTrackedSnapshot(copy);
    const repin = spawnSync(process.execPath, [path.join(copy, "scripts", "repin-dist.cjs")], {
      cwd: copy,
      encoding: "utf8",
    });
    assert.equal(repin.status, 1, repin.stdout + repin.stderr);
    assert.match(
      repin.stderr,
      /REFUSE role_marker_conflict: docs\/COMPREHENSION-CHECK\.md:\d+ conflicting installed-tree role markers/,
    );
    assertRepinSnapshotUnchanged(copy, before);
    assertNamedRefuse(
      () => quotedTreeHashHits(planted, "docs/COMPREHENSION-CHECK.md"),
      "role_marker_conflict",
    );
  } finally {
    fs.writeFileSync(target, saved);
    removeScratch(copy);
  }
});

test("repin does not treat markers on opposite sides of the previous fence as a conflict", () => {
  const copy = copyForRepin("seal-repin-boundary-");
  const readmePath = path.join(copy, "README.md");
  const savedReadme = fs.readFileSync(readmePath);
  try {
    const original = savedReadme.toString("utf8");
    const fence = "```bash\n$ SEAL_VERSION=v0.2.0-rc.2\n";
    assert.ok(original.includes(fence), "README install bash fence not found");
    const tampered = original.replace(
      fence,
      "**Seal installed-tree pin role:** `fresh-build`\n" + fence,
    );
    assert.notEqual(tampered, original);
    fs.writeFileSync(readmePath, tampered);
    const beforePublished = markedBlockBytes(tampered, "published-asset");
    const repin = spawnSync(process.execPath, [path.join(copy, "scripts", "repin-dist.cjs")], {
      cwd: copy,
      encoding: "utf8",
    });
    assert.equal(repin.status, 1, repin.stdout + repin.stderr);
    assert.match(repin.stderr, /REFUSE published_asset_pin: README\.md:\d+ role published-asset/);
    assert.doesNotMatch(repin.stderr, /role_marker_conflict/);
    const afterPublished = markedBlockBytes(fs.readFileSync(readmePath, "utf8"), "published-asset");
    assert.deepEqual(afterPublished, beforePublished, "README published-asset blocks changed");
  } finally {
    fs.writeFileSync(readmePath, savedReadme);
    removeScratch(copy);
  }
});

test("repin refuses tree colon without whitespace before touching files", () => {
  const copy = copyForRepin("seal-repin-nospace-");
  const readmePath = path.join(copy, "README.md");
  const savedReadme = fs.readFileSync(readmePath);
  try {
    const original = savedReadme.toString("utf8");
    const tampered = original.replace(/^(tree:) ([0-9a-f]{64})$/m, "$1$2");
    assert.notEqual(tampered, original, "README carried no tree: HASH line to tamper");
    fs.writeFileSync(readmePath, tampered);
    const before = repinTrackedSnapshot(copy);
    const repin = spawnSync(process.execPath, [path.join(copy, "scripts", "repin-dist.cjs")], {
      cwd: copy,
      encoding: "utf8",
    });
    assert.equal(repin.status, 1, repin.stdout + repin.stderr);
    assert.match(repin.stderr, /REFUSE tree_hash_spacing: README\.md:\d+ tree hash must contain whitespace/);
    assertRepinSnapshotUnchanged(copy, before);
  } finally {
    fs.writeFileSync(readmePath, savedReadme);
    removeScratch(copy);
  }
});

test("repin refuses published-asset blocks by name and changes only marked fresh-build hashes", (t) => {
  const copy = copyForRepin("seal-repin-role-");
  t.after(() => removeScratch(copy));

  const files = ["README.md", "docs/guide/README.md"];
  const before = new Map();
  for (const relative of files) {
    const target = path.join(copy, relative);
    let text = fs.readFileSync(target, "utf8");
    if (relative === "README.md") {
      text = text.replace(
        /(\*\*Seal installed-tree pin role:\*\* `fresh-build`[\s\S]*?\/store\/)[0-9a-f]{64}/,
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

test("the pin and repin share one region scanner and one file list", () => {
  const pinSource = fs.readFileSync(__filename, "utf8");
  const repinSource = fs.readFileSync(path.join(ROOT, "scripts", "repin-dist.cjs"), "utf8");
  const regionsSource = fs.readFileSync(path.join(ROOT, "scripts", "installed-tree-pin-regions.cjs"), "utf8");
  assert.match(pinSource, /scanInstalledTreePinFiles/);
  assert.match(repinSource, /scanInstalledTreePinFiles/);
  assert.match(pinSource, /scanInstalledTreeRegions/);
  assert.doesNotMatch(repinSource, /ROLE_MARKER/);
  assert.doesNotMatch(repinSource, /function fencedRegions/);
  assert.doesNotMatch(repinSource, /function scanInstalledTreeRegions/);
  assert.match(regionsSource, /REGION BOUNDARY: previous fence, else start of file/);
  assert.equal(REGION_BOUNDARY, "previous-fence-or-start-of-file");
});

test("a tracked file with an installed-tree hash cannot sit outside the shared file set", () => {
  const shared = new Set(listInstalledTreePinFiles());
  assert.ok(shared.has("docs/COMPREHENSION-CHECK.md"));
  assert.deepEqual([...LISTED_PIN_FILES], [...listInstalledTreePinFiles()]);
  const watchdogSource = fs.readFileSync(
    path.join(ROOT, "scripts", "installed-tree-pin-watchdog.cjs"),
    "utf8",
  );
  assert.doesNotMatch(watchdogSource, /scanInstalledTreeRegions/);
  assert.doesNotMatch(watchdogSource, /scanInstalledTreePinFiles/);
  assert.doesNotMatch(watchdogSource, /installed-tree-pin-regions/);
  const watched = watchUnlistedInstalledTreePinFiles(ROOT, trackedFiles());
  assert.deepEqual(
    watched.strays,
    [],
    watched.strays.map((stray) => `${stray.file} ${stray.reasons.join(",")}`).join("\n"),
  );
  const strays = [];
  for (const relative of trackedFiles()) {
    if (shared.has(relative)) continue;
    const scanned = scanInstalledTreeRegions(fs.readFileSync(path.join(ROOT, relative), "utf8"), relative);
    if (scanned.hits.length > 0 || scanned.issues.length > 0) {
      strays.push(`${relative} hits=${scanned.hits.length} issues=${scanned.issues.map((issue) => issue.code).join(",")}`);
    }
  }
  assert.deepEqual(strays, []);
});

test("the file-set watchdog reports a hash-shaped pin the scanner does not classify", () => {
  const hash = `0x${"d".repeat(64)}`;
  const text = [
    "**Seal installed-tree pin role:** `published-asset`",
    "```output",
    `store: /probe/.local/lib/seal/store/${hash}`,
    "```",
  ].join("\n");
  const scanned = scanInstalledTreeRegions(text, "docs/WATCHDOG-PROBE.md");
  assert.equal(scanned.hits.length, 0);
  assert.ok(scanned.issues.some((issue) => issue.code === "unclassified_hash_shape"));
  const reasons = detectUnlistedPinSuspects(text);
  assert.ok(reasons.includes("role_marker"), reasons.join(","));
  assert.ok(reasons.some((reason) => reason.startsWith("store_path:")), reasons.join(","));
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
  const scannedFiles = scanInstalledTreePinFiles(ROOT);
  assert.deepEqual(
    scannedFiles.map((entry) => entry.file),
    [...listInstalledTreePinFiles()],
  );
  for (const entry of scannedFiles) {
    if (entry.scanned.issues.length > 0) {
      assert.fail(entry.scanned.issues.map(formatInstalledTreeRefusal).join("\n"));
    }
    const hits = entry.scanned.hits;
    for (const hit of hits) {
      quoted += 1;
      const expected = hit.role === "published-asset" ? publishedExpected : freshExpected;
      if (hit.role === "published-asset") quotedPublished += 1;
      else quotedFresh += 1;
      assert.equal(
        hit.hash,
        expected,
        `${entry.file}:${hit.line} ${hit.role} installed-tree hash mismatch: ` +
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
