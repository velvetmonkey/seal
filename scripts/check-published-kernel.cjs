#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// SAME-AUTHORITY POST-RELEASE REPRODUCTION: the release publisher and this
// check share one authority. This proves published bytes match tracked bytes;
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
  const assetName = `seal-${tag}-linux-x64`;
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
  try {
    fs.chmodSync(asset, 0o555);
    execFileSync(asset, ["--sha256", published.digest, "--bytes", String(published.bytes), "--prefix", prefix], { stdio: "inherit" });
  } catch (error) {
    fail(`published installer failed (exit ${error.status ?? "unknown"})`);
  }
  const record = JSON.parse(fs.readFileSync(path.join(prefix, "lib", "seal", "install.json"), "utf8"));
  const installed = path.join(prefix, record.store, "runtime", "kernel", "wasm", "seal.wasm");
  if (!fs.existsSync(installed)) fail(`installer did not place seal.wasm at its recorded install path: ${installed}`);
  const installedDigest = sha256(installed);
  const tracked = arg("--tracked-wasm") || path.join(ROOT, "runtime", "kernel", "wasm", "seal.wasm");
  const trackedDigest = sha256(tracked);
  const manifestPath = arg("--manifest") || path.join(ROOT, "runtime-manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const manifestDigest = manifest.files?.["kernel/wasm/seal.wasm"];
  if (!/^[0-9a-f]{64}$/.test(manifestDigest || "")) fail(`runtime-manifest.json has no valid kernel digest`);

  process.stdout.write("SAME-AUTHORITY POST-RELEASE REPRODUCTION\n");
  process.stdout.write("Limit: the release publisher and this check share one authority; this proves published bytes match tracked bytes, not independent reproduction.\n");
  process.stdout.write(`published installed seal.wasm: ${installedDigest}\n`);
  process.stdout.write(`tracked runtime/kernel/wasm/seal.wasm: ${trackedDigest}\n`);
  process.stdout.write(`runtime-manifest.json kernel pin: ${manifestDigest}\n`);
  if (installedDigest !== trackedDigest || installedDigest !== manifestDigest || trackedDigest !== manifestDigest) {
    fail(`kernel digest mismatch: published installed ${installedDigest}; tracked ${trackedDigest}; manifest ${manifestDigest}`);
  }
  process.stdout.write("PASS all three kernel digests agree\n");
}

main();
