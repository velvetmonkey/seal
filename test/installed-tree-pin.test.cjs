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
const MARKER = "\n// --SEAL-PAYLOAD--\n";

function scratchRoot() {
  return process.env.RUNNER_TEMP || os.tmpdir();
}

function surroundingBlock(text, index) {
  const fenceOpen = text.lastIndexOf("```", index);
  if (fenceOpen === -1) {
    const start = Math.max(0, index - 800);
    const end = Math.min(text.length, index + 200);
    return text.slice(start, end);
  }
  const fenceClose = text.indexOf("```", index);
  const enclosingEnd = fenceClose === -1 ? text.length : fenceClose;
  const enclosing = text.slice(fenceOpen, enclosingEnd);
  const prevClose = fenceOpen > 0 ? text.lastIndexOf("```", fenceOpen - 1) : -1;
  let previous = "";
  let betweenStart = Math.max(0, fenceOpen - 800);
  if (prevClose !== -1) {
    const prevOpen = text.lastIndexOf("```", prevClose - 1);
    if (prevOpen !== -1 && prevOpen < prevClose) {
      previous = text.slice(prevOpen, prevClose);
      betweenStart = prevClose;
    }
  }
  const between = text.slice(betweenStart, fenceOpen);
  return `${previous}\n${between}\n${enclosing}`;
}

function describesPublishedAssetInstall(region) {
  if (/releases\/download\//.test(region)) return true;
  const installed = region.match(/^installed seal (\S+) linux-x64$/m);
  if (installed && !installed[1].includes("-dev.")) return true;
  if (/\bSHA256SUMS\b/.test(region) && /--sha256/.test(region) && /--bytes/.test(region)) return true;
  return false;
}

function hashRole(text, index) {
  return describesPublishedAssetInstall(surroundingBlock(text, index))
    ? "published-asset"
    : "fresh-build";
}

function quotedTreeHashHits(text) {
  return [...text.matchAll(TREE), ...text.matchAll(STORE)].map((match) => ({
    hash: match[1],
    index: match.index,
    role: hashRole(text, match.index),
  }));
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
    raw = fs.readFileSync(metaPath, "utf8");
  } catch (error) {
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

test("a published-asset install block is classified from surrounding commands, not the hash shape", () => {
  const publishedShape = "a".repeat(64);
  const text = [
    "```bash",
    "$ SEAL_VERSION=v0.2.0-rc.2",
    "$ curl -fsSLO \"https://github.com/velvetmonkey/seal/releases/download/$SEAL_VERSION/SHA256SUMS\"",
    "$ ./\"./seal-v0.2.0-rc.2-linux-x64\" --sha256 \"$expected_digest\" --bytes \"$expected_bytes\" --prefix ~/.local",
    "```",
    "",
    "```output",
    "installed seal 0.2.0-rc.2 linux-x64",
    `store: /home/x/.local/lib/seal/store/${publishedShape}`,
    `tree: ${publishedShape}`,
    "```",
  ].join("\n");
  const hits = quotedTreeHashHits(text);
  assert.equal(hits.length, 2);
  for (const hit of hits) assert.equal(hit.role, "published-asset");
});

test("a demo store path is a fresh-build hash even when it shares the store-hash shape", () => {
  const freshShape = "b".repeat(64);
  const text = [
    "```text",
    `  node "/tmp/.local/lib/seal/store/${freshShape}/checker/seal-receipt-check.mjs" receipt.json`,
    "```",
  ].join("\n");
  const hits = quotedTreeHashHits(text);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].role, "fresh-build");
});

test("quoted installed-tree hashes match a freshly built artifact", (t) => {
  const { out, built } = buildDist();
  t.after(() => removeScratch(out));

  const freshExpected = treeSha256FromBuiltArtifact(out, built.stdout);
  assert.match(freshExpected, /^[0-9a-f]{64}$/);
  const publishedExpected = publishedTreeSha256FromRelease();
  assert.match(publishedExpected, /^[0-9a-f]{64}$/);

  let quoted = 0;
  let quotedPublished = 0;
  let quotedFresh = 0;
  for (const relative of trackedFiles()) {
    const hits = quotedTreeHashHits(fs.readFileSync(path.join(ROOT, relative), "utf8"));
    for (const hit of hits) {
      quoted += 1;
      const expected = hit.role === "published-asset" ? publishedExpected : freshExpected;
      if (hit.role === "published-asset") quotedPublished += 1;
      else quotedFresh += 1;
      assert.equal(
        hit.hash,
        expected,
        `${relative} ${hit.role} installed-tree hash mismatch: quoted ${hit.hash}, ${hit.role} ${expected}`,
      );
    }
  }
  assert.ok(quoted > 0, "the repository must quote at least one installed-tree hash");
  assert.ok(quotedPublished > 0, "the repository must quote at least one published-asset installed-tree hash");
  assert.ok(quotedFresh > 0, "the repository must quote at least one fresh-build installed-tree hash");
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

test("a missing metadata locator is a named refusal", (t) => {
  const { out, built } = buildDist();
  t.after(() => removeScratch(out));
  rewriteMetadata(out, (meta) => {
    delete meta.artifact;
  });
  assertNamedRefuse(() => treeSha256FromBuiltArtifact(out, built.stdout), "locator_absent");
});

test("an unreadable metadata file is a named refusal", (t) => {
  const { out, built } = buildDist();
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
  assertNamedRefuse(() => treeSha256FromBuiltArtifact(out, built.stdout), "meta_unreadable");
});

test("a metadata locator that names a different file in the output directory is a named refusal", (t) => {
  const { out, built } = buildDist();
  t.after(() => removeScratch(out));
  const artifact = namedArtifact(out, built.stdout);
  const swapped = path.join(out, `swapped-${path.basename(artifact)}`);
  fs.copyFileSync(artifact, swapped);
  fs.rmSync(artifact);
  rewriteMetadata(out, (meta) => {
    meta.artifact = path.basename(swapped);
  });
  assertNamedRefuse(() => treeSha256FromBuiltArtifact(out, built.stdout), "locator_mismatch");
});

test("a metadata locator that escapes the output directory is a named refusal", (t) => {
  const { out, built } = buildDist();
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
  assertNamedRefuse(() => treeSha256FromBuiltArtifact(out, built.stdout), "locator_escape");
});
