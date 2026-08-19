// SPDX-License-Identifier: Apache-2.0
// The release asset is the product. This test deliberately runs that asset:
// parsing a README pin alone cannot prove that the documented install works.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const https = require("node:https");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");
const { tmpdir, track } = require("../test-support/tmpdir.cjs");

const ROOT = path.join(__dirname, "..");
const CHECK = path.join(ROOT, "scripts", "check-root-release-pin.cjs");
const README = path.join(ROOT, "README.md");

function run(pin) {
  return spawnSync(process.execPath, [CHECK], {
    encoding: "utf8",
    env: { ...process.env, ...(pin ? { SEAL_ROOT_RELEASE_PIN: pin } : {}) },
  });
}

test("an absent root pin passes between releases", () => {
  const absent = tmpdir("seal-root-pin-");
  const result = run(path.join(absent, "SHA256SUMS"));
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /^PASS root release pin absent:/);
});

test("an empty root pin passes between releases", () => {
  const empty = path.join(tmpdir("seal-root-pin-"), "SHA256SUMS");
  fs.writeFileSync(empty, "\n");
  const result = run(empty);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /^PASS root release pin empty:/);
});

test("an unreadable root pin refuses by name", () => {
  const directory = tmpdir("seal-root-pin-");
  const result = run(directory);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /^REFUSE root_release_pin: cannot read .*SHA256SUMS|^REFUSE root_release_pin: cannot read /);
});

function readmeInstallCommand(text) {
  const match = text.match(/^\$ SEAL_VERSION=(?<tag>v[0-9.]+(?:-[0-9A-Za-z.-]+)?)$/m);
  if (!match) throw new Error("README.md has no release version command");
  const artifact = `./seal-${match.groups.tag}-linux-x64`;
  assert.match(text, /\$ \.\/"\$expected_name" --sha256 "\$expected_digest" --bytes "\$expected_bytes" --prefix ~\/\.local/);
  return { tag: match.groups.tag, artifact };
}

function fetchBytes(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, { headers: { "user-agent": "seal-dist-pin-test" } }, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location && redirects < 5) {
        response.resume();
        resolve(fetchBytes(new URL(response.headers.location, url).toString(), redirects + 1));
        return;
      }
      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`HTTP ${response.statusCode}`));
        return;
      }
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => resolve(Buffer.concat(chunks)));
    });
    request.setTimeout(30000, () => request.destroy(new Error("timeout")));
    request.on("error", reject);
  });
}

function runInstaller(artifactBytes, digest, bytes, command, tempRoot) {
  const sandbox = path.join(tempRoot, `run-${process.hrtime.bigint()}`);
  const home = path.join(sandbox, "home");
  const tmpdir = path.join(sandbox, "tmp");
  const artifact = path.join(sandbox, path.basename(command.artifact));
  const prefix = path.join(home, ".local");
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(tmpdir, { recursive: true });
  fs.writeFileSync(artifact, artifactBytes, { mode: 0o755 });
  const result = spawnSync(command.artifact, ["--sha256", digest, "--bytes", bytes, "--prefix", prefix], {
    cwd: sandbox,
    encoding: "utf8",
    env: { ...process.env, HOME: home, TMPDIR: tmpdir },
  });
  return { ...result, prefix };
}

test("README published installer consumes the downloaded release pin", async (t) => {
  const command = readmeInstallCommand(fs.readFileSync(README, "utf8"));
  const base = `https://github.com/velvetmonkey/seal/releases/download/${command.tag}`;
  let artifactBytes;
  let sums;
  try {
    [artifactBytes, sums] = await Promise.all([
      fetchBytes(`${base}/${path.basename(command.artifact)}`),
      fetchBytes(`${base}/SHA256SUMS`),
    ]);
  } catch (error) {
    t.skip(`network_unproven: cannot download published release assets: ${error.message}`);
    return;
  }
  const [digest, bytes, name] = sums.toString("utf8").trim().split(/\s+/);
  assert.equal(name, path.basename(command.artifact));
  const tempRoot = track(fs.mkdtempSync(path.join(process.env.RUNNER_TEMP || os.tmpdir(), "seal-readme-install-")));
  const installed = runInstaller(artifactBytes, digest, bytes, command, tempRoot);
  assert.equal(installed.status, 0, `${installed.stdout || ""}${installed.stderr || ""}`);
  assert.match(installed.stdout, new RegExp(`^installed seal ${command.tag.slice(1)} linux-x64$`, "m"));
  assert.ok(fs.existsSync(path.join(installed.prefix, "bin", "seal")));

  const wrongDigest = `${digest[0] === "0" ? "1" : "0"}${digest.slice(1)}`;
  const digestRefusal = runInstaller(artifactBytes, wrongDigest, bytes, command, tempRoot);
  assert.equal(digestRefusal.status, 1, digestRefusal.stderr);
  assert.match(digestRefusal.stderr, /artifact_digest_mismatch/);

  const wrongBytes = String(Number(bytes) + 1);
  const byteRefusal = runInstaller(artifactBytes, digest, wrongBytes, command, tempRoot);
  assert.equal(byteRefusal.status, 1, byteRefusal.stderr);
  assert.match(byteRefusal.stderr, /artifact_(?:digest_mismatch|truncated)/);
});
