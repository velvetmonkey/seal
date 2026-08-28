// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import test from "node:test";
import { LEGACY_RELEASE_TAGS, sha256 } from "../scripts/release-manifest-lib.mjs";

const ROOT = path.join(import.meta.dirname, "..");
const GENERATOR = path.join(ROOT, "scripts", "generate-release-docs.mjs");
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
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "seal-release-docs-"));
  fs.copyFileSync(path.join(ROOT, "README.md"), path.join(root, "README.md"));
  fs.cpSync(path.join(ROOT, "docs"), path.join(root, "docs"), { recursive: true });
  return root;
}

function releaseAssets(tag) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "seal-release-assets-"));
  const source = fs.mkdtempSync(path.join(os.tmpdir(), "seal-release-source-"));
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
    const readme = fs.readFileSync(path.join(docs, "README.md"), "utf8");
    assert.match(readme, /The current source is the unreleased `v0\.2\.0` candidate\. The install commands below fetch the\s*> published `v0\.2\.0-rc\.3`, which carries the previous receipt format and Linux-only Protect support\./);
    const equalVersion = await run([], { ...env, SEAL_RELEASE_SOURCE_VERSION: "0.2.0-rc.3" });
    assert.equal(equalVersion.code, 0, equalVersion.stderr);
    assert.doesNotMatch(fs.readFileSync(path.join(docs, "README.md"), "utf8"), /The current source is the unreleased/);
    console.log("TAMPER equal-version: divergence block absent");
    const restoredVersion = await run([], env);
    assert.equal(restoredVersion.code, 0, restoredVersion.stderr);
    assert.match(fs.readFileSync(path.join(docs, "README.md"), "utf8"), /The current source is the unreleased `v0\.2\.0` candidate/);
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
