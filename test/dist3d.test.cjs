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

const ROOT = path.join(__dirname, "..");
const BUILD = path.join(ROOT, "scripts", "build-dist.cjs");
const VERSION = fs.readFileSync(path.join(ROOT, "VERSION"), "utf8").trim();

function tmpdir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function sha256Hex(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
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

function buildArtifact() {
  const out = tmpdir("seal-dist3d-build-");
  const built = runNode([BUILD, "--out", out]);
  assert.equal(built.code, 0, built.out);
  const artifact = path.join(out, `seal-v${VERSION}-linux-x64`);
  assert.ok(fs.existsSync(artifact), built.out);
  const sums = fs.readFileSync(path.join(out, "SHA256SUMS"), "utf8").trim();
  const [digest, bytes, name] = sums.split(/\s+/);
  assert.equal(name, `seal-v${VERSION}-linux-x64`);
  assert.equal(digest, sha256Hex(fs.readFileSync(artifact)));
  assert.equal(Number(bytes), fs.statSync(artifact).size);
  return { out, artifact, digest, bytes: Number(bytes) };
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
  assert.doesNotMatch(result.out, /Linux x86-64 only/);
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

test("clause 3: wrong architecture is a named refusal and changes nothing", () => {
  const built = buildArtifact();
  const prefix = path.join(built.out, "nope");
  const result = runArtifact(
    built.artifact,
    ["--sha256", built.digest, "--bytes", String(built.bytes), "--prefix", prefix],
    { env: { SEAL_SPINE_PLATFORM: "darwin", SEAL_SPINE_ARCH: "arm64" } },
  );
  assert.equal(result.code, 1, result.out);
  assert.match(result.stderr, /UNSUPPORTED PLATFORM/);
  assert.match(result.stderr, /Seal v1\.1 supports Linux x86-64 only/);
  assert.match(result.stderr, /^REFUSE unsupported_platform:/m);
  assert.doesNotMatch(result.out, /experimental|may work|coming soon/i);
  assert.equal(fs.existsSync(path.join(prefix, "bin", "seal")), false);
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

test("darwin-arm64 is unsupported on the product path too", () => {
  const result = runNode([path.join(ROOT, "bin", "seal"), "demo", "--dir", tmpdir("seal-dist3d-plat-")], {
    env: { SEAL_SPINE_PLATFORM: "darwin", SEAL_SPINE_ARCH: "arm64" },
  });
  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /UNSUPPORTED PLATFORM/);
  assert.match(result.stderr, /^REFUSE unsupported_platform:/m);
});

test("help does not claim macOS or arm64 support", () => {
  const result = runNode([path.join(ROOT, "bin", "seal")]);
  assert.equal(result.code, 0, result.out);
  assert.match(result.stdout, /Linux x86-64 only/);
  assert.doesNotMatch(result.stdout, /macOS|darwin|arm64|experimental|coming soon/i);
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
  assert.ok(fs.existsSync(packagedChecker), "3C checker must be in the payload");
  const allow = fs.readdirSync(path.join(demoDir, "receipts")).find((name) => name.includes("-ALLOW.json"));
  assert.ok(allow, out);
  const checked = runNode([
    packagedChecker,
    path.join(demoDir, "receipts", allow),
    "--pubkey", path.join(demoDir, "receipt-signer.pub"),
  ], { cwd: built.out });
  assert.equal(checked.code, 0, checked.out);
  assert.match(checked.stdout, /^ACCEPT ALLOW demo\.mutate/);
  assert.match(out, new RegExp(packagedChecker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});
