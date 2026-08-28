#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Execute the documented release installer without putting its installed-tree
// transcript back on the reader's front page.
const crypto = require("node:crypto");
const fs = require("node:fs");
const https = require("node:https");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ROOT = path.join(__dirname, "..");
const README = process.env.SEAL_INSTALL_TRANSCRIPT_README || path.join(ROOT, "README.md");
const ARTIFACT_OVERRIDE = process.env.SEAL_INSTALL_TRANSCRIPT_ARTIFACT;

class CheckFailure extends Error {
  constructor(reason, status) {
    super(reason);
    this.status = status;
  }
}

function fail(reason, status = 1) {
  throw new CheckFailure(reason, status);
}

function readReadme() {
  let stat;
  try {
    stat = fs.statSync(README);
  } catch (error) {
    if (error.code === "ENOENT") fail(`README absent: ${README}`, 2);
    fail(`README unreadable: ${README}: ${error.message}`, 2);
  }
  if (!stat.isFile()) fail(`README unreadable: ${README}: not a regular file`, 2);
  if (stat.size === 0) fail(`README empty: ${README}`, 2);
  try {
    return fs.readFileSync(README, "utf8");
  } catch (error) {
    fail(`README unreadable: ${README}: ${error.message}`, 2);
  }
}

function documentedInstall(readme) {
  const command = './"$expected_name" --sha256 "$expected_digest" --bytes "$expected_bytes" --prefix ~/.local';
  const at = readme.indexOf(command);
  if (at === -1) fail(`README release installer command absent: ${README}`);
  if (readme.indexOf(command, at + command.length) !== -1) fail(`README release installer command duplicated: ${README}`);
  if (/Seal installed-tree pin role|^store: .*\/store\/[0-9a-f]{64}$|^tree: [0-9a-f]{64}$/m.test(readme)) {
    fail(`README must not carry an installed-tree transcript: ${README}`);
  }
  return { line: readme.slice(0, at).split("\n").length };
}

function documentedTag(readme) {
  const match = readme.match(/^(?:\$ )?SEAL_VERSION=(v[0-9.]+(?:-[0-9A-Za-z.-]+)?)$/m);
  if (!match) fail(`README release version command absent: ${README}`);
  return match[1];
}

function fetchBytes(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, { headers: { "user-agent": "seal-install-transcript-check" } }, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location && redirects < 5) {
        response.resume();
        resolve(fetchBytes(new URL(response.headers.location, url).toString(), redirects + 1));
        return;
      }
      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`HTTP ${response.statusCode} for ${url}`));
        return;
      }
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => resolve(Buffer.concat(chunks)));
    });
    request.setTimeout(30000, () => request.destroy(new Error(`timeout for ${url}`)));
    request.on("error", reject);
  });
}

async function releaseAsset(tag) {
  if (ARTIFACT_OVERRIDE) {
    const bytes = fs.readFileSync(ARTIFACT_OVERRIDE);
    return { bytes, name: path.basename(ARTIFACT_OVERRIDE), digest: crypto.createHash("sha256").update(bytes).digest("hex") };
  }
  const base = `https://github.com/velvetmonkey/seal/releases/download/${tag}`;
  const artifactName = `seal-${tag}-linux-x64`;
  const [bytes, sums] = await Promise.all([fetchBytes(`${base}/${artifactName}`), fetchBytes(`${base}/SHA256SUMS`)]);
  const [digest, count, name] = sums.toString("utf8").trim().split(/\s+/);
  if (name !== artifactName || Number(count) !== bytes.length || crypto.createHash("sha256").update(bytes).digest("hex") !== digest) {
    fail(`published release asset does not match SHA256SUMS for ${artifactName}`);
  }
  return { bytes, name, digest };
}

async function main() {
  const readme = readReadme();
  const install = documentedInstall(readme);
  const tag = documentedTag(readme);
  let asset;
  try {
    asset = await releaseAsset(tag);
  } catch (error) {
    fail(`cannot obtain installer artifact: ${error.message}`, 2);
  }

  const tempBase = process.env.SEAL_INSTALL_TRANSCRIPT_TMPDIR || process.env.RUNNER_TEMP || process.env.TMPDIR || os.tmpdir();
  const sandbox = fs.mkdtempSync(path.join(tempBase, "seal-install-transcript-"));
  try {
    const artifact = path.join(sandbox, asset.name);
    const home = path.join(sandbox, "home");
    const prefix = path.join(home, ".local");
    fs.writeFileSync(artifact, asset.bytes, { mode: 0o755 });
    const result = spawnSync(artifact, ["--sha256", asset.digest, "--bytes", String(asset.bytes.length), "--prefix", prefix], {
      cwd: sandbox,
      encoding: "utf8",
      env: { ...process.env, HOME: home },
    });
    if (result.status !== 0) fail(`installer exited ${result.status}: ${(result.stderr || "").trim()}`);
    if (result.stderr) fail(`installer wrote unexpected stderr on success: ${JSON.stringify(result.stderr)}`);
    const version = tag.slice(1).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const success = new RegExp(`^installed seal ${version} linux-x64\\nstore: (.+/store/([0-9a-f]{64}))\\ncommand: .+/bin/seal\\ntree: \\2\\nNext:\\n  export PATH=.+/bin:\\$PATH\\n  seal demo\\n$`);
    if (!success.test(result.stdout)) fail(`installer success output has an unrecognised shape: ${JSON.stringify(result.stdout)}`);
    console.log(`PASS  README installer command succeeds; installed-tree transcript stays off the front page: ${README}:${install.line}`);
  } finally {
    try { fs.chmodSync(sandbox, 0o700); } catch { /* cleanup still attempts descendants */ }
    try {
      for (const entry of fs.readdirSync(sandbox, { recursive: true })) {
        try { fs.chmodSync(path.join(sandbox, entry), 0o700); } catch { /* best effort */ }
      }
      fs.rmSync(sandbox, { recursive: true, force: true });
    } catch (error) {
      console.error(`FAIL  cleanup installer sandbox: ${error.message}`);
      process.exitCode = 1;
    }
  }
}

main().catch((error) => {
  if (error instanceof CheckFailure) {
    console.error(`FAIL  ${error.message}`);
    process.exitCode = error.status;
    return;
  }
  console.error(`FAIL  unexpected transcript-check error: ${error.stack || error.message}`);
  process.exitCode = 2;
});
