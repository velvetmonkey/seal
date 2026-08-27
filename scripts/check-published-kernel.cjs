#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// SAME-AUTHORITY LINUX-X64 ARTIFACT KERNEL CORRESPONDENCE: the artifact
// publisher and this check share one authority. This proves selected bytes match tracked bytes;
// it does not create an independent build or source of truth.
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const ROOT = path.join(__dirname, "..");
const DEFAULT_TAG = "v0.2.0-rc.3";

function fail(message) {
  process.stderr.write(`REFUSE published_kernel: ${message}\n`);
  process.exit(1);
}

function arg(name) {
  const at = process.argv.indexOf(name);
  return at < 0 ? undefined : process.argv[at + 1];
}

function requiredArg(name) {
  const value = arg(name);
  if (!value) fail(`${name} needs a value`);
  return value;
}

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
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

function verifyInstalledTree(record, storeRoot, prefixResolved) {
  if (!Array.isArray(record.files)) fail("installer record has no files array");
  const observed = [];
  const storeResolved = fs.realpathSync(storeRoot);
  const storeBoundary = storeResolved.endsWith(path.sep) ? storeResolved : `${storeResolved}${path.sep}`;
  const prefixBoundary = prefixResolved.endsWith(path.sep) ? prefixResolved : `${prefixResolved}${path.sep}`;
  if (storeResolved !== prefixResolved && !storeResolved.startsWith(prefixBoundary)) {
    fail(`resolved store path escapes prefix: ${storeResolved} (prefix ${prefixResolved})`);
  }
  for (const file of record.files) {
    if (
      !file || typeof file.path !== "string" || file.path.length === 0 ||
      file.path.split("/").includes("..") || path.posix.isAbsolute(file.path) ||
      !/^[0-9a-f]{64}$/.test(file.sha256 || "") || !Number.isSafeInteger(file.bytes) || file.bytes < 0
    ) {
      fail(`installer record has an invalid file entry: ${JSON.stringify(file)}`);
    }
    const installedFile = path.join(storeRoot, file.path);
    let stat;
    try {
      stat = fs.lstatSync(installedFile);
    } catch (error) {
      fail(`cannot inspect installed tree file ${installedFile}: ${error.message}`);
    }
    if (!stat.isFile()) fail(`installed tree path is not a regular file: ${installedFile}`);
    let resolved;
    try {
      resolved = fs.realpathSync(installedFile);
    } catch (error) {
      fail(`cannot resolve installed tree file ${installedFile}: ${error.message}`);
    }
    if (resolved !== storeResolved && !resolved.startsWith(storeBoundary)) {
      fail(`resolved installed tree file escapes store: ${resolved} (store ${storeResolved})`);
    }
    const bytes = fs.readFileSync(installedFile);
    const actualSha256 = sha256Hex(bytes);
    if (bytes.length !== file.bytes || actualSha256 !== file.sha256) {
      fail(
        `installed tree file mismatch for ${file.path}: record ${file.sha256}/${file.bytes}; ` +
        `installed ${actualSha256}/${bytes.length}`,
      );
    }
    observed.push({ path: file.path, sha256: actualSha256, bytes: bytes.length });
  }
  const observedTree = treeDigest(observed);
  const recordTree = treeDigest(record.files);
  if (recordTree !== record.treeSha256 || observedTree !== record.treeSha256) {
    fail(`installed tree digest mismatch: declared ${record.treeSha256}; record ${recordTree}; installed ${observedTree}`);
  }
  return observedTree;
}

function download(url, destination) {
  try {
    execFileSync("curl", ["-fsSL", "--retry", "3", "--retry-delay", "1", "-o", destination, url], { stdio: "inherit" });
  } catch (error) {
    fail(`download failed for ${url} (exit ${error.status ?? "unknown"})`);
  }
}

function readPublishedEntry(checksums, assetName) {
  const lines = fs.readFileSync(checksums, "utf8").split(/\r?\n/).filter(Boolean);
  const match = lines.map((line) => line.trim().split(/\s+/)).find((fields) => fields[2] === assetName);
  if (!match || match.length !== 3 || !/^[0-9a-f]{64}$/.test(match[0]) || !/^\d+$/.test(match[1])) {
    fail(`SHA256SUMS has no valid three-field entry for ${assetName}`);
  }
  return { digest: match[0], bytes: Number(match[1]) };
}

