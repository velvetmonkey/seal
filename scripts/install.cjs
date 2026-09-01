#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Platform-bound installer. This file is also the body of each published
// artifact: the payload is appended after the marker. It never searches
// PATH for another seal, and it will not install without an operator pin.
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const MARKER = "\n// --SEAL-PAYLOAD--\n";
const MAGIC = "SEALPAY1\n";
const DATA = "--DATA--\n";

function refuse(code, reason) {
  process.stderr.write(`REFUSE ${code}: ${reason}\n`);
  process.exit(1);
}

function sha256Hex(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function shellWord(value) {
  return /^[A-Za-z0-9_./:-]+$/.test(value) ? value : `'${value.replaceAll("'", "'\\''")}'`;
}

function treeDigest(files) {
  const lines = [...files]
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
    .map((file) => `${file.sha256}  ${file.bytes}  ${file.path}\n`)
    .join("");
  return sha256Hex(Buffer.from(lines, "utf8"));
}

const SUPPORTED_PLATFORMS = new Set(["linux-x64", "darwin-x64", "darwin-arm64"]);

function hostPlatform() {
  const platform = process.env.SEAL_SPINE_PLATFORM || process.platform;
  const arch = process.env.SEAL_SPINE_ARCH || process.arch;
  const id = `${platform}-${arch}`;
  return { ok: SUPPORTED_PLATFORMS.has(id), platform, arch, id };
}

function unpackPayload(payload) {
  if (payload.length < MAGIC.length || payload.subarray(0, MAGIC.length).toString("utf8") !== MAGIC) {
    refuse("artifact_malformed", "payload does not start with SEALPAY1");
  }
  const marker = Buffer.from(DATA, "utf8");
  const dataAt = payload.indexOf(marker, MAGIC.length);
  if (dataAt < 0) refuse("artifact_truncated", "payload is missing the data marker");
  let manifest;
  try {
    manifest = JSON.parse(payload.subarray(MAGIC.length, dataAt).toString("utf8").trim());
  } catch (error) {
    refuse("artifact_malformed", `payload header is not JSON: ${error.message}`);
  }
  let offset = dataAt + marker.length;
  const extracted = [];
  for (const file of manifest.files || []) {
    const end = offset + file.bytes;
    if (payload.length < end) {
      refuse("artifact_truncated", `payload ends at ${payload.length} bytes; ${file.path} needs ${file.bytes} more`);
    }
    const data = payload.subarray(offset, end);
    const got = sha256Hex(data);
    if (got !== file.sha256) refuse("artifact_digest_mismatch", `${file.path} does not match the payload manifest`);
    extracted.push({ ...file, data });
    offset = end;
  }
  if (offset !== payload.length) refuse("artifact_malformed", "payload has trailing bytes");
  if (treeDigest(manifest.files) !== manifest.treeSha256) {
    refuse("artifact_digest_mismatch", "payload tree digest does not match its manifest");
  }
  return { manifest, files: extracted };
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === "--sha256" || flag === "--prefix" || flag === "--bytes") {
      const value = argv[i + 1];
      if (value === undefined) refuse("pin_missing", `${flag} needs a value`);
      if (flag === "--sha256") out.sha256 = value;
      else if (flag === "--prefix") out.prefix = value;
      else out.bytes = Number(value);
      i += 1;
      continue;
    }
    refuse("unknown_flag", `unknown installer flag: ${flag}`);
  }
  return out;
}

function writeFileDeep(target, data, mode) {
  const parent = path.dirname(target);
  try {
    fs.mkdirSync(parent, { recursive: true });
  } catch (error) {
    refuse("install_parent_unwritable", `cannot create or write parent directory ${parent}: ${error.message}`);
  }
  const temp = path.join(parent, `.${path.basename(target)}.${process.pid}.${crypto.randomBytes(8).toString("hex")}.tmp`);
  try {
    fs.writeFileSync(temp, data, { mode, flag: "wx" });
    fs.renameSync(temp, target);
  } catch (error) {
    try { fs.unlinkSync(temp); } catch { /* a failed cleanup must not hide the refusal */ }
    refuse("install_parent_unwritable", `cannot replace ${target} because its parent directory ${parent} is not writable: ${error.message}`);
  }
}

