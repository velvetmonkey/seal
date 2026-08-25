// SPDX-License-Identifier: Apache-2.0
// Roadmap 3D: one Linux x86-64 artifact. Altered bytes refuse. A later
// write is detected. Silence (missing / truncated / unreadable / wrong
// arch) is a named refusal, never a PATH fallback.
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync, spawn, spawnSync } = require("node:child_process");
const test = require("node:test");

const { productIdentity, artifactName } = require("../scripts/product-identity.cjs");

const ROOT = path.join(__dirname, "..");
const BUILD = path.join(ROOT, "scripts", "build-dist.cjs");
const VERSION = fs.readFileSync(path.join(ROOT, "VERSION"), "utf8").trim();

function tmpdir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function sha256Hex(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function installedCheckerPresenceClaims(document) {
  // This is deliberately a claim classifier, not an exact-prose guard. A
  // sentence is a positive installed-tree claim only when it identifies the
  // checker, an installation surface, and a positive placement relation.
  return document
    .replace(/\[[^\]]+\]\([^)]*\)/g, (link) => link.replace(/\([^)]*\)/, ""))
    .replace(/[\n\r]+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .filter((sentence) => {
      const checker = /\b(?:receipt\s+)?checker\b|checker\/seal-receipt-check\.mjs/i.test(sentence);
      const installedSurface = /\b(?:install(?:ed|ation|er)?|payload|package|tree|store)\b/i.test(sentence);
      const placement = /\b(?:contains?|includes?|has|ships?|bundles?|carries|puts?|places?)\b|\b(?:is|are)\s+(?:present|available|included|bundled)\b/i.test(sentence);
      const negative = /\b(?:does|do|is|are|was|were)\s+not\b|\b(?:without|absent|excludes?|lacks?)\b/i.test(sentence);
      return checker && installedSurface && placement && !negative;
    });
}

function runNode(args, opts = {}) {
  const result = spawnSync(process.execPath, args, {
    encoding: "utf8",
    env: { ...process.env, ...(opts.env || {}) },
    cwd: opts.cwd,
  });
  return {
    code: result.status,
    out: `${result.stdout || ""}${result.stderr || ""}`,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
  };
}

function runArtifact(file, args, opts = {}) {
  const result = spawnSync(file, args, {
    encoding: "utf8",
    env: { ...process.env, ...(opts.env || {}) },
    cwd: opts.cwd,
  });
  return {
    code: result.status,
    out: `${result.stdout || ""}${result.stderr || ""}`,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
  };
}

function buildArtifact(platform = "linux-x64") {
  const out = tmpdir("seal-dist3d-build-");
  const built = runNode([BUILD, "--platform", platform, "--out", out]);
  assert.equal(built.code, 0, built.out);
  // The file is named for the product identity of the tree it was built from,
  // which is the bare release version only at the tag.
  const identityName = artifactName(productIdentity({ root: ROOT }).identity, platform);
  const artifact = path.join(out, identityName);
  assert.ok(fs.existsSync(artifact), built.out);
  const sums = fs.readFileSync(path.join(out, "SHA256SUMS"), "utf8").trim();
  const [digest, bytes, name] = sums.split(/\s+/);
  assert.equal(name, identityName);
  assert.equal(digest, sha256Hex(fs.readFileSync(artifact)));
  assert.equal(Number(bytes), fs.statSync(artifact).size);
  return { out, artifact, digest, bytes: Number(bytes) };
}

function withManifestPlatform(built, value, present = true) {
  const bytes = fs.readFileSync(built.artifact);
  const payloadMarker = Buffer.from("\n// --SEAL-PAYLOAD--\n", "utf8");
  const payloadAt = bytes.indexOf(payloadMarker) + payloadMarker.length;
  const dataMarker = Buffer.from("\n--DATA--\n", "utf8");
  const dataAt = bytes.indexOf(dataMarker, payloadAt);
  assert.ok(payloadAt >= payloadMarker.length && dataAt > payloadAt);
  const manifestAt = payloadAt + Buffer.byteLength("SEALPAY1\n");
  const manifest = JSON.parse(bytes.subarray(manifestAt, dataAt).toString("utf8"));
  if (present) manifest.platform = value;
  else delete manifest.platform;
  const altered = Buffer.concat([
    bytes.subarray(0, manifestAt),
    Buffer.from(JSON.stringify(manifest), "utf8"),
    bytes.subarray(dataAt),
  ]);
  const artifact = `${built.artifact}.platform-${present ? String(value || "empty") : "absent"}`;
  fs.writeFileSync(artifact, altered, { mode: 0o555 });
  return { ...built, artifact, digest: sha256Hex(altered), bytes: altered.length };
}

