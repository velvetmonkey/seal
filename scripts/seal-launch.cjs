#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Installed `seal` entry. Judges the store against the install record BEFORE
// loading any file from that store. Never searches PATH for another seal.
// Seal supports only the explicit host lanes below and refuses record mismatch.
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

function refuse(code, reason) {
  process.stderr.write(`REFUSE ${code}: ${reason}\n`);
  process.exit(1);
}

function sha256Hex(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
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
  return { ok: SUPPORTED_PLATFORMS.has(id), id };
}

const host = hostPlatform();
if (!host.ok) {
  process.stderr.write([
    "UNSUPPORTED PLATFORM",
    "",
    "Seal v0.2.0-rc.3.",
    "Seal supports install, demo, receipt checking and Protect on Linux x86-64 and macOS x64/arm64.",
    "",
    "No files were changed.",
    "",
  ].join("\n"));
  process.stderr.write(`REFUSE unsupported_platform: refusing to run unsupported host ${host.id}\n`);
  process.exit(1);
}

const launchPath = process.argv[1];
const binDir = path.dirname(launchPath);
const prefix = path.dirname(binDir);
const recordPath = path.join(prefix, "lib", "seal", "install.json");

let record;
try {
  record = JSON.parse(fs.readFileSync(recordPath, "utf8"));
} catch (error) {
  if (error && error.code === "ENOENT") refuse("install_record_missing", `no install record at ${recordPath}`);
  refuse("install_record_unreadable", `cannot read install record ${recordPath}: ${error.message}`);
}
if (!SUPPORTED_PLATFORMS.has(record.platform) || record.platform !== host.id) {
  refuse("unsupported_platform", `install record platform is ${record.platform || "<absent>"}, running host is ${host.id}`);
}

const storeRoot = path.join(prefix, record.store);
if (!storeRoot.startsWith(prefix)) refuse("install_record_malformed", "store path escapes the prefix");

for (const file of record.files || []) {
  const full = path.join(storeRoot, file.path);
  let stat;
  try {
    stat = fs.statSync(full);
  } catch (error) {
    if (error && error.code === "ENOENT") refuse("artifact_missing", `installed file missing: ${file.path}`);
    refuse("artifact_unreadable", `installed file unreadable: ${file.path}`);
  }
  if (!stat.isFile()) refuse("artifact_missing", `installed path is not a file: ${file.path}`);
  if (stat.size < file.bytes) refuse("artifact_truncated", `installed file truncated: ${file.path} (${stat.size} < ${file.bytes})`);
  let data;
  try {
    data = fs.readFileSync(full);
  } catch (error) {
    refuse("artifact_unreadable", `installed file unreadable: ${file.path}: ${error.message}`);
  }
  if (data.length < file.bytes) refuse("artifact_truncated", `installed file truncated: ${file.path}`);
  const got = sha256Hex(data);
  if (got !== file.sha256 || data.length !== file.bytes) {
    refuse("artifact_digest_mismatch", `installed file digest mismatch: ${file.path}`);
  }
}

const digest = treeDigest(record.files);
if (digest !== record.treeSha256) {
  refuse("artifact_digest_mismatch", "installed tree digest does not match the install record");
}

let version;
try {
  version = fs.readFileSync(path.join(storeRoot, "VERSION"), "utf8").trim();
} catch (error) {
  refuse("artifact_unreadable", `VERSION is unreadable: ${error.message}`);
}
if (version !== record.version) {
  refuse("version_mismatch", `installed VERSION ${version} does not match the release record ${record.version}`);
}

const product = path.join(storeRoot, "bin", "seal");
const run = spawnSync(process.execPath, [product, ...process.argv.slice(2)], {
  stdio: "inherit",
  env: process.env,
});
if (run.error) refuse("artifact_unreadable", `could not execute the installed product: ${run.error.message}`);
process.exit(run.status === null ? 1 : run.status);
