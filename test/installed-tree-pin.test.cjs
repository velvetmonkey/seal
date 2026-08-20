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
const {
  buildDist,
  namedArtifact,
  quotedTreeHashHits,
  removeScratch,
  trackedFiles,
  treeSha256FromBuiltArtifact,
} = require("../scripts/installed-tree-pin.cjs");

const ROOT = path.join(__dirname, "..");
const PAYLOAD_MARKER = Buffer.from("\n// --SEAL-PAYLOAD--\n", "utf8");
const PAYLOAD_MAGIC = "SEALPAY1\n";
const PAYLOAD_DATA = "--DATA--\n";

function scratchRoot() {
  return process.env.RUNNER_TEMP || os.tmpdir();
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

// This is intentionally an external tree-hash route.
// It reads the artifact payload format directly and delegates every SHA-256
// operation to sha256sum; it does not import integrity.cjs or a hash helper
// from the generator's installed-tree-pin module.
function sha256sum(bytes) {
  const result = spawnSync("sha256sum", [], { input: bytes, encoding: "utf8" });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const match = result.stdout.match(/^([0-9a-f]{64})\s/);
  assert.ok(match, `sha256sum produced an unrecognised result: ${result.stdout}`);
  return match[1];
}

function externalExtractPayloadFiles(artifactBytes) {
  const markerAt = artifactBytes.indexOf(PAYLOAD_MARKER);
  assert.notEqual(markerAt, -1, "built artifact carries no payload");
  const payload = artifactBytes.subarray(markerAt + PAYLOAD_MARKER.length);
  const dataAt = payload.indexOf(Buffer.from(PAYLOAD_DATA, "utf8"), PAYLOAD_MAGIC.length);
  assert.ok(dataAt >= 0, "payload is missing the data marker");
  const header = payload.subarray(PAYLOAD_MAGIC.length, dataAt).toString("utf8").trim();
  assert.ok(payload.subarray(0, PAYLOAD_MAGIC.length).equals(Buffer.from(PAYLOAD_MAGIC, "utf8")), "payload has an unknown format");
  const manifest = JSON.parse(header);
  assert.ok(Array.isArray(manifest.files), "payload manifest has no files list");
  let offset = dataAt + Buffer.byteLength(PAYLOAD_DATA);
  const files = manifest.files.map((file) => {
    assert.equal(typeof file.path, "string", "payload file has no path");
    assert.equal(Number.isSafeInteger(file.bytes), true, `payload file ${file.path} has an invalid byte count`);
    const end = offset + file.bytes;
    assert.ok(end <= payload.length, `payload ends before ${file.path}`);
    const data = payload.subarray(offset, end);
    offset = end;
    return { path: file.path, bytes: data.length, sha256: sha256sum(data) };
  });
  assert.equal(offset, payload.length, "payload has trailing bytes");
  return files;
}

function externalTreeSha256FromArtifact(artifactPath) {
  const files = externalExtractPayloadFiles(fs.readFileSync(artifactPath));
  const lines = files
    .map((file) => `${file.sha256}  ${file.bytes}  ${file.path}\n`)
    .join("");
  const sorted = spawnSync("sort", ["-k3,3"], {
    input: lines,
    encoding: "utf8",
    env: { ...process.env, LC_ALL: "C" },
  });
  assert.equal(sorted.status, 0, sorted.stdout + sorted.stderr);
  return sha256sum(Buffer.from(sorted.stdout, "utf8"));
}

function externalPublishedTreeSha256() {
  const version = fs.readFileSync(path.join(ROOT, "README.md"), "utf8").match(/^(?:\$ )?SEAL_VERSION=(v[0-9.]+(?:-[0-9A-Za-z.-]+)?)$/m);
  assert.ok(version, "README.md has no release version command");
  const name = `seal-${version[1]}-linux-x64`;
  const scratch = fs.mkdtempSync(path.join(scratchRoot(), "seal-external-published-tree-"));
  try {
    const artifact = path.join(scratch, name);
    const download = spawnSync("curl", ["-fsSL", "--max-time", "30", "-o", artifact, `https://github.com/velvetmonkey/seal/releases/download/${version[1]}/${name}`], { encoding: "utf8" });
    assert.equal(download.status, 0, download.stdout + download.stderr);
    return externalTreeSha256FromArtifact(artifact);
  } finally {
    removeScratch(scratch);
  }
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

test("quoted installed-tree hashes match a freshly built artifact", (t) => {
  const { out, built, identity } = buildDist();
  t.after(() => removeScratch(out));

  const freshExpected = externalTreeSha256FromArtifact(namedArtifact(out, built.stdout));
  assert.match(freshExpected, /^[0-9a-f]{64}$/);
  const publishedExpected = externalPublishedTreeSha256();
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
