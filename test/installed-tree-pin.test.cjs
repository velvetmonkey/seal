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
  removeScratch,
  treeSha256FromBuiltArtifact,
} = require("../scripts/installed-tree-pin.cjs");

const ROOT = path.join(__dirname, "..");
const PAYLOAD_MARKER = Buffer.from("\n// --SEAL-PAYLOAD--\n", "utf8");
const PAYLOAD_MAGIC = "SEALPAY1\n";
const PAYLOAD_DATA = "--DATA--\n";
const SITE_MANIFEST = path.join(ROOT, "scripts", "installed-tree-pin-sites.json");
const PIN_PATTERN = /\btree:?\s+([0-9a-f]{64})\b|\/store\/([0-9a-f]{64})(?=\/|\b)/g;

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
  if (result.error && result.error.code === "ENOENT") {
    assert.fail("REFUSE sha256sum_unavailable: sha256sum is required for the external installed-tree gate");
  }
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const match = result.stdout.match(/^([0-9a-f]{64})\s/);
  assert.ok(match, `sha256sum produced an unrecognised result: ${result.stdout}`);
  return match[1];
}

function siteKey(site) {
  return `${site.file}:${site.line}:${site.column} ${site.kind} ${site.role}`;
}

function roleByLine(text, file) {
  const roles = new Map();
  const lines = text.split("\n");
  let openRole = null;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].replace(/\r$/, "");
    if (/^```/.test(line)) {
      if (openRole === null) {
        const markers = [];
        for (let markerIndex = index - 1; markerIndex >= 0; markerIndex -= 1) {
          const marker = lines[markerIndex].replace(/\r$/, "").match(/^(?:\*\*Seal installed-tree pin role:\*\* `([A-Za-z0-9][A-Za-z0-9-]*)`|<!-- Seal installed-tree pin role: ([A-Za-z0-9][A-Za-z0-9-]*) -->)$/);
          if (!marker) break;
          markers.unshift({ marker, line: markerIndex + 1 });
        }
        assert.ok(markers.length <= 1, `REFUSE role_marker_ambiguous: ${markers.map((entry) => `${file}:${entry.line}`).join(" and ")} precede fenced block at ${file}:${index + 1}`);
        const marker = markers[0]?.marker;
        openRole = marker ? (marker[1] ?? marker[2]) : "";
      } else {
        openRole = null;
      }
      continue;
    }
    if (openRole !== null) roles.set(index + 1, openRole);
  }
  return (line) => {
    const role = roles.get(line);
    assert.ok(role, `REFUSE pin_population_role_absent: ${file}:${line} pin has no installed-tree role marker`);
    assert.ok(
      role === "published-asset" || role === "fresh-build",
      `REFUSE pin_population_role_unknown: ${file}:${line} has unknown installed-tree role ${JSON.stringify(role)}`,
    );
    return role;
  };
}

function declaredPopulation() {
  const sites = JSON.parse(fs.readFileSync(SITE_MANIFEST, "utf8"));
  assert.ok(Array.isArray(sites) && sites.length > 0, "REFUSE pin_population_manifest_invalid: manifest must be a non-empty array");
  const keys = sites.map(siteKey);
  assert.equal(new Set(keys).size, keys.length, "REFUSE pin_population_manifest_invalid: manifest contains duplicate sites");
  return new Set(keys);
}

function externalPinPopulation() {
  const grep = spawnSync(
    "git",
    ["-C", ROOT, "grep", "-n", "-E", "tree:? +[0-9a-f]{64}|/store/[0-9a-f]{64}", "--"],
    { encoding: "utf8" },
  );
  assert.ok(grep.status === 0 || grep.status === 1, `REFUSE pin_population_enumeration_failed: ${grep.stderr || grep.stdout}`);
  const files = new Map();
  const discovered = new Map();
  for (const outputLine of grep.stdout.split("\n").filter(Boolean)) {
    const parsed = outputLine.match(/^([^:]+):(\d+):(.*)$/);
    assert.ok(parsed, `REFUSE pin_population_enumeration_failed: unrecognised git grep output ${outputLine}`);
    const file = parsed[1];
    const line = Number(parsed[2]);
    if (!files.has(file)) {
      const text = fs.readFileSync(path.join(ROOT, file), "utf8");
      files.set(file, { text, roleAt: roleByLine(text, file) });
    }
    for (const match of parsed[3].matchAll(PIN_PATTERN)) {
      const kind = match[1] ? "tree" : "store";
      const site = { file, line, column: match.index + 1, kind, role: files.get(file).roleAt(line) };
      const key = siteKey(site);
      assert.equal(discovered.has(key), false, `REFUSE pin_population_enumeration_failed: duplicate site ${key}`);
      discovered.set(key, { ...site, hash: match[1] || match[2] });
    }
  }
  const declared = declaredPopulation();
  for (const key of declared) {
    assert.ok(discovered.has(key), `REFUSE pin_population_mismatch: gate missing declared site ${key}`);
  }
  for (const key of discovered.keys()) {
    assert.ok(declared.has(key), `REFUSE pin_population_mismatch: gate found undeclared site ${key}`);
  }
  return [...discovered.values()];
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

function markedBlockBytes(text, role) {
  const markers = [
    `**Seal installed-tree pin role:** \`${role}\``,
    `<!-- Seal installed-tree pin role: ${role} -->`,
  ];
  const blocks = [];
  let from = 0;
  while (true) {
    const starts = markers.map((marker) => text.indexOf(marker, from)).filter((start) => start !== -1);
    const start = starts.length > 0 ? Math.min(...starts) : -1;
    if (start === -1) return blocks;
    const marker = markers.find((candidate) => text.startsWith(candidate, start));
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
        /(<!-- Seal installed-tree pin role: fresh-build -->[\s\S]*?\/store\/)[0-9a-f]{64}/,
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

test("repin refuses two role markers before one fence and names both markers", (t) => {
  const copy = fs.mkdtempSync(path.join(scratchRoot(), "seal-repin-ambiguous-role-"));
  t.after(() => removeScratch(copy));
  fs.cpSync(ROOT, copy, {
    recursive: true,
    filter(source) {
      return source !== path.join(ROOT, ".git") && !source.startsWith(path.join(ROOT, "dist"));
    },
  });
  const readme = path.join(copy, "README.md");
  const original = fs.readFileSync(readme, "utf8");
  const stale = "f".repeat(64);
  const attacked = original
    .replace(
      "<!-- Seal installed-tree pin role: published-asset -->\n```output",
      "<!-- Seal installed-tree pin role: published-asset -->\n<!-- Seal installed-tree pin role: fresh-build -->\n```output",
    )
    .replace(/(store: \/home\/monkey\/\.local\/lib\/seal\/store\/)[0-9a-f]{64}/, `$1${stale}`);
  fs.writeFileSync(readme, attacked);
  const repin = spawnSync(process.execPath, [path.join(copy, "scripts", "repin-dist.cjs")], {
    cwd: copy,
    encoding: "utf8",
  });
  assert.equal(repin.status, 1, repin.stdout + repin.stderr);
  assert.match(repin.stderr, /REFUSE role_marker_ambiguous: README\.md:52 and README\.md:53 precede fenced block at README\.md:54/);
  assert.match(fs.readFileSync(readme, "utf8"), new RegExp(stale));
});

test("repin rewrites a legitimate single-marker fresh-build block", (t) => {
  const copy = fs.mkdtempSync(path.join(scratchRoot(), "seal-repin-fresh-role-"));
  t.after(() => removeScratch(copy));
  fs.cpSync(ROOT, copy, {
    recursive: true,
    filter(source) {
      return source !== path.join(ROOT, ".git") && !source.startsWith(path.join(ROOT, "dist"));
    },
  });
  const readme = path.join(copy, "README.md");
  const stale = "f".repeat(64);
  fs.appendFileSync(readme, [
    "",
    "<!-- Seal installed-tree pin role: fresh-build -->",
    "```output",
    `store: /store/${stale}`,
    `tree: ${stale}`,
    "```",
    "",
  ].join("\n"));
  const repin = spawnSync(process.execPath, [path.join(copy, "scripts", "repin-dist.cjs")], {
    cwd: copy,
    encoding: "utf8",
  });
  assert.equal(repin.status, 1, repin.stdout + repin.stderr);
  assert.match(repin.stderr, /REFUSE published_asset_pin:/);
  assert.doesNotMatch(fs.readFileSync(readme, "utf8"), new RegExp(stale));
});

test("declared installed-tree sites found by git grep match built artifacts", (t) => {
  const { out, built, identity } = buildDist();
  t.after(() => removeScratch(out));

  const freshExpected = externalTreeSha256FromArtifact(namedArtifact(out, built.stdout));
  assert.match(freshExpected, /^[0-9a-f]{64}$/);
  const publishedExpected = externalPublishedTreeSha256();
  assert.match(publishedExpected, /^[0-9a-f]{64}$/);

  let quotedPublished = 0;
  let quotedFresh = 0;
  const hits = externalPinPopulation();
  for (const hit of hits) {
    const expected = hit.role === "published-asset" ? publishedExpected : freshExpected;
    if (hit.role === "published-asset") quotedPublished += 1;
    else quotedFresh += 1;
    assert.equal(
      hit.hash,
      expected,
      `${hit.file}:${hit.line}:${hit.column} ${hit.role} installed-tree hash mismatch: ` +
        `quoted ${hit.hash}, ${hit.role} ${expected}`,
    );
  }
  assert.ok(hits.length > 0, "the repository must quote at least one installed-tree hash");
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