function installedBytes(root) {
  if (!fs.existsSync(root)) return [];
  const rows = [];
  function walk(dir) {
    for (const name of fs.readdirSync(dir).sort()) {
      const full = path.join(dir, name);
      const stat = fs.lstatSync(full);
      if (stat.isDirectory()) walk(full);
      else if (stat.isFile()) rows.push(`${path.relative(root, full)} ${sha256Hex(fs.readFileSync(full))}`);
    }
  }
  walk(root);
  return rows;
}

function installOk(built, prefix) {
  const result = runArtifact(built.artifact, ["--sha256", built.digest, "--bytes", String(built.bytes), "--prefix", prefix]);
  assert.equal(result.code, 0, result.out);
  return path.join(prefix, "bin", "seal");
}

function flipOneByte(filePath) {
  const buf = Buffer.from(fs.readFileSync(filePath));
  buf[0] = buf[0] ^ 0xff;
  fs.chmodSync(filePath, 0o644);
  fs.writeFileSync(filePath, buf);
}

test("binary --version matches VERSION and package.json", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")).version;
  assert.equal(pkg, VERSION);
  const result = runNode([path.join(ROOT, "bin", "seal"), "--version"]);
  assert.equal(result.code, 0, result.out);
  assert.equal(result.stdout.trim(), VERSION);
});

test("the published artifact version matches the release name and the installed binary", () => {
  const built = buildArtifact();
  const prefix = path.join(built.out, "prefix");
  const seal = installOk(built, prefix);
  const result = runNode([seal, "--version"]);
  assert.equal(result.code, 0, result.out);
  assert.equal(result.stdout.trim(), VERSION);
  const record = JSON.parse(fs.readFileSync(path.join(prefix, "lib", "seal", "install.json"), "utf8"));
  assert.equal(record.version, VERSION);
  assert.equal(record.platform, "linux-x64");
  assert.ok(path.basename(built.artifact).includes(`v${VERSION}`));
  const store = path.join(prefix, record.store);
  assert.ok(fs.statSync(path.join(store, "runtime", "kernel", "wasm", "seal.wasm")).isFile());
  assert.equal(fs.existsSync(path.join(store, "test-support", "runtime-fixture", "kernel")), false);
});

test("clause 1: changing one byte of the installed artifact is a named refusal", () => {
  const built = buildArtifact();
  const prefix = path.join(built.out, "prefix");
  const seal = installOk(built, prefix);
  const record = JSON.parse(fs.readFileSync(path.join(prefix, "lib", "seal", "install.json"), "utf8"));
  const target = path.join(prefix, record.store, "spine", "demo.cjs");
  flipOneByte(target);
  const result = runNode([seal, "--version"]);
  assert.equal(result.code, 1, result.out);
  assert.match(result.stderr, /^REFUSE artifact_digest_mismatch:/m);
  assert.doesNotMatch(result.out, /Linux x86-64 and macOS x64\/arm64/);
});

test("clause 2: a later write to the install store is detected, not silent", () => {
  const built = buildArtifact();
  const prefix = path.join(built.out, "prefix");
  const seal = installOk(built, prefix);
  const record = JSON.parse(fs.readFileSync(path.join(prefix, "lib", "seal", "install.json"), "utf8"));
  const storeFile = path.join(prefix, record.store, "VERSION");
  const before = runNode([seal, "--version"]);
  assert.equal(before.code, 0, before.out);
  assert.equal(before.stdout.trim(), VERSION);
  fs.chmodSync(path.dirname(storeFile), 0o755);
  fs.chmodSync(storeFile, 0o644);
  fs.writeFileSync(storeFile, `${VERSION}-tampered\n`);
  const after = runNode([seal, "--version"]);
  assert.equal(after.code, 1, after.out);
  assert.match(after.stderr, /^REFUSE artifact_digest_mismatch:/m);
});