function lstatOrAbsent(target) {
  try {
    return fs.lstatSync(target);
  } catch (error) {
    if (error && error.code === "ENOENT") return null;
    if (error && (error.code === "EACCES" || error.code === "EPERM")) {
      refuse("install_target_unwritable", `cannot inspect ${target}: ${error.message}`);
    }
    refuse("existing_install_untrusted", `cannot inspect existing install target ${target}: ${error.message}`);
  }
}

function readVerifiedExistingInstall(recordPath, launchPath, platform) {
  const recordStat = lstatOrAbsent(recordPath);
  const launchStat = lstatOrAbsent(launchPath);
  if (!recordStat && !launchStat) return null;
  if (!recordStat || !launchStat || !recordStat.isFile() || !launchStat.isFile()) {
    refuse("existing_install_untrusted", "existing Seal targets are incomplete or are not regular files; choose a fresh prefix or repair this install");
  }

  let record;
  let launcher;
  try {
    record = JSON.parse(fs.readFileSync(recordPath, "utf8"));
    launcher = fs.readFileSync(launchPath);
  } catch (error) {
    if (error && (error.code === "EACCES" || error.code === "EPERM")) {
      refuse("install_target_unwritable", `cannot read existing Seal install: ${error.message}`);
    }
    refuse("existing_install_untrusted", `cannot read existing Seal install: ${error.message}`);
  }
  const launcherEntry = record && Array.isArray(record.files)
    ? record.files.find((file) => file && file.path === "scripts/seal-launch.cjs")
    : null;
  if (
    !record || record.schema !== "seal.install/v1" || record.platform !== platform ||
    typeof record.treeSha256 !== "string" || !/^[0-9a-f]{64}$/.test(record.treeSha256) ||
    record.store !== path.posix.join("lib", "seal", "store", record.treeSha256) ||
    !launcherEntry || launcherEntry.bytes !== launcher.length ||
    launcherEntry.sha256 !== sha256Hex(launcher) || treeDigest(record.files) !== record.treeSha256
  ) {
    refuse("existing_install_untrusted", "existing Seal launcher and install record do not verify; choose a fresh prefix or repair this install");
  }
  return record;
}

function verifyOrWriteStoreFile(target, file, mode) {
  const stat = lstatOrAbsent(target);
  if (!stat) {
    writeFileDeep(target, file.data, mode);
    return;
  }
  if (!stat.isFile()) {
    refuse("existing_install_untrusted", `existing store target is not a regular file: ${target}`);
  }
  let actual;
  try {
    actual = fs.readFileSync(target);
  } catch (error) {
    if (error && (error.code === "EACCES" || error.code === "EPERM")) {
      refuse("install_target_unwritable", `cannot read existing store target ${target}: ${error.message}`);
    }
    refuse("existing_install_untrusted", `cannot read existing store target ${target}: ${error.message}`);
  }
  if (!actual.equals(file.data)) {
    refuse("existing_install_untrusted", `existing store target does not match this Seal artifact: ${target}`);
  }
}

