// SPDX-License-Identifier: Apache-2.0
// The release asset is the product. The root SHA256SUMS is only a forbidden
// duplicate when it names an unpublished artifact; release-time generation
// owns the authoritative copy.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const https = require("node:https");
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
  const absent = fs.mkdtempSync(path.join(require("node:os").tmpdir(), "seal-root-pin-"));
  const result = run(path.join(absent, "SHA256SUMS"));
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /^PASS root release pin absent:/);
});

test("an empty root pin passes between releases", () => {
  const empty = path.join(fs.mkdtempSync(path.join(require("node:os").tmpdir(), "seal-root-pin-")), "SHA256SUMS");
  fs.writeFileSync(empty, "\n");
  const result = run(empty);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /^PASS root release pin empty:/);
});

test("an unreadable root pin refuses by name", () => {
  const directory = fs.mkdtempSync(path.join(require("node:os").tmpdir(), "seal-root-pin-"));
  const result = run(directory);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /^REFUSE root_release_pin: cannot read .*SHA256SUMS|^REFUSE root_release_pin: cannot read /);
});

function readReadmeInstallPin() {
  const lines = fs.readFileSync(README, "utf8").split(/\n/);
  const commandPattern = /^(?<artifact>\.\/seal-(?<tag>v\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?)-linux-x64) --sha256 (?<sha256>[0-9a-f]{64}) --bytes (?<bytes>\d+) --prefix ~\/\.local$/;
  const matches = [];
  for (const [index, line] of lines.entries()) {
    const match = line.match(commandPattern);
    if (match) matches.push({ line: index + 1, ...match.groups });
  }
  assert.equal(matches.length, 1, `README.md must contain exactly one concrete published install command, found ${matches.length}`);
  return matches[0];
}

function fetchText(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, { headers: { "user-agent": "seal-dist-pin-test" } }, (response) => {
      if (
        response.statusCode >= 300 &&
        response.statusCode < 400 &&
        response.headers.location &&
        redirects < 5
      ) {
        response.resume();
        resolve(fetchText(new URL(response.headers.location, url).toString(), redirects + 1));
        return;
      }
      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`cannot fetch published SHA256SUMS from ${url}: HTTP ${response.statusCode}`));
        return;
      }
      response.setEncoding("utf8");
      let body = "";
      response.on("data", (chunk) => {
        body += chunk;
      });
      response.on("end", () => resolve(body));
    });
    request.setTimeout(30000, () => {
      request.destroy(new Error(`cannot fetch published SHA256SUMS from ${url}: timeout`));
    });
    request.on("error", (error) => {
      reject(new Error(`cannot fetch published SHA256SUMS from ${url}: ${error.message}`));
    });
  });
}

function parsePublishedSums(text, expectedArtifact) {
  const rows = text.trim().split(/\n/).map((line) => line.trim().split(/\s+/));
  const row = rows.find((fields) => fields[2] === expectedArtifact);
  assert.ok(row, `published SHA256SUMS does not name ${expectedArtifact}`);
  assert.match(row[0], /^[0-9a-f]{64}$/, "published SHA256SUMS digest is malformed");
  assert.match(row[1], /^\d+$/, "published SHA256SUMS byte count is malformed");
  return { sha256: row[0], bytes: row[1], artifact: row[2] };
}

test("README install pin matches the published release SHA256SUMS asset", async () => {
  const readme = readReadmeInstallPin();
  const artifact = readme.artifact.slice(2);
  const url = `https://github.com/velvetmonkey/seal/releases/download/${readme.tag}/SHA256SUMS`;
  const published = parsePublishedSums(await fetchText(url), artifact);
  const location = `README.md:${readme.line}`;

  assert.equal(readme.sha256, published.sha256, `${location}: README --sha256 ${readme.sha256} does not match published ${published.sha256}`);
  assert.equal(readme.bytes, published.bytes, `${location}: README --bytes ${readme.bytes} does not match published ${published.bytes}`);
  assert.equal(artifact, published.artifact, `${location}: README artifact ${artifact} does not match published ${published.artifact}`);
});
