// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import test from "node:test";

const ROOT = resolve(import.meta.dirname, "..");
const GUARD = join(ROOT, "scripts/live-page-claim-guard.mjs");
const originalReadme = readFileSync(join(ROOT, "README.md"), "utf8");
const PIN_COMMIT = "fixturecommit";

async function withPage(body, fn) {
  const server = createServer((_request, response) => response.end(body));
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  try { return await fn(`http://127.0.0.1:${server.address().port}/`); }
  finally { await new Promise((done) => server.close(done)); }
}
function run(url, readme = originalReadme, pinBody = "<html></html>", provenanceUrl = undefined, { productionPin = false, cacheDir = undefined, commit = PIN_COMMIT } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "live-page-claim-guard-"));
  const path = join(dir, "README.md");
  writeFileSync(path, readme);
  const runnerTemp = cacheDir ?? join(dir, "cache");
  mkdirSync(runnerTemp, { recursive: true });
  const env = { ...process.env };
  if (productionPin) {
    for (const name of ["LIVE_CLAIM_GUARD_URL", "LIVE_CLAIM_GUARD_README", "LIVE_CLAIM_GUARD_COMMIT", "LIVE_CLAIM_GUARD_BYTES", "LIVE_CLAIM_GUARD_SHA256", "LIVE_CLAIM_GUARD_PROVENANCE_URL"]) delete env[name];
  } else {
    Object.assign(env, {
      LIVE_CLAIM_GUARD_URL: url, LIVE_CLAIM_GUARD_README: path,
      LIVE_CLAIM_GUARD_COMMIT: commit,
      LIVE_CLAIM_GUARD_BYTES: String(Buffer.byteLength(pinBody)),
      LIVE_CLAIM_GUARD_SHA256: createHash("sha256").update(pinBody).digest("hex"),
      LIVE_CLAIM_GUARD_PROVENANCE_URL: provenanceUrl ?? url,
      RUNNER_TEMP: runnerTemp,
    });
  }
  const child = spawn(process.execPath, [GUARD], { env });
  let stdout = "", stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  return new Promise((done, reject) => child.on("error", reject).on("close", (status) => {
    rmSync(dir, { recursive: true, force: true });
    done({ status, stdout, stderr });
  }));
}

test("passes when fetched controls, README population, and pin agree", async () => {
  await withPage("<html></html>", async (url) => {
    const result = await run(url);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, new RegExp(`PASS  served bytes match pinned seal-check@${PIN_COMMIT}`));
  });
});

test("passes against the real production pin without environment overrides [network required]", async () => {
  const result = await run(undefined, undefined, undefined, undefined, { productionPin: true });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /PASS  served bytes match pinned seal-check@e152a053637845600e1eceaee70cea873801c609/);
});

test("fails and names a fetched button disagreement", async () => {
  const body = "<html><button>Run</button></html>";
  await withPage(body, async (url) => {
    const result = await run(url, originalReadme, body);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /landing page has 1 <button> controls; README claims zero/);
  });
});