function main() {
  const plat = hostPlatform();
  if (!plat.ok) {
    process.stderr.write([
      "UNSUPPORTED PLATFORM",
      "",
      "Seal v0.2.1.",
      "Seal supports install, demo, receipt checking and Protect on Linux x86-64 and macOS x64/arm64.",
      "",
      "No files were changed.",
      "",
    ].join("\n"));
    process.stderr.write(`REFUSE unsupported_platform: this is ${plat.platform}-${plat.arch}\n`);
    process.exit(1);
  }

  // `node - "$0" "$@"` (the published artifact) puts the file path at argv[2].
  const argv = process.argv;
  const selfPath = argv[1] === "-" ? argv[2] : argv[1];
  const flags = argv[1] === "-" ? argv.slice(3) : argv.slice(2);
  if (!selfPath || selfPath === "-") refuse("artifact_missing", "installer path is missing");
  const args = parseArgs(flags);
  if (!args.sha256) {
    refuse("pin_missing", "install requires --sha256 <hex> (the published digest of this artifact)");
  }
  if (!/^[0-9a-f]{64}$/.test(args.sha256)) {
    refuse("pin_invalid", "--sha256 must be 64 lowercase hex characters");
  }
  let self;
  try {
    self = fs.readFileSync(selfPath);
  } catch (error) {
    if (error && error.code === "ENOENT") refuse("artifact_missing", `installer is missing: ${selfPath}`);
    refuse("artifact_unreadable", `installer is unreadable: ${error.message}`);
  }

  if (Number.isFinite(args.bytes)) {
    if (self.length < args.bytes) {
      refuse("artifact_truncated", `installer is ${self.length} bytes, published length is ${args.bytes}`);
    }
    if (self.length !== args.bytes) {
      refuse("artifact_digest_mismatch", `installer is ${self.length} bytes, published length is ${args.bytes}`);
    }
  }

  const got = sha256Hex(self);
  if (got !== args.sha256) {
    refuse("artifact_digest_mismatch", "installer digest does not match the supplied --sha256 pin");
  }

  const marker = Buffer.from(MARKER, "utf8");
  const at = self.indexOf(marker);
  if (at < 0) refuse("artifact_malformed", "this file carries no payload; it is not a built release artifact");
  const payload = self.subarray(at + marker.length);
  const { manifest, files } = unpackPayload(payload);
  const artifactPlatform = typeof manifest.platform === "string" && manifest.platform.length > 0
    ? manifest.platform
    : "<absent>";
  if (!SUPPORTED_PLATFORMS.has(manifest.platform)) {
    refuse("unsupported_platform", `artifact platform is ${artifactPlatform}, not a supported platform`);
  }
  if (manifest.platform !== plat.id) {
    refuse("unsupported_platform", `artifact platform is ${manifest.platform}, running host is ${plat.id}`);
  }

  const prefix = path.resolve(args.prefix || path.join(process.env.HOME || ".", ".local"));
  const storeRel = path.posix.join("lib", "seal", "store", manifest.treeSha256);
  const storeRoot = path.join(prefix, "lib", "seal", "store", manifest.treeSha256);
  const recordPath = path.join(prefix, "lib", "seal", "install.json");
  const launchPath = path.join(prefix, "bin", "seal");

  readVerifiedExistingInstall(recordPath, launchPath, manifest.platform);

  for (const file of files) {
    if (file.path.split("/").includes("..")) refuse("artifact_malformed", `payload path escapes: ${file.path}`);
    const mode = file.path === "bin/seal" || file.path.endsWith("/seal-launch.cjs") ||
      file.path === "runtime/macos-process-start-witness" ? 0o555 : 0o444;
    verifyOrWriteStoreFile(path.join(storeRoot, file.path), file, mode);
  }
  if (manifest.platform.startsWith("darwin-") &&
      !files.some((file) => file.path === "runtime/macos-process-start-witness")) {
    refuse("artifact_missing", "macOS payload has no process-start witness helper");
  }

  const launchSrc = files.find((file) => file.path === "scripts/seal-launch.cjs");
  if (!launchSrc) refuse("artifact_missing", "payload has no scripts/seal-launch.cjs");
  writeFileDeep(launchPath, launchSrc.data, 0o555);

  const record = {
    schema: "seal.install/v1",
    version: manifest.version,
    platform: manifest.platform,
    treeSha256: manifest.treeSha256,
    store: storeRel,
    files: manifest.files,
  };
  writeFileDeep(recordPath, `${JSON.stringify(record, null, 2)}\n`, 0o444);

  try { fs.chmodSync(storeRoot, 0o555); } catch { /* best-effort; hash check is the detector */ }

  process.stdout.write(`installed seal ${manifest.version} ${manifest.platform}\n`);
  process.stdout.write(`store: ${storeRoot}\n`);
  process.stdout.write(`command: ${launchPath}\n`);
  process.stdout.write(`tree: ${manifest.treeSha256}\n`);
  process.stdout.write("Next:\n");
  process.stdout.write(`  export PATH=${shellWord(path.dirname(launchPath))}:$PATH\n`);
  process.stdout.write("  seal demo\n");
}

main();
