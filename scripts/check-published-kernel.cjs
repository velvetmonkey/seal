#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// SAME-AUTHORITY RELEASE-ARTIFACT KERNEL CORRESPONDENCE: the artifact
// publisher and this check share one authority. This proves selected bytes match one supplied
// fresh rebuild; it does not create an independent build or source of truth.
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { unpackPayload } = require("../spine/integrity.cjs");

const ROOT = path.join(__dirname, "..");
const DEFAULT_TAG = "v0.2.0-rc.3";
const PLATFORMS = new Set(["linux-x64", "darwin-arm64"]);
const NATIVE_HELPER_LIMIT = "the native macOS helper is release-produced, not independently reproduced, and is not covered by this result";

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
  if (!PLATFORMS.has(platform)) fail(`unsupported platform ${platform}; expected linux-x64 or darwin-arm64`);
  const rebuilt = requiredArg("--rebuilt-wasm");
  if (!fs.existsSync(rebuilt) || !fs.lstatSync(rebuilt).isFile()) fail(`fresh rebuilt kernel is unavailable: ${rebuilt}`);
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

  // Kernel correspondence is platform-independent: inspect the payload bytes
  // directly instead of asking this host to run an artifact for another host.
  const marker = Buffer.from("\n// --SEAL-PAYLOAD--\n", "utf8");
  const artifactBytes = fs.readFileSync(asset);
  const payloadAt = artifactBytes.indexOf(marker);
  if (payloadAt < 0) fail(`artifact has no payload marker: ${assetName}`);
  let unpacked;
  try {
    unpacked = unpackPayload(artifactBytes.subarray(payloadAt + marker.length));
  } catch (error) {
    fail(`cannot unpack downloaded artifact ${assetName}: ${error.message}`);
  }
  if (unpacked.manifest.platform !== platform) fail(`artifact payload platform is ${unpacked.manifest.platform}, not requested ${platform}`);
  const kernel = unpacked.files.find((file) => file.path === "runtime/kernel/wasm/seal.wasm");
  if (!kernel) fail(`artifact payload has no runtime/kernel/wasm/seal.wasm: ${assetName}`);
  const installedDigest = sha256Hex(kernel.data);
  const rebuiltDigest = sha256(rebuilt);

  process.stdout.write("SAME-AUTHORITY RELEASE-ARTIFACT KERNEL CORRESPONDENCE\n");
  process.stdout.write(`selected artifact: ${assetName}\n`);
  process.stdout.write(`Coverage: ${NATIVE_HELPER_LIMIT}.\n`);
  process.stdout.write("Limit: the artifact publisher and this check share one authority; this proves the selected artifact's installed kernel bytes match one supplied fresh rebuild, and it does not resist a hostile published installer that plants believable bytes.\n");
  process.stdout.write(`downloaded artifact embedded seal.wasm: ${installedDigest}\n`);
  process.stdout.write(`fresh rebuilt seal.wasm: ${rebuiltDigest}\n`);
  if (installedDigest !== rebuiltDigest) {
    fail(`kernel digest mismatch: downloaded artifact embedded ${installedDigest}; fresh rebuilt ${rebuiltDigest}`);
  }
  process.stdout.write(`PASS ${assetName} kernel: downloaded artifact and fresh rebuild agree\n`);
  if (!process.argv.includes("--exercise")) {
    process.stdout.write(`Execution: NOT CHECKED. REFUSE execution claim for ${platform}: rerun on a matching ${platform} runner with --exercise.\n`);
    return;
  }
  const runtimePlatform = process.platform === "darwin" ? `darwin-${process.arch === "arm64" ? "arm64" : process.arch === "x64" ? "x64" : process.arch}` : `${process.platform}-${process.arch}`;
  if (runtimePlatform !== platform) {
    fail(`execution for ${platform} requires a matching ${platform} runner; this runner is ${runtimePlatform}. ${NATIVE_HELPER_LIMIT}`);
  }
  const prefix = fs.mkdtempSync(path.join(work, "prefix-"));
  const installerCwd = fs.mkdtempSync(path.join(work, "installer-cwd-"));
  try {
    fs.chmodSync(asset, 0o555);
    execFileSync(asset, ["--sha256", published.digest, "--bytes", String(published.bytes), "--prefix", prefix], { cwd: installerCwd, stdio: "inherit" });
    const record = JSON.parse(fs.readFileSync(path.join(prefix, "lib", "seal", "install.json"), "utf8"));
    if (platform.startsWith("darwin-")) execFileSync(path.join(prefix, record.store, "runtime", "macos-process-start-witness"), [String(process.pid)], { stdio: "inherit" });
    execFileSync(path.join(prefix, "bin", "seal"), ["demo", "--dir", path.join(work, "demo")], { input: "y\n", stdio: ["pipe", "inherit", "inherit"] });
  } catch (error) {
    fail(`downloaded ${platform} artifact execution failed (exit ${error.status ?? "unknown"})`);
  }
  process.stdout.write(`PASS ${assetName} execution: downloaded artifact ran on matching ${platform} runner\n`);
}

main();