test("fails with pinned provenance and a changed-region diagnostic", async () => {
  await withPage("<html></html>", async (provenanceUrl) => {
    await withPage("<html>new release</html>", async (url) => {
    const result = await run(url, originalReadme, "<html></html>", provenanceUrl);
    assert.equal(result.status, 1);
    assert.match(result.stderr, new RegExp(`served landing page differs from seal-check@${PIN_COMMIT}`));
    assert.match(result.stderr, /Confirm the candidate release's provenance before repinning/);
    assert.match(result.stderr, /DIFF  first changed region near byte/);
    assert.match(result.stderr, /- pinned/);
    assert.match(result.stderr, /\+ served/);
    });
  });
});

test("fails closed when pinned release provenance is unreachable", async () => {
  await withPage("<html>new release</html>", async (url) => {
    const result = await run(url, originalReadme, "<html></html>", "http://127.0.0.1:1/");
    assert.equal(result.status, 2);
    assert.match(result.stderr, /PINNED SEAL-CHECK PROVENANCE TRANSIENTLY UNREACHABLE/);
  });
});

test("names a wrong pinned commit as a substantive provenance mismatch", async () => {
  const server = createServer((_request, response) => { response.statusCode = 404; response.end("not found"); });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  try {
    await withPage("<html></html>", async (url) => {
      const provenanceUrl = `http://127.0.0.1:${server.address().port}/`;
      const result = await run(url, originalReadme, "<html></html>", provenanceUrl, { commit: "forgedcommit" });
      assert.equal(result.status, 2);
      assert.match(result.stderr, /PINNED SEAL-CHECK PROVENANCE MISMATCH/);
    });
  } finally {
    await new Promise((done) => server.close(done));
  }
});

test("names HTTP 429 as transient provenance uncertainty", async () => {
  const server = createServer((_request, response) => { response.statusCode = 429; response.end("rate limited"); });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  try {
    await withPage("<html></html>", async (url) => {
      const provenanceUrl = `http://127.0.0.1:${server.address().port}/`;
      const result = await run(url, originalReadme, "<html></html>", provenanceUrl);
      assert.equal(result.status, 2);
      assert.match(result.stderr, /PINNED SEAL-CHECK PROVENANCE TRANSIENTLY UNREACHABLE.*HTTP 429/);
    });
  } finally {
    await new Promise((done) => server.close(done));
  }
});

test("uses the commit-keyed pinned-source cache without a second provenance fetch", async () => {
  let requests = 0;
  const body = "<html></html>";
  const server = createServer((_request, response) => { requests += 1; response.end(body); });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  const cacheDir = mkdtempSync(join(tmpdir(), "live-page-claim-guard-cache-"));
  try {
    const url = `http://127.0.0.1:${server.address().port}/`;
    const first = await run(url, originalReadme, body, url, { cacheDir });
    const second = await run(url, originalReadme, body, url, { cacheDir });
    assert.equal(first.status, 0, first.stderr);
    assert.equal(second.status, 0, second.stderr);
    assert.equal(requests, 3, "second run must fetch only the live page, not pinned provenance");
    assert.match(second.stdout, /Pinned source cache hit.*no provenance fetch/);
  } finally {
    rmSync(cacheDir, { recursive: true, force: true });
    await new Promise((done) => server.close(done));
  }
});

test("fails closed on poisoned cache bytes under the right commit key", async () => {
  const body = "<html></html>";
  const cacheDir = mkdtempSync(join(tmpdir(), "live-page-claim-guard-cache-"));
  const cachePath = join(cacheDir, "live-page-claim-guard", `${encodeURIComponent(PIN_COMMIT)}.index.html`);
  mkdirSync(join(cacheDir, "live-page-claim-guard"), { recursive: true });
  writeFileSync(cachePath, "poisoned bytes");
  try {
    await withPage(body, async (url) => {
      const result = await run(url, originalReadme, body, url, { cacheDir });
      assert.equal(result.status, 2);
      assert.match(result.stderr, /PINNED SEAL-CHECK PROVENANCE MISMATCH.*poisoned cache/);
      assert.doesNotMatch(result.stdout, /Fetching pinned seal-check/);
    });
  } finally {
    rmSync(cacheDir, { recursive: true, force: true });
  }
});

test("fails when a README behaviour sentence is outside the checked population", async () => {
  await withPage("<html></html>", async (url) => {
    const result = await run(url, `${originalReadme}\n[unmarked](${"https://velvetmonkey.github.io/seal-check/"}) describes the page.\n`);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /outside .*checked population/);
  });
});

test("fails closed when the live page is unreachable", async () => {
  const result = await run("http://127.0.0.1:1/");
  assert.equal(result.status, 2);
  assert.match(result.stderr, /LIVE PAGE UNREACHABLE/);
});
