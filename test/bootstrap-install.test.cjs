// SPDX-License-Identifier: Apache-2.0
// End-to-end behaviour of the bootstrap installer (scripts/bootstrap-install.cjs,
// wrapped by scripts/generate-bootstrap.mjs). These tests exercise the GENERATED
// artifact exactly as a stranger would run it: `sh <bootstrap> [--prefix P]`
// talking to a real HTTP server, never the CommonJS module in-process. The
// download endpoint is redirected with SEAL_BOOTSTRAP_DOWNLOAD_BASE_URL, the
// one test-only seam the bootstrap exposes; production users never set it.
"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const test = require("node:test");
const { testTmpdir } = require("../scripts/temp-root.cjs");

const ROOT = path.join(__dirname, "..");
const BUILD = path.join(ROOT, "scripts", "build-dist.cjs");
const GENERATE = path.join(ROOT, "scripts", "generate-bootstrap.mjs");
const VERSION = fs.readFileSync(path.join(ROOT, "VERSION"), "utf8").trim();

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

// Deliberately ASYNC (child_process.spawn + a Promise), never spawnSync.
// Several tests below run an in-process HTTP server (serveAssets) that the
// spawned bootstrap child talks to over real loopback TCP. spawnSync blocks
// this process's entire event loop until the child exits, including the
// loop that the in-process HTTP server needs to accept and answer that very
// connection -- so a synchronous spawn here would deadlock every scenario
// where the child successfully reaches the server, and only fail because
// spawnSync's own timeout guard eventually kills the child. Only a
// genuinely unreachable/no-response child would ever look interesting under
// spawnSync; that is not what most of these tests are exercising.
function run(command, args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, options);
    let stdout = "";
    let stderr = "";
    let settled = false;
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    const timer = setTimeout(() => {
      if (settled) return;
      child.kill("SIGKILL");
    }, options.timeout ?? 30000);
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code: null, stdout, stderr, error });
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code, stdout, stderr, error: undefined });
    });
  });
}

// Builds the one platform artifact this host can actually build and run
// (linux-x64), then a schema seal.release/v2 manifest naming it truthfully
// alongside two SHAPE-valid but inert darwin placeholders (this box cannot
// build or execute a macOS payload; macos.yml covers real Darwin builds).
// generate-bootstrap.mjs re-validates this manifest with the exact validator
// scripts/generate-release-docs.mjs already trusts, so a shape defect here
// would fail generation, not slip through.
async function buildFixture(root) {
  const out = testTmpdir(path.join(os.tmpdir(), "seal-bootstrap-fixture-"));
  const dist = path.join(out, "dist");
  const built = await run(process.execPath, [BUILD, "--out", dist], { cwd: root });
  assert.equal(built.code, 0, `${built.stdout}${built.stderr}`);
  const [digest, bytes, name] = fs.readFileSync(path.join(dist, "SHA256SUMS"), "utf8").trim().split(/\s+/);
  const artifactPath = path.join(dist, name);
  const checkerPath = path.join(dist, "seal-receipt-v2.mjs");
  fs.copyFileSync(path.join(root, "checker", "seal-receipt-v2.mjs"), checkerPath);
  const checkerBytes = fs.readFileSync(checkerPath);
  const sumsPath = path.join(dist, "SHA256SUMS");
  const manifest = {
    schema: "seal.release/v2",
    tag: `v${VERSION}`,
    commitSha: "0".repeat(40),
    minimumNodeMajor: 20,
    artifacts: [
      { platform: "darwin-arm64", name: `seal-v${VERSION}-darwin-arm64`, sha256: "b".repeat(64), bytes: 100, installedTreeSha256: "c".repeat(64), nativeHelperProvenance: "release-produced, not independently reproduced" },
      { platform: "darwin-x64", name: `seal-v${VERSION}-darwin-x64`, sha256: "d".repeat(64), bytes: 101, installedTreeSha256: "e".repeat(64), nativeHelperProvenance: "release-produced, not independently reproduced" },
      // `name` names the file build-dist.cjs actually produced on this checkout
      // (an untagged commit wears a `-dev.g<sha>` identity; see
      // scripts/product-identity.cjs), not a fabricated release name, so the
      // test server below can serve it under the exact name the bootstrap
      // requests.
      { platform: "linux-x64", name, sha256: digest, bytes: Number(bytes), installedTreeSha256: "a".repeat(64) },
    ],
    checker: { name: "seal-receipt-v2.mjs", sha256: sha256(checkerBytes), bytes: checkerBytes.length },
    checksums: { name: "SHA256SUMS", sha256: sha256(fs.readFileSync(sumsPath)) },
  };
  const manifestPath = path.join(out, "release-manifest.json");
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

  const bootstrapOut = path.join(out, "bootstrap-dist");
  const generated = await run(process.execPath, [GENERATE, "--manifest", manifestPath, "--out", bootstrapOut], { cwd: root });
  assert.equal(generated.code, 0, `${generated.stdout}${generated.stderr}`);
  const bootstrapPath = path.join(bootstrapOut, `seal-bootstrap-v${VERSION}`);
  assert.ok(fs.existsSync(bootstrapPath), generated.stdout);

  return { out, artifactPath, artifactName: name, artifactBytes: Number(bytes), artifactDigest: digest, bootstrapPath, manifest };
}