function main() {
  const tag = arg("--release-tag") || process.env.RELEASE_TAG || DEFAULT_TAG;
  if (!/^v\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.test(tag)) fail(`release tag is invalid: ${tag}`);
  const platform = arg("--platform") || process.env.RELEASE_PLATFORM || "linux-x64";
  const assetName = `seal-${tag}-${platform}`;
  if (platform !== "linux-x64") {
    fail(`platform ${platform} selects artifact ${assetName}; this checker only checks the linux-x64 artifact kernel, and the native macOS helper is release-produced, not independently reproduced, and is not covered by this result`);
  }
  const work = fs.mkdtempSync(path.join(arg("--work-dir") || os.tmpdir(), "seal-published-kernel-"));
  const asset = arg("--asset") || path.join(work, assetName);
  const checksums = arg("--checksums") || path.join(work, "SHA256SUMS");
  if (!arg("--asset") || !arg("--checksums")) {
    const base = `https://github.com/velvetmonkey/seal/releases/download/${encodeURIComponent(tag)}`;
    if (!arg("--checksums")) download(`${base}/SHA256SUMS`, checksums);
    if (!arg("--asset")) download(`${base}/${assetName}`, asset);
  }
  if (!fs.existsSync(checksums)) fail(`release does not exist or SHA256SUMS is unavailable for ${tag}`);
  if (!fs.existsSync(asset)) fail(`release does not exist or asset is unavailable: ${assetName}`);

  const published = readPublishedEntry(checksums, assetName);
  const actualBytes = fs.statSync(asset).size;
  if (actualBytes !== published.bytes) {
    fail(`asset byte count mismatch before hashing: published ${published.bytes}, downloaded ${actualBytes}`);
  }
  const assetDigest = sha256(asset);
  if (assetDigest !== published.digest) {
    fail(`asset digest mismatch: published ${published.digest}, downloaded ${assetDigest}`);
  }

  const prefix = fs.mkdtempSync(path.join(work, "prefix-"));
  const installerCwd = fs.mkdtempSync(path.join(work, "installer-cwd-"));
  try {
    fs.chmodSync(asset, 0o555);
    execFileSync(asset, ["--sha256", published.digest, "--bytes", String(published.bytes), "--prefix", prefix], { cwd: installerCwd, stdio: "inherit" });
  } catch (error) {
    fail(`published installer failed (exit ${error.status ?? "unknown"})`);
  }
  const record = JSON.parse(fs.readFileSync(path.join(prefix, "lib", "seal", "install.json"), "utf8"));
  if (
    typeof record.treeSha256 !== "string" || !/^[0-9a-f]{64}$/.test(record.treeSha256) ||
    record.store !== path.posix.join("lib", "seal", "store", record.treeSha256)
  ) {
    fail(`installer recorded an invalid store value: ${record.store}`);
  }
  const installed = path.join(prefix, record.store, "runtime", "kernel", "wasm", "seal.wasm");
  let prefixResolved;
  try {
    prefixResolved = fs.realpathSync(prefix);
  } catch (error) {
    fail(`cannot resolve install prefix ${prefix}: ${error.message}`);
  }
  let installedStat;
  try {
    installedStat = fs.lstatSync(installed);
  } catch (error) {
    fail(`cannot inspect installed path ${installed}: ${error.message}`);
  }
  if (!installedStat.isFile()) fail(`installed path is not a regular file: ${installed}`);
  let installedResolved;
  try {
    installedResolved = fs.realpathSync(installed);
  } catch (error) {
    fail(`cannot resolve installed path ${installed}: ${error.message}`);
  }
  const prefixBoundary = prefixResolved.endsWith(path.sep) ? prefixResolved : `${prefixResolved}${path.sep}`;
  if (installedResolved !== prefixResolved && !installedResolved.startsWith(prefixBoundary)) {
    fail(`resolved installed path escapes prefix: ${installedResolved} (prefix ${prefixResolved})`);
  }
  verifyInstalledTree(record, path.join(prefix, record.store), prefixResolved);
  const installedDigest = sha256(installed);
  const tracked = arg("--tracked-wasm") || path.join(ROOT, "runtime", "kernel", "wasm", "seal.wasm");
  const trackedDigest = sha256(tracked);
  const manifestPath = arg("--manifest") || path.join(ROOT, "runtime-manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const manifestDigest = manifest.files?.["kernel/wasm/seal.wasm"];
  if (!/^[0-9a-f]{64}$/.test(manifestDigest || "")) fail(`runtime-manifest.json has no valid kernel digest`);

  process.stdout.write("SAME-AUTHORITY LINUX-X64 ARTIFACT KERNEL CORRESPONDENCE\n");
  process.stdout.write(`selected artifact: ${assetName}\n`);
  process.stdout.write("Coverage: the native macOS helper is release-produced, not independently reproduced, and is not covered by this result.\n");
  process.stdout.write("Limit: the artifact publisher and this check share one authority; this proves the selected artifact's installed kernel bytes match tracked bytes, and it does not resist a hostile published installer that plants believable bytes.\n");
  process.stdout.write(`published installed seal.wasm: ${installedDigest}\n`);
  process.stdout.write(`tracked runtime/kernel/wasm/seal.wasm: ${trackedDigest}\n`);
  process.stdout.write(`runtime-manifest.json kernel pin: ${manifestDigest}\n`);
  if (installedDigest !== trackedDigest || installedDigest !== manifestDigest || trackedDigest !== manifestDigest) {
    fail(`kernel digest mismatch: published installed ${installedDigest}; tracked ${trackedDigest}; manifest ${manifestDigest}`);
  }
  process.stdout.write(`PASS ${assetName} kernel: all three digests agree\n`);
}

main();