test("clause 3: missing artifact is a named refusal, not a PATH fallback", () => {
  const built = buildArtifact();
  const prefix = path.join(built.out, "prefix");
  const seal = installOk(built, prefix);
  const record = JSON.parse(fs.readFileSync(path.join(prefix, "lib", "seal", "install.json"), "utf8"));
  const product = path.join(prefix, record.store, "bin", "seal");
  fs.chmodSync(path.dirname(product), 0o755);
  fs.rmSync(product);
  const decoy = path.join(built.out, "decoy-bin");
  fs.mkdirSync(decoy);
  fs.writeFileSync(path.join(decoy, "seal"), "#!/bin/sh\necho DECOY\n", { mode: 0o755 });
  const result = runNode([seal, "--version"], { env: { PATH: `${decoy}${path.delimiter}${process.env.PATH}` } });
  assert.equal(result.code, 1, result.out);
  assert.match(result.stderr, /^REFUSE artifact_missing:/m);
  assert.doesNotMatch(result.out, /DECOY/);
});

test("clause 3: truncated download is a named refusal", () => {
  const built = buildArtifact();
  const truncated = `${built.artifact}.truncated`;
  const bytes = fs.readFileSync(built.artifact);
  fs.writeFileSync(truncated, bytes.subarray(0, Math.max(64, Math.floor(bytes.length / 2))));
  fs.chmodSync(truncated, 0o555);
  const result = runArtifact(truncated, ["--sha256", built.digest, "--bytes", String(built.bytes), "--prefix", path.join(built.out, "nope")]);
  assert.equal(result.code, 1, result.out);
  assert.match(result.stderr, /^REFUSE artifact_truncated:/m);
  assert.equal(fs.existsSync(path.join(built.out, "nope", "bin", "seal")), false);
});

test("clause 3: unreadable installed file is a named refusal", () => {
  const built = buildArtifact();
  const prefix = path.join(built.out, "prefix");
  const seal = installOk(built, prefix);
  const record = JSON.parse(fs.readFileSync(path.join(prefix, "lib", "seal", "install.json"), "utf8"));
  const target = path.join(prefix, record.store, "package.json");
  fs.chmodSync(path.dirname(target), 0o755);
  fs.chmodSync(target, 0);
  const result = runNode([seal, "--version"]);
  try { fs.chmodSync(target, 0o444); } catch { /* cleanup */ }
  assert.equal(result.code, 1, result.out);
  assert.match(result.stderr, /^REFUSE artifact_unreadable:/m);
});

test("a linux artifact on a darwin host is a named mismatch refusal and changes no bytes", () => {
  const built = buildArtifact();
  const prefix = path.join(built.out, "nope");
  const result = runArtifact(
    built.artifact,
    ["--sha256", built.digest, "--bytes", String(built.bytes), "--prefix", prefix],
    { env: { SEAL_SPINE_PLATFORM: "darwin", SEAL_SPINE_ARCH: "arm64" } },
  );
  assert.equal(result.code, 1, result.out);
  assert.match(result.stderr, /^REFUSE unsupported_platform: artifact platform is linux-x64, running host is darwin-arm64$/m);
  assert.deepEqual(installedBytes(prefix), []);
});

test("a darwin artifact on Linux is a named mismatch refusal and changes no bytes", () => {
  const built = buildArtifact("darwin-arm64");
  const prefix = path.join(built.out, "nope");
  const before = installedBytes(prefix);
  const result = runArtifact(built.artifact, ["--sha256", built.digest, "--bytes", String(built.bytes), "--prefix", prefix]);
  assert.equal(result.code, 1, result.out);
  assert.match(result.stderr, /^REFUSE unsupported_platform: artifact platform is darwin-arm64, running host is linux-x64$/m);
  assert.deepEqual(installedBytes(prefix), before);
});

for (const [label, value, present, rendered] of [
  ["absent", undefined, false, "<absent>"],
  ["empty", "", true, "<absent>"],
  ["unknown", "haiku-x64", true, "haiku-x64"],
]) {
  test(`an artifact with ${label} manifest platform refuses and changes no bytes`, () => {
    const built = withManifestPlatform(buildArtifact(), value, present);
    const prefix = path.join(built.out, `nope-${label}`);
    const before = installedBytes(prefix);
    const result = runArtifact(built.artifact, ["--sha256", built.digest, "--bytes", String(built.bytes), "--prefix", prefix]);
    assert.equal(result.code, 1, result.out);
    assert.match(result.stderr, new RegExp(`^REFUSE unsupported_platform: artifact platform is ${rendered.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}, not a supported platform$`, "m"));
    assert.deepEqual(installedBytes(prefix), before);
  });
}