// A tiny HTTP server standing in for the real release host. `bytesFor` maps
// a requested asset name to the bytes to serve (or `undefined` for a 404),
// letting each test simulate one failure shape without touching the network.
function serveAssets(bytesFor, { truncate = false, delayMs = 0 } = {}) {
  const requests = [];
  const server = http.createServer((req, res) => {
    const name = decodeURIComponent(req.url.split("/").pop());
    requests.push(name);
    const bytes = bytesFor(name);
    if (bytes === undefined) {
      res.writeHead(404);
      res.end("not found");
      return;
    }
    const send = () => {
      res.writeHead(200, { "content-length": String(bytes.length) });
      if (truncate) {
        res.write(bytes.subarray(0, Math.floor(bytes.length / 2)));
        res.socket.destroy();
        return;
      }
      res.end(bytes);
    };
    if (delayMs) setTimeout(send, delayMs);
    else send();
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve({
      server,
      requests,
      baseUrl: `http://127.0.0.1:${server.address().port}`,
      close: () => new Promise((done) => server.close(done)),
    }));
  });
}

function snapshotBootstrapTmp() {
  return fs.readdirSync(os.tmpdir(), { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith("seal-bootstrap-"))
    .map((entry) => entry.name);
}

test("bootstrap downloads, verifies, and installs, printing location, version, PATH guidance, and seal demo", async () => {
  const fixture = await buildFixture(ROOT);
  const home = path.join(fixture.out, "home");
  fs.mkdirSync(home);
  const asset = await serveAssets((name) => (name === fixture.artifactName ? fs.readFileSync(fixture.artifactPath) : undefined));
  try {
    const before = snapshotBootstrapTmp();
    const result = await run("sh", [fixture.bootstrapPath], {
      env: { ...process.env, HOME: home, SEAL_BOOTSTRAP_DOWNLOAD_BASE_URL: asset.baseUrl },
    });
    assert.equal(result.code, 0, `${result.stdout}${result.stderr}`);
    assert.deepEqual(asset.requests, [fixture.artifactName]);
    assert.match(result.stdout, new RegExp(`installed seal ${VERSION} linux-x64`));
    assert.match(result.stdout, /store: .*\/\.local\/lib\/seal\/store\//);
    assert.match(result.stdout, /command: .*\/\.local\/bin\/seal/);
    assert.match(result.stdout, /export PATH=.*\.local\/bin/);
    assert.match(result.stdout, /seal demo/);
    assert.ok(fs.existsSync(path.join(home, ".local", "bin", "seal")), "default prefix must be under $HOME/.local with no admin path involved");
    assert.deepEqual(snapshotBootstrapTmp(), before, "the bootstrap's own temporary download directory must not survive success");
  } finally {
    await asset.close();
  }
});

test("corrupted product artifact bytes are refused before execution, and nothing is installed", async () => {
  const fixture = await buildFixture(ROOT);
  const home = path.join(fixture.out, "home-corrupt");
  fs.mkdirSync(home);
  const original = fs.readFileSync(fixture.artifactPath);
  const corrupted = Buffer.from(original);
  corrupted[1000] ^= 0xff; // one byte, same length: proves the digest check, not just a length check
  const asset = await serveAssets((name) => (name === fixture.artifactName ? corrupted : undefined));
  try {
    const before = snapshotBootstrapTmp();
    const result = await run("sh", [fixture.bootstrapPath], {
      env: { ...process.env, HOME: home, SEAL_BOOTSTRAP_DOWNLOAD_BASE_URL: asset.baseUrl },
    });
    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /^REFUSE artifact_digest_mismatch:/m);
    assert.equal(result.stdout, "", "a refused download must print nothing that looks like a successful install");
    assert.equal(fs.existsSync(path.join(home, ".local")), false, "nothing may be installed when the downloaded artifact fails its own check");
    assert.deepEqual(snapshotBootstrapTmp(), before, "temporary download directory must be cleaned up on refusal");
  } finally {
    await asset.close();
  }
});

test("truncated download is refused cleanly and temporary files are cleaned up", async () => {
  const fixture = await buildFixture(ROOT);
  const home = path.join(fixture.out, "home-truncated");
  fs.mkdirSync(home);
  const bytes = fs.readFileSync(fixture.artifactPath);
  const asset = await serveAssets((name) => (name === fixture.artifactName ? bytes : undefined), { truncate: true });
  try {
    const before = snapshotBootstrapTmp();
    const result = await run("sh", [fixture.bootstrapPath], {
      env: { ...process.env, HOME: home, SEAL_BOOTSTRAP_DOWNLOAD_BASE_URL: asset.baseUrl },
    });
    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /^REFUSE (download_failed|artifact_truncated):/m);
    assert.equal(fs.existsSync(path.join(home, ".local")), false);
    assert.deepEqual(snapshotBootstrapTmp(), before);
  } finally {
    await asset.close();
  }
});

