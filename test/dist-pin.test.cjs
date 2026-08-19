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
  const absent = fs.mkdtempSync(path.join(os.tmpdir(), "seal-root-pin-"));
  const result = run(path.join(absent, "SHA256SUMS"));
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /^PASS root release pin absent:/);
});

test("an empty root pin passes between releases", () => {
  const empty = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "seal-root-pin-")), "SHA256SUMS");
  fs.writeFileSync(empty, "\n");
  const result = run(empty);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /^PASS root release pin empty:/);
});

test("an unreadable root pin refuses by name", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "seal-root-pin-"));
  const result = run(directory);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /^REFUSE root_release_pin: cannot read .*SHA256SUMS|^REFUSE root_release_pin: cannot read /);
});

function readmeInstallCommand(text) {
  const commandPattern = /^\$ (?<artifact>\.\/seal-(?<tag>v\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?)-linux-x64) --sha256 (?<sha256>[0-9a-f]{64}) --bytes (?<bytes>\d+) --prefix ~\/\.local$/m;
  const match = text.match(commandPattern);
  if (!match) return { code: 1, stderr: "REFUSE readme_install_command_absent: README.md has no concrete published install command\n" };
  return { code: 0, ...match.groups };
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

function runDocumentedInstaller(readmeText, artifactBytes, tempRoot) {
  const command = readmeInstallCommand(readmeText);
  if (command.code !== 0) return command;

  const sandbox = path.join(tempRoot, `run-${process.hrtime.bigint()}`);
  const home = path.join(sandbox, "home");
  const tmpdir = path.join(sandbox, "tmp");
  const artifact = path.join(sandbox, path.basename(command.artifact));
  const prefix = path.join(home, ".local"); // shell expansion of README's ~/.local
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(tmpdir, { recursive: true });
  fs.writeFileSync(artifact, artifactBytes, { mode: 0o755 });

  const result = spawnSync(command.artifact, ["--sha256", command.sha256, "--bytes", command.bytes, "--prefix", prefix], {
    cwd: sandbox,
    encoding: "utf8",
    env: { ...process.env, HOME: home, TMPDIR: tmpdir },
  });
  return {
    code: result.status,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
    artifact,
    home,
    tmpdir,
    prefix,
    invocation: `${command.artifact} --sha256 ${command.sha256} --bytes ${command.bytes} --prefix ${prefix}`,
  };
}

function alterDigest(text) {
  return text.replace(/(--sha256 )([0-9a-f])/, (_, prefix, digit) => `${prefix}${digit === "0" ? "1" : "0"}`);
}

function alterBytes(text) {
  return text.replace(/(--bytes \d+)(\d)/, (_, prefix, digit) => `${prefix}${digit === "0" ? "1" : String(Number(digit) - 1)}`);
}

test("README published installer command installs the downloaded release asset", async (t) => {
  const readme = fs.readFileSync(README, "utf8");
  const command = readmeInstallCommand(readme);
  assert.equal(command.code, 0, command.stderr);
  const artifactUrl = `https://github.com/velvetmonkey/seal/releases/download/${command.tag}/${path.basename(command.artifact)}`;

  let artifactBytes;
  try {
    artifactBytes = await fetchBytes(artifactUrl);
  } catch (error) {
    // A skip is intentionally not a pass: run-complete-product-suite rejects
    // skipped tests and prints this named, unproven network condition.
    t.skip(`network_unproven: cannot download published release asset ${artifactUrl}: ${error.message}`);
    return;
  }

  const tempRoot = fs.mkdtempSync(path.join(process.env.RUNNER_TEMP || os.tmpdir(), "seal-readme-install-"));
  const installed = runDocumentedInstaller(readme, artifactBytes, tempRoot);
  assert.equal(installed.code, 0, `${installed.invocation}\n${installed.stdout}${installed.stderr}`);
  assert.match(installed.stdout, new RegExp(`^installed seal ${command.tag.slice(1).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} linux-x64$`, "m"));
  assert.ok(fs.existsSync(path.join(installed.prefix, "bin", "seal")), "installer did not write the sandboxed prefix");
  assert.ok(installed.home.startsWith(tempRoot + path.sep));
  assert.ok(installed.tmpdir.startsWith(tempRoot + path.sep));

  const wrongDigest = runDocumentedInstaller(alterDigest(readme), artifactBytes, tempRoot);
  assert.equal(wrongDigest.code, 1, wrongDigest.stdout + wrongDigest.stderr);
  assert.match(wrongDigest.stderr, /^REFUSE artifact_digest_mismatch: installer digest does not match the supplied --sha256 pin$/m);
  t.diagnostic(`README digest altered by one character (exit ${wrongDigest.code}): ${wrongDigest.stderr.trim()}`);

  const wrongBytes = runDocumentedInstaller(alterBytes(readme), artifactBytes, tempRoot);
  assert.equal(wrongBytes.code, 1, wrongBytes.stdout + wrongBytes.stderr);
  assert.match(wrongBytes.stderr, /^REFUSE artifact_digest_mismatch: installer is \d+ bytes, published length is \d+$/m);
  t.diagnostic(`README byte count altered by one digit (exit ${wrongBytes.code}): ${wrongBytes.stderr.trim()}`);

  const absentCommand = runDocumentedInstaller(readme.replace(/^\$ \.\/seal-.* --prefix ~\/\.local$/m, ""), artifactBytes, tempRoot);
  assert.equal(absentCommand.code, 1, absentCommand.stdout + absentCommand.stderr);
  assert.equal(absentCommand.stderr, "REFUSE readme_install_command_absent: README.md has no concrete published install command\n");
  t.diagnostic(`README install command removed entirely (exit ${absentCommand.code}): ${absentCommand.stderr.trim()}`);
});
