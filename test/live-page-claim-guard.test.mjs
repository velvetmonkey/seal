// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import test from "node:test";

const ROOT = resolve(import.meta.dirname, "..");
const GUARD = join(ROOT, "scripts/live-page-claim-guard.mjs");
const originalReadme = readFileSync(join(ROOT, "README.md"), "utf8");

async function withPage(body, fn) {
  const server = createServer((_request, response) => response.end(body));
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  try { return await fn(`http://127.0.0.1:${server.address().port}/`); }
  finally { await new Promise((done) => server.close(done)); }
}
function run(url, readme = originalReadme, pinBody = "<html></html>") {
  const dir = mkdtempSync(join(tmpdir(), "live-page-claim-guard-"));
  const path = join(dir, "README.md");
  writeFileSync(path, readme);
  const child = spawn(process.execPath, [GUARD], { env: {
    ...process.env, LIVE_CLAIM_GUARD_URL: url, LIVE_CLAIM_GUARD_README: path,
    LIVE_CLAIM_GUARD_BYTES: String(Buffer.byteLength(pinBody)),
    LIVE_CLAIM_GUARD_SHA256: createHash("sha256").update(pinBody).digest("hex"),
  }});
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
    assert.match(result.stdout, /PASS  served bytes match pinned seal-check@a67abf7/);
  });
});

test("fails and names a fetched button disagreement", async () => {
  const body = "<html><button>Run</button></html>";
  await withPage(body, async (url) => {
    const result = await run(url, originalReadme, body);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /landing page has 1 <button> controls; README claims zero/);
  });
});

test("fails and names a served-byte disagreement with the release pin", async () => {
  await withPage("<html>new release</html>", async (url) => {
    const result = await run(url);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /served landing page differs from seal-check@a67abf7/);
    assert.match(result.stderr, /To repin after reviewing a deliberate seal-check release/);
  });
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