test("a download that exceeds the published length is aborted mid-stream, not merely rejected at the end", async () => {
  const fixture = await buildFixture(ROOT);
  const home = path.join(fixture.out, "home-oversized");
  fs.mkdirSync(home);
  const oversized = Buffer.concat([fs.readFileSync(fixture.artifactPath), Buffer.alloc(64 * 1024 * 1024, 1)]);
  const asset = await serveAssets((name) => (name === fixture.artifactName ? oversized : undefined));
  try {
    const started = performance.now();
    const result = await run("sh", [fixture.bootstrapPath], {
      env: { ...process.env, HOME: home, SEAL_BOOTSTRAP_DOWNLOAD_BASE_URL: asset.baseUrl },
    });
    const elapsedMs = performance.now() - started;
    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /^REFUSE artifact_oversized:/m);
    assert.equal(fs.existsSync(path.join(home, ".local")), false);
    // Weak but real timing evidence that the stream was cut, not read to completion first.
    assert.ok(elapsedMs < 15000, `oversized download should abort quickly; took ${elapsedMs}ms`);
  } finally {
    await asset.close();
  }
});

test("an unreachable host is refused cleanly with an actionable message", async () => {
  const fixture = await buildFixture(ROOT);
  const home = path.join(fixture.out, "home-unreachable");
  fs.mkdirSync(home);
  const before = snapshotBootstrapTmp();
  const result = await run("sh", [fixture.bootstrapPath], {
    // Port 1 is a reserved, unlisenable TCP port: nothing will ever answer here.
    env: { ...process.env, HOME: home, SEAL_BOOTSTRAP_DOWNLOAD_BASE_URL: "http://127.0.0.1:1" },
  });
  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /^REFUSE download_failed:/m);
  assert.match(result.stderr, /check your network connection/);
  assert.equal(fs.existsSync(path.join(home, ".local")), false);
  assert.deepEqual(snapshotBootstrapTmp(), before);
});

test("an unsupported platform is refused before any network request is made", async () => {
  const fixture = await buildFixture(ROOT);
  const home = path.join(fixture.out, "home-unsupported");
  fs.mkdirSync(home);
  const asset = await serveAssets(() => fs.readFileSync(fixture.artifactPath));
  try {
    const before = snapshotBootstrapTmp();
    const result = await run("sh", [fixture.bootstrapPath], {
      env: {
        ...process.env, HOME: home, SEAL_BOOTSTRAP_DOWNLOAD_BASE_URL: asset.baseUrl,
        SEAL_SPINE_PLATFORM: "win32", SEAL_SPINE_ARCH: "x64",
      },
    });
    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /^REFUSE unsupported_platform:/m);
    assert.match(result.stderr, /No files were changed/);
    assert.deepEqual(asset.requests, [], "an unsupported platform must be refused before any download starts");
    assert.equal(fs.existsSync(path.join(home, ".local")), false);
    assert.deepEqual(snapshotBootstrapTmp(), before);
  } finally {
    await asset.close();
  }
});

test("a missing Node prerequisite is refused with an actionable message and no partial state", async () => {
  const fixture = await buildFixture(ROOT);
  const home = path.join(fixture.out, "home-no-node");
  fs.mkdirSync(home);
  const before = snapshotBootstrapTmp();
  // Strip every directory that could contain a `node` binary from PATH,
  // while still allowing /bin/sh itself (invoked by absolute path) to run.
  const result = await run("/bin/sh", [fixture.bootstrapPath], {
    env: { HOME: home, PATH: "/seal-test-empty-path" },
  });
  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /^REFUSE node_missing: this installer requires Node/m);
  assert.equal(result.stdout, "");
  assert.equal(fs.existsSync(path.join(home, ".local")), false, "a missing prerequisite must not change any installation state");
  assert.deepEqual(snapshotBootstrapTmp(), before);
});