test("a fabricated unsupported host refuses and changes no bytes", () => {
  const built = buildArtifact();
  const prefix = path.join(built.out, "nope-fabricated");
  const before = installedBytes(prefix);
  const result = runArtifact(
    built.artifact,
    ["--sha256", built.digest, "--bytes", String(built.bytes), "--prefix", prefix],
    { env: { SEAL_SPINE_PLATFORM: "plan9", SEAL_SPINE_ARCH: "mips" } },
  );
  assert.equal(result.code, 1, result.out);
  assert.match(result.stderr, /^REFUSE unsupported_platform: this is plan9-mips$/m);
  assert.deepEqual(installedBytes(prefix), before);
});

test("install without a pin refuses", () => {
  const built = buildArtifact();
  const result = runArtifact(built.artifact, ["--prefix", path.join(built.out, "nope")]);
  assert.equal(result.code, 1, result.out);
  assert.match(result.stderr, /^REFUSE pin_missing:/m);
});

test("a one-byte change to the artifact itself refuses against the published pin", () => {
  const built = buildArtifact();
  const buf = Buffer.from(fs.readFileSync(built.artifact));
  buf[buf.length - 1] ^= 0xff;
  fs.chmodSync(built.artifact, 0o644);
  fs.writeFileSync(built.artifact, buf);
  fs.chmodSync(built.artifact, 0o555);
  const result = runArtifact(built.artifact, ["--sha256", built.digest, "--bytes", String(built.bytes), "--prefix", path.join(built.out, "nope")]);
  assert.equal(result.code, 1, result.out);
  assert.match(result.stderr, /^REFUSE artifact_digest_mismatch:/m);
});

test("darwin-arm64 is admitted on the product path", () => {
  const result = runNode([path.join(ROOT, "bin", "seal"), "--version"], {
    env: { SEAL_SPINE_PLATFORM: "darwin", SEAL_SPINE_ARCH: "arm64" },
  });
  assert.equal(result.code, 0, result.out);
  assert.equal(result.stdout.trim(), VERSION);
});

test("help distinguishes macOS portability from the supported Protect path", () => {
  const result = runNode([path.join(ROOT, "bin", "seal")]);
  assert.equal(result.code, 0, result.out);
  assert.match(result.stdout, /macOS source portability is CI-exercised for install, demo and receipt checking\./);
  assert.match(result.stdout, /Protect is not supported on macOS yet\./);
  assert.doesNotMatch(result.stdout, /Linux x86-64 and macOS x64\/arm64/);
});

