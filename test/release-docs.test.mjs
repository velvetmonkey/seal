// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import test from "node:test";
import { LEGACY_RELEASE_TAGS, sha256 } from "../scripts/release-manifest-lib.mjs";
import tempRoot from "../scripts/temp-root.cjs";
const { testTmpdir } = tempRoot;

const ROOT = path.join(import.meta.dirname, "..");
const VERSION = fs.readFileSync(path.join(ROOT, "VERSION"), "utf8").trim();
const VERSION_PATTERN = VERSION.replaceAll(".", "\\.");
const GENERATOR = path.join(ROOT, "scripts", "generate-release-docs.mjs");
const MACOS_PROTECT_CLAIMS = path.join(ROOT, "scripts", "check-macos-protect-claims.mjs");
const COMMIT = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

function run(args, env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [GENERATOR, ...args], {
      cwd: ROOT,
      env: { ...process.env, ...env },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

function docsRoot() {
  const root = testTmpdir(path.join(os.tmpdir(), "seal-release-docs-"));
  fs.copyFileSync(path.join(ROOT, "README.md"), path.join(root, "README.md"));
  fs.cpSync(path.join(ROOT, "docs"), path.join(root, "docs"), { recursive: true });
  for (const directory of ["bin", "scripts", "spine"]) fs.mkdirSync(path.join(root, directory), { recursive: true });
  fs.copyFileSync(path.join(ROOT, "bin", "seal"), path.join(root, "bin", "seal"));
  fs.copyFileSync(path.join(ROOT, "scripts", "claims-drift.mjs"), path.join(root, "scripts", "claims-drift.mjs"));
  fs.copyFileSync(path.join(ROOT, "spine", "platform.cjs"), path.join(root, "spine", "platform.cjs"));
  return root;
}

function releaseAssets(tag) {
  const directory = testTmpdir(path.join(os.tmpdir(), "seal-release-assets-"));
  const source = testTmpdir(path.join(os.tmpdir(), "seal-release-source-"));
  const archive = spawnSync("git", ["archive", "--format=tar", tag], { cwd: ROOT, maxBuffer: 128 * 1024 * 1024 });
  assert.equal(archive.status, 0, archive.stderr?.toString() || `cannot archive ${tag}`);
  const extracted = spawnSync("tar", ["-xf", "-", "-C", source], { input: archive.stdout, maxBuffer: 128 * 1024 * 1024 });
  assert.equal(extracted.status, 0, extracted.stderr?.toString() || `cannot extract ${tag}`);
  for (const args of [
    ["init", "-q"],
    ["config", "user.name", "release fixture"],
    ["config", "user.email", "release-fixture@example.invalid"],
    ["add", "."],
    ["commit", "-qm", `fixture ${tag}`],
    ["tag", tag],
  ]) {
    const git = spawnSync("git", args, { cwd: source, encoding: "utf8" });
    assert.equal(git.status, 0, git.stderr);
  }
  const build = spawnSync(process.execPath, [path.join(source, "scripts", "build-dist.cjs"), "--out", directory], {
    cwd: source,
    encoding: "utf8",
  });
  assert.equal(build.status, 0, build.stderr);
  const builtName = fs.readdirSync(directory).find((name) => /^seal-v.*-linux-x64$/.test(name));
  assert.ok(builtName);
  const artifactName = `seal-${tag}-linux-x64`;
  assert.equal(builtName, artifactName);
  const checkerName = "seal-receipt-check.mjs";
  fs.writeFileSync(path.join(directory, checkerName), "historical v0.2.0-rc.3 checker fixture\n");
  const checkerBytes = fs.readFileSync(path.join(directory, checkerName));
  const checkerLine = `${sha256(checkerBytes)}  ${checkerBytes.length}  ${checkerName}\n`;
  const artifactBytes = fs.readFileSync(path.join(directory, artifactName));
  fs.writeFileSync(
    path.join(directory, "SHA256SUMS"),
    `${sha256(artifactBytes)}  ${artifactBytes.length}  ${artifactName}\n${checkerLine}`,
  );
  const bytes = Object.fromEntries([artifactName, checkerName, "SHA256SUMS"].map((name) => [name, fs.readFileSync(path.join(directory, name))]));
  return { artifactName, checkerName, bytes };
}

async function withReleaseServer(release, bytes, callback) {
  const server = http.createServer((request, response) => {
    if (request.url === "/releases") {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify([release]));
      return;
    }
    const name = decodeURIComponent(request.url.slice("/asset/".length));
    if (request.url.startsWith("/asset/") && bytes[name]) {
      response.end(bytes[name]);
      return;
    }
    response.statusCode = 404;
    response.end("absent");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    const base = `http://127.0.0.1:${address.port}`;
    release.assets = release.assets.map((asset) => ({ ...asset, browser_download_url: `${base}/asset/${encodeURIComponent(asset.name)}` }));
    await callback(`${base}/releases`);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

test("legacy docs state release-listing facts and check compares claims with that release", async () => {
  const assets = releaseAssets("v0.2.0-rc.3");
  const release = {
    id: 3,
    tag_name: "v0.2.0-rc.3",
    draft: false,
    published_at: "2026-08-26T15:00:43Z",
    assets: Object.keys(assets.bytes).map((name) => ({ name })),
  };
  await withReleaseServer(release, assets.bytes, async (api) => {
    const docs = docsRoot();
    const env = {
      SEAL_RELEASE_DOCS_ROOT: docs,
      SEAL_RELEASES_API_URL: api,
      SEAL_RELEASE_TAG_COMMIT: COMMIT,
    };
    const generated = await run([], env);
    assert.equal(generated.code, 0, generated.stderr);
    const claims = spawnSync(process.execPath, [MACOS_PROTECT_CLAIMS], {
      cwd: docs,
      encoding: "utf8",
      env: { ...process.env, SEAL_MACOS_PROTECT_CLAIMS_ROOT: docs },
    });
    assert.equal(
      claims.status,
      0,
      `release docs generator emitted a macOS Protect sentence that spine/platform.cjs does not carry, or omitted the live install-guide support sentence\n${claims.stderr}`,
    );
    const readme = fs.readFileSync(path.join(docs, "README.md"), "utf8");
    assert.match(readme, new RegExp("The current source is the unreleased `v" + VERSION_PATTERN + "` candidate\\. The install commands below fetch the\\s*> published `v0\\.2\\.0-rc\\.3`, which carries the previous receipt format and Linux-only Protect support\\."));
    const equalVersion = await run([], { ...env, SEAL_RELEASE_SOURCE_VERSION: "0.2.0-rc.3" });
    assert.equal(equalVersion.code, 0, equalVersion.stderr);
    assert.doesNotMatch(fs.readFileSync(path.join(docs, "README.md"), "utf8"), /The current source is the unreleased/);
    console.log("TAMPER equal-version: divergence block absent");
    const restoredVersion = await run([], env);
    assert.equal(restoredVersion.code, 0, restoredVersion.stderr);
    assert.match(fs.readFileSync(path.join(docs, "README.md"), "utf8"), new RegExp("The current source is the unreleased `v" + VERSION_PATTERN + "` candidate"));
    console.log("RESTORE divergent versions: divergence block present");
    const install = fs.readFileSync(path.join(docs, "docs", "start", "install.md"), "utf8");
    assert.ok(
      install.includes(`publishes \`${assets.artifactName}\`, \`seal-receipt-check.mjs\`, and \`SHA256SUMS\`; its tag resolves to commit`),
      install,
    );
    assert.doesNotMatch(install, /release-manifest\.json|seal\.release\/v1/);

    const clean = await run(["--check"], env);
    assert.equal(clean.code, 0, clean.stderr);
    assert.match(clean.stdout, /PASS release docs match latest published release v0\.2\.0-rc\.3/);

    fs.writeFileSync(
      path.join(docs, "docs", "start", "install.md"),
      install.replace("# Install Seal v0.2.0-rc.3", "# Install Seal v0.2.0-rc.3\nIts `release-manifest.json` uses schema `seal.release/v1`."),
    );
    const inventedManifest = await run(["--check"], env);
    assert.equal(inventedManifest.code, 1, inventedManifest.stdout + inventedManifest.stderr);
    assert.match(inventedManifest.stderr, /docs\/start\/install\.md: claims manifest schema seal\.release\/v1 but the release publishes no manifest/);
    assert.match(inventedManifest.stderr, /docs\/start\/install\.md: claims release-manifest\.json but the release publishes no such asset/);

    fs.writeFileSync(path.join(docs, "docs", "start", "install.md"), install.replace(/artifact_bytes=(\d+)/, (_all, count) => `artifact_bytes=${Number(count) + 1}`));
    const changedClaim = await run(["--check"], env);
    assert.equal(changedClaim.code, 1, changedClaim.stdout + changedClaim.stderr);
    assert.match(changedClaim.stderr, /FAIL release docs disagree with published release: docs\/start\/install\.md: artifact byte count names/);
  });
});

test("a post-legacy release without a manifest refuses instead of entering compatibility mode", async () => {
  assert.deepEqual(LEGACY_RELEASE_TAGS, ["v0.2.0-rc.1", "v0.2.0-rc.2", "v0.2.0-rc.3"]);
  const release = {
    id: 4,
    tag_name: "v0.2.0-rc.4",
    draft: false,
    published_at: "2026-08-27T00:00:00Z",
    assets: [],
  };
  await withReleaseServer(release, {}, async (api) => {
    const result = await run(["--check"], {
      SEAL_RELEASE_DOCS_ROOT: docsRoot(),
      SEAL_RELEASES_API_URL: api,
      SEAL_RELEASE_TAG_COMMIT: COMMIT,
    });
    assert.equal(result.code, 1);
    assert.match(result.stderr, /^REFUSE release_docs_manifest_absent: v0\.2\.0-rc\.4 must publish exactly one release-manifest\.json, found 0$/m);
    assert.doesNotMatch(result.stderr, /COMPAT/);
  });
});

test("release workflow pushes a review branch and reports a moving-main exhaustion", () => {
  const workflow = fs.readFileSync(path.join(ROOT, ".github", "workflows", "release.yml"), "utf8");
  assert.match(workflow, /pull-requests: write/);
  assert.match(workflow, /branch="release-docs\/\$GITHUB_REF_NAME"/);
  assert.match(workflow, /git push --force-with-lease origin "HEAD:refs\/heads\/\$branch"/);
  assert.match(workflow, /gh pr create --base main --head "\$branch"/);
  assert.doesNotMatch(workflow, /git push origin HEAD:main/);
  assert.match(workflow, /::error::main kept moving while release documentation PR #\$pr_number was refreshed/);
});

// CLAIM-COVERAGE: scripts/check-install-prose.mjs#install-prose-observations
test("generated install prose is bound to published installer observations", async (t) => {
  const directory = testTmpdir(path.join(os.tmpdir(), 'seal-prose-fetch-'));
  const names = ['artifact', 'checker', 'sums'].map(kind =>
    fs.readFileSync(path.join(ROOT, 'docs/start/install.md'), 'utf8').match(new RegExp(kind + '_name="([^"]+)"'))[1]);
  const preload = path.join(directory, 'fetch.mjs');
  // Record only this run's live responses; the checker still authenticates them.
  // Negative transport cases replay those exact bytes without extra downloads.
  fs.writeFileSync(preload, String.raw`import fs from 'node:fs';
import path from 'node:path';
const directory = process.env.PROSE_FETCH_DIRECTORY;
const mode = process.env.PROSE_FETCH_MODE;
const nativeFetch = globalThis.fetch;
const counts = {};
globalThis.fetch = async (url, options) => {
  const name = new URL(url).pathname.split('/').at(-1);
  const attempt = counts[name] = (counts[name] || 0) + 1;
  fs.writeFileSync(path.join(directory, 'counts.json'), JSON.stringify(counts));
  if (mode === 'record') {
    const response = await nativeFetch(url, options);
    if (response.ok) fs.writeFileSync(path.join(directory, name), Buffer.from(await response.clone().arrayBuffer()));
    return response;
  }
  if (name === process.env.PROSE_FETCH_TARGET) {
    if (mode === 'all-transient' || (['transient', 'transient-wrong'].includes(mode) && attempt === 1)) {
      throw new TypeError('fetch failed', { cause: Object.assign(new Error('socket reset by peer'), { code: 'UND_ERR_SOCKET' }) });
    }
    if (['404', '401', '501'].includes(mode)) return new Response(null, { status: Number(mode) });
    if (mode === 'unknown') throw new TypeError('fixture programming error');
    if (mode === 'body' && attempt === 1) return new Response(new ReadableStream({
      start(controller) { controller.error(Object.assign(new Error('body reset'), { code: 'ECONNRESET' })); },
    }));
    if (mode === '503' && attempt === 1) return new Response(null, { status: 503 });
  }
  const bytes = fs.readFileSync(path.join(directory, name));
  if (['wrong-byte', 'transient-wrong'].includes(mode) && name === process.env.PROSE_FETCH_TARGET) bytes[0] ^= 1;
  return new Response(bytes);
};
`);
  const run = mode => spawnSync(process.execPath, ['--import', preload, path.join(ROOT, 'scripts/check-install-prose.mjs')], {
    cwd: ROOT, encoding: 'utf8', timeout: 180000,
    env: { ...process.env, NODE_TEST_CONTEXT: undefined, PROSE_FETCH_DIRECTORY: directory, PROSE_FETCH_MODE: mode, PROSE_FETCH_TARGET: names[0] },
  });
  const result = run('record');
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /PASS install prose: 19 reviewed behavioural claims/);
  for (const [mode, status, attempts, diagnostic] of [
    ['transient', 0, 2, /PASS install prose:/],
    ['all-transient', 1, 3, /UND_ERR_SOCKET/],
    ['wrong-byte', 1, 1, /published .* digest/],
    ['404', 1, 1, /HTTP 404/],
    ['503', 0, 2, /PASS install prose:/],
    ['body', 0, 2, /PASS install prose:/],
    ['transient-wrong', 1, 2, /published .* digest/],
    ['401', 1, 1, /HTTP 401/],
    ['501', 1, 1, /HTTP 501/],
    ['unknown', 1, 1, /fixture programming error/],
  ]) {
    await t.test(`install prose fetch ${mode}`, () => {
      const checked = run(mode);
      assert.equal(checked.status, status, checked.stdout + checked.stderr);
      assert.match(checked.stdout + checked.stderr, diagnostic);
      assert.deepEqual(JSON.parse(fs.readFileSync(path.join(directory, 'counts.json'), 'utf8')), {
        [names[0]]: attempts, [names[1]]: 1, [names[2]]: 1,
      });
    });
  }
});


test("install prose check rejects falsification, deletion and unreviewed additions", () => {
  const docs = testTmpdir(path.join(os.tmpdir(), 'seal-prose-negative-'));
  fs.mkdirSync(path.join(docs, 'docs/start'), { recursive: true });
  fs.copyFileSync(path.join(ROOT, 'README.md'), path.join(docs, 'README.md'));
  const original = fs.readFileSync(path.join(ROOT, 'docs/start/install.md'), 'utf8');
  const claim = 'checksum comparison prevents both';
  assert.ok(original.includes(claim), 'negative control must modify the actual sentence');
  for (const changed of [
    original.replace(claim, 'checksum comparison still runs both'),
    original.replace(claim, ''),
    original.replace('## Verify, then install', 'The installer sends your files to the publisher.\n\n## Verify, then install'),
    original.replace('publishes `seal-', 'publishes no `seal-'),
    original.replace('## Verify, then install', '## Install, then verify'),
  ]) {
    fs.writeFileSync(path.join(docs, 'docs/start/install.md'), changed);
    const result = spawnSync(process.execPath, [path.join(ROOT, 'scripts/check-install-prose.mjs')], {
      cwd: ROOT, encoding: 'utf8', timeout: 30000,
      env: { ...process.env, NODE_TEST_CONTEXT: undefined, SEAL_INSTALL_PROSE_ROOT: docs },
    });
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stderr, /FAIL install prose: (claim 07|unreviewed generated install prose)/);
  }
});


// CLAIM-COVERAGE: test/release-docs.test.mjs#outside-claim-controls
test("outside install claims require review in both documents without taxing non-claims", () => {
  const docs = testTmpdir(path.join(os.tmpdir(), 'seal-prose-outside-'));
  fs.mkdirSync(path.join(docs, 'docs/start'), { recursive: true });
  const originals = Object.fromEntries(['docs/start/install.md', 'README.md'].map(file =>
    [file, fs.readFileSync(path.join(ROOT, file), 'utf8')]));
  const marker = '<!-- end generated release docs -->';
  const run = () => spawnSync(process.execPath, [path.join(ROOT, 'scripts/check-install-prose.mjs')], {
    cwd: ROOT, encoding: 'utf8', timeout: 180000,
    env: { ...process.env, NODE_TEST_CONTEXT: undefined, SEAL_INSTALL_PROSE_ROOT: docs },
  });
  const reset = () => {
    for (const [file, original] of Object.entries(originals)) fs.writeFileSync(path.join(docs, file), original);
  };
  for (const file of Object.keys(originals)) {
    for (const sentence of [
      'Seal installs safely even when the checksum comparison fails.',
      'Seal teleports every downloaded artifact.',
      'Seal always installs safely\neven when the checksum comparison fails.',
    ]) {
      for (const markerAt of ['first', 'last']) {
        reset();
        const original = originals[file];
        const at = (markerAt === 'first' ? original.indexOf(marker) : original.lastIndexOf(marker)) + marker.length;
        fs.writeFileSync(path.join(docs, file), original.slice(0, at) + '\n' + sentence + '\n' + original.slice(at));
        const result = run();
        assert.equal(result.status, 1, result.stdout + result.stderr);
        assert.ok(result.stderr.includes(`${file}: unreviewed outside install prose needs a claim and observable: ${sentence.replace(/\s+/g, ' ')}`), result.stderr);
      }
    }
  }
  reset();
  for (const [file, original] of Object.entries(originals)) {
    fs.writeFileSync(path.join(docs, file), original.replace(marker,
      marker + '\n\n## More information\n\nContinue to the next page.\n'));
  }
  const clean = run();
  assert.equal(clean.status, 0, clean.stdout + clean.stderr);
});