test("running the bootstrap twice preserves install.cjs's own reinstall semantics, with no second code path", async () => {
  const fixture = await buildFixture(ROOT);
  const home = path.join(fixture.out, "home-reinstall");
  fs.mkdirSync(home);
  const asset = await serveAssets((name) => (name === fixture.artifactName ? fs.readFileSync(fixture.artifactPath) : undefined));
  try {
    const env = { ...process.env, HOME: home, SEAL_BOOTSTRAP_DOWNLOAD_BASE_URL: asset.baseUrl };
    const first = await run("sh", [fixture.bootstrapPath], { env });
    assert.equal(first.code, 0, `${first.stdout}${first.stderr}`);
    const recordPath = path.join(home, ".local", "lib", "seal", "install.json");
    const storeSha = JSON.parse(fs.readFileSync(recordPath, "utf8")).treeSha256;
    const storeMode = fs.statSync(path.join(home, ".local", "lib", "seal", "store", storeSha)).mode & 0o777;
    assert.equal(storeMode, 0o555, "install.cjs's own immutable-store guarantee must survive the bootstrap handoff");
    const second = await run("sh", [fixture.bootstrapPath], { env });
    assert.equal(second.code, 0, `${second.stdout}${second.stderr}`);
    assert.deepEqual(asset.requests, [fixture.artifactName, fixture.artifactName]);
    const launched = await run(process.execPath, [path.join(home, ".local", "bin", "seal"), "--version"]);
    assert.equal(launched.code, 0, `${launched.stdout}${launched.stderr}`);
    assert.equal(launched.stdout.trim(), VERSION);
  } finally {
    await asset.close();
  }
});

test("selecting an artifact trusts the running process's own architecture, not a Rosetta-translation probe", async () => {
  // On Apple Silicon, an x64 Node binary translated under Rosetta still
  // reports process.arch "x64" -- correctly, because that IS the ABI its
  // native pieces must match. This test proves the bootstrap does not
  // "correct" that with a host-chip probe: forcing Rosetta detection on must
  // not change which artifact gets fetched. See scripts/bootstrap-install.cjs
  // for the design rationale.
  const fixture = await buildFixture(ROOT);
  const home = path.join(fixture.out, "home-rosetta");
  fs.mkdirSync(home);
  const darwinX64 = fixture.manifest.artifacts.find((entry) => entry.platform === "darwin-x64");
  const fakeBytes = Buffer.alloc(darwinX64.bytes, 0x41);
  // The fixture's darwin-x64 sha256 is a placeholder ("d".repeat(64)), so
  // regenerate a bootstrap whose embedded digest actually matches bytes we
  // can serve, without needing a real macOS build on this host.
  const manifest = JSON.parse(JSON.stringify(fixture.manifest));
  const entry = manifest.artifacts.find((candidate) => candidate.platform === "darwin-x64");
  entry.sha256 = sha256(fakeBytes);
  entry.bytes = fakeBytes.length;
  const manifestPath = path.join(fixture.out, "rosetta-manifest.json");
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  const bootstrapOut = path.join(fixture.out, "rosetta-bootstrap-dist");
  const generated = await run(process.execPath, [GENERATE, "--manifest", manifestPath, "--out", bootstrapOut], { cwd: ROOT });
  assert.equal(generated.code, 0, `${generated.stdout}${generated.stderr}`);
  const bootstrapPath = path.join(bootstrapOut, `seal-bootstrap-v${VERSION}`);

  const asset = await serveAssets((name) => (name === entry.name ? fakeBytes : undefined));
  try {
    const result = await run("sh", [bootstrapPath], {
      env: {
        ...process.env, HOME: home, SEAL_BOOTSTRAP_DOWNLOAD_BASE_URL: asset.baseUrl,
        SEAL_SPINE_PLATFORM: "darwin", SEAL_SPINE_ARCH: "x64", SEAL_BOOTSTRAP_FORCE_ROSETTA: "1",
      },
    });
    assert.deepEqual(asset.requests, [entry.name], "must fetch the darwin-x64 asset matching process.arch, not darwin-arm64");
    assert.match(result.stderr, /NOTE: this Node process is running translated under Rosetta/);
    assert.match(result.stdout, new RegExp(`Verified ${entry.name}: sha256 ${entry.sha256}`));
  } finally {
    await asset.close();
  }
});