test("installed artifact runs demo then protect and unprotect", async () => {
  const built = buildArtifact();
  const prefix = path.join(built.out, "prefix");
  const seal = installOk(built, prefix);
  const demoDir = path.join(built.out, "demo");
  const child = spawn(process.execPath, [seal, "demo", "--dir", demoDir], { stdio: ["pipe", "pipe", "pipe"] });
  let out = "";
  child.stdout.on("data", (chunk) => {
    out += chunk;
    if (/Approve\? \[y\/N\]/.test(out)) child.stdin.write("y\n");
  });
  const code = await new Promise((resolve) => child.once("close", resolve));
  assert.equal(code, 0, out);
  assert.match(out, /DIRECT WRITE SUCCEEDED/);
  assert.match(out, /Seal decisions emitted: 0/);

  const project = path.join(built.out, "project");
  const home = path.join(built.out, "home");
  fs.mkdirSync(project);
  fs.mkdirSync(home);
  const fakeRoot = path.join(built.out, "fake-claude");
  const fakeBin = path.join(fakeRoot, "bin");
  fs.mkdirSync(fakeBin, { recursive: true });
  fs.writeFileSync(path.join(fakeBin, "claude"), `#!/usr/bin/env node
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const cwd = process.cwd();
const home = process.env.HOME || cwd;
const args = process.argv.slice(2);
function key(name) { return crypto.createHash("sha256").update(cwd).digest("hex").slice(0, 16) + "-" + name + ".json"; }
function localPath(name) { const dir = path.join(home, ".claude-local"); fs.mkdirSync(dir, { recursive: true }); return path.join(dir, key(name)); }
if (args[0] !== "mcp") process.exit(2);
if (args[1] === "get") {
  const name = args[2];
  if (fs.existsSync(localPath(name))) { console.log(name + ":\\n  Scope: Local config\\n  Type: stdio"); process.exit(0); }
  try {
    if (JSON.parse(fs.readFileSync(path.join(cwd, ".mcp.json"), "utf8")).mcpServers[name]) {
      console.log(name + ":\\n  Scope: Project config\\n  Type: stdio"); process.exit(0);
    }
  } catch {}
  process.exit(1);
}
if (args[1] === "add") {
  const name = args[4];
  const split = args.indexOf("--");
  fs.writeFileSync(localPath(name), JSON.stringify({ command: args[split + 1], args: args.slice(split + 2) }));
  process.exit(0);
}
if (args[1] === "remove") {
  try { fs.unlinkSync(localPath(args[4])); } catch {}
  process.exit(0);
}
process.exit(2);
`, { mode: 0o755 });
  const dataFile = path.join(built.out, "data.txt");
  fs.writeFileSync(path.join(project, ".mcp.json"), JSON.stringify({
    mcpServers: { db: { command: process.execPath, args: [seal, "__demo-server", dataFile] } },
  }, null, 2) + "\n");
  const env = {
    PATH: `${fakeBin}${path.delimiter}${process.env.PATH}`,
    HOME: home,
    XDG_DATA_HOME: path.join(home, ".local", "share"),
  };
  const protectedRun = runNode([seal, "protect", "db", "demo.mutate"], { cwd: project, env });
  assert.equal(protectedRun.code, 0, protectedRun.out);
  assert.match(protectedRun.stdout, /PENDING RESTART/);
  const unprotectedRun = runNode([seal, "unprotect", "db"], { cwd: project, env });
  assert.equal(unprotectedRun.code, 0, unprotectedRun.out);
  assert.match(unprotectedRun.stdout, /outside Seal/);

  const { writeKernelReceipt } = require("../test-support/kernel-receipt.cjs");
  const cache = path.join(built.out, "runtime-cache");
  const dataHome = path.join(home, ".local", "share");
  const receipt = await writeKernelReceipt(cache, path.join(built.out, "verify-home"));
  const verified = runNode([seal, "verify", receipt], {
    env: { ...env, SEAL_CACHE_DIR: cache, XDG_DATA_HOME: dataHome },
  });
  assert.equal(verified.code, 0, verified.out);
  assert.match(verified.stdout, /RE-DERIVED/);

  const record = JSON.parse(fs.readFileSync(path.join(prefix, "lib", "seal", "install.json"), "utf8"));
  const store = path.join(prefix, record.store);
  assert.ok(fs.existsSync(path.join(store, "spine", "receipt-seal.cjs")), "3C sealer must be in the payload");
  const packagedChecker = path.join(store, "checker", "seal-receipt-check.mjs");
  assert.equal(fs.existsSync(packagedChecker), false, "3C checker must not be in the payload");
  const readme = fs.readFileSync(path.join(ROOT, "README.md"), "utf8");
  const readmePresenceClaims = installedCheckerPresenceClaims(readme);
  assert.deepEqual(
    readmePresenceClaims,
    [],
    `README.md asserts that its installed tree contains the checker: ${readmePresenceClaims.join(" | ")}`,
  );
  const publishedChecker = path.join(ROOT, "checker", "seal-receipt-check.mjs");
  const allow = fs.readdirSync(path.join(demoDir, "receipts")).find((name) => name.includes("-ALLOW.json"));
  assert.ok(allow, out);
  const checked = runNode([
    publishedChecker,
    path.join(demoDir, "receipts", allow),
    "--pubkey", path.join(demoDir, "receipt-signer.pub"),
  ], { cwd: built.out });
  assert.equal(checked.code, 0, checked.out);
  assert.match(checked.stdout, /^ACCEPT ALLOW demo\.mutate/);
  assert.match(out, /This installed payload does not include checker\/seal-receipt-check\.mjs/);
  assert.match(out, /Clone https:\/\/github\.com\/velvetmonkey\/seal and run the checker from that source checkout/);
  assert.match(out, /From the checkout root: node checker\/seal-receipt-check\.mjs/);
  assert.doesNotMatch(out, /same release page/, "installed demo must not promise an unpublished release asset");
});
