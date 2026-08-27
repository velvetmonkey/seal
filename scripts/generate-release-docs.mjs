#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  manifestFromObserved,
  validateManifestAgainstObserved,
  validateManifestShape,
} from "./release-manifest-lib.mjs";

const ROOT = path.join(import.meta.dirname, "..");
const SENTINEL = "<!-- generated from release-manifest.json; do not edit -->";
const END = "<!-- end generated release docs -->";
const REPOSITORY = process.env.SEAL_RELEASE_REPOSITORY || "velvetmonkey/seal";
const RELEASES_API = process.env.SEAL_RELEASES_API_URL || `https://api.github.com/repos/${REPOSITORY}/releases?per_page=100`;
const ghToken = process.env.GH_TOKEN || process.env.GITHUB_TOKEN || spawnSync("gh", ["auth", "token"], { encoding: "utf8" }).stdout?.trim();
const TOKEN = ghToken || undefined;

function refuse(code, reason) {
  const error = new Error(`REFUSE release_docs_${code}: ${reason}`);
  error.code = code;
  throw error;
}

function headers(extra = {}) {
  return {
    accept: "application/vnd.github+json",
    "user-agent": "seal-release-docs-generator",
    "x-github-api-version": "2022-11-28",
    ...(TOKEN ? { authorization: `Bearer ${TOKEN}` } : {}),
    ...extra,
  };
}

async function fetchResponse(url, extraHeaders = {}) {
  let response;
  try {
    response = await fetch(url, { headers: headers(extraHeaders), redirect: "follow" });
  } catch (error) {
    refuse("network", `cannot fetch ${url}: ${error.message}`);
  }
  if (!response.ok) refuse("network", `HTTP ${response.status} for ${url}`);
  return response;
}

async function fetchJson(url) {
  const response = await fetchResponse(url);
  try {
    return await response.json();
  } catch (error) {
    refuse("invalid_json", `${url}: ${error.message}`);
  }
}

async function fetchBytes(asset) {
  const url = asset.browser_download_url || asset.url;
  const response = await fetchResponse(url, asset.browser_download_url ? {} : { accept: "application/octet-stream" });
  return Buffer.from(await response.arrayBuffer());
}

function oneAsset(release, name) {
  const matches = release.assets.filter((asset) => asset.name === name);
  if (matches.length !== 1) refuse("asset_population", `${release.tag_name} must publish exactly one ${name}, found ${matches.length}`);
  return matches[0];
}

async function tagCommit(tag) {
  if (process.env.SEAL_RELEASE_TAG_COMMIT) return process.env.SEAL_RELEASE_TAG_COMMIT;
  const base = `https://api.github.com/repos/${REPOSITORY}`;
  let object = (await fetchJson(`${base}/git/ref/tags/${encodeURIComponent(tag)}`)).object;
  const seen = new Set();
  while (object?.type === "tag") {
    if (seen.has(object.sha)) refuse("tag_cycle", `tag ${tag} contains a tag-object cycle`);
    seen.add(object.sha);
    object = (await fetchJson(`${base}/git/tags/${object.sha}`)).object;
  }
  if (object?.type !== "commit" || !/^[0-9a-f]{40}$/.test(object.sha || "")) {
    refuse("tag_target", `cannot resolve ${tag} to one commit`);
  }
  return object.sha;
}

async function latestPublishedRelease() {
  const releases = await fetchJson(RELEASES_API);
  if (!Array.isArray(releases)) refuse("release_list", "GitHub releases response is not an array");
  const published = releases
    .filter((release) => !release.draft && release.published_at)
    .sort((left, right) => Date.parse(right.published_at) - Date.parse(left.published_at) || Number(right.id) - Number(left.id));
  if (!published.length) refuse("release_absent", "repository has no published release");
  if (process.env.SEAL_EXPECTED_RELEASE_TAG && published[0].tag_name !== process.env.SEAL_EXPECTED_RELEASE_TAG) {
    refuse("release_visibility", `latest published release is ${published[0].tag_name}, expected ${process.env.SEAL_EXPECTED_RELEASE_TAG}`);
  }
  return published[0];
}

async function observedFromRelease(release, names) {
  const artifactAsset = oneAsset(release, names.artifact);
  const checkerAsset = oneAsset(release, names.checker);
  const checksumsAsset = oneAsset(release, names.checksums);
  const [artifactBytes, checkerBytes, checksumsBytes, commitSha] = await Promise.all([
    fetchBytes(artifactAsset),
    fetchBytes(checkerAsset),
    fetchBytes(checksumsAsset),
    tagCommit(release.tag_name),
  ]);
  return {
    tag: release.tag_name,
    commitSha,
    artifactName: artifactAsset.name,
    artifactBytes,
    checkerName: checkerAsset.name,
    checkerBytes,
    checksumsName: checksumsAsset.name,
    checksumsBytes,
  };
}

async function remoteManifest() {
  const release = await latestPublishedRelease();
  const manifestAssets = release.assets.filter((asset) => asset.name === "release-manifest.json");
  if (manifestAssets.length > 1) refuse("asset_population", `${release.tag_name} publishes more than one release-manifest.json`);
  if (manifestAssets.length === 0) {
    const artifacts = release.assets.filter((asset) => asset.name.startsWith(`seal-${release.tag_name}-`) && asset.name !== "seal-receipt-check.mjs");
    if (artifacts.length !== 1) refuse("legacy_asset_population", `${release.tag_name} has no manifest and does not have one unambiguous Seal artifact`);
    const observed = await observedFromRelease(release, {
      artifact: artifacts[0].name,
      checker: "seal-receipt-check.mjs",
      checksums: "SHA256SUMS",
    });
    process.stderr.write(`COMPAT release_docs_legacy: ${release.tag_name} predates release-manifest.json; derived and verified its facts from published assets\n`);
    return manifestFromObserved(observed);
  }
  let manifest;
  try {
    manifest = JSON.parse((await fetchBytes(manifestAssets[0])).toString("utf8"));
  } catch (error) {
    refuse("manifest_json", `release-manifest.json is invalid: ${error.message}`);
  }
  validateManifestShape(manifest);
  if (manifest.tag !== release.tag_name) refuse("release_mismatch", `manifest tag ${manifest.tag} is not latest release ${release.tag_name}`);
  const observed = await observedFromRelease(release, {
    artifact: manifest.artifact.name,
    checker: manifest.checker.name,
    checksums: manifest.checksums.name,
  });
  return validateManifestAgainstObserved(manifest, observed);
}

function localManifest(manifestPath, assetsDir, commitSha) {
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  } catch (error) {
    refuse("manifest_json", `${manifestPath}: ${error.message}`);
  }
  validateManifestShape(manifest);
  const read = (name) => {
    const target = path.join(assetsDir, name);
    if (path.dirname(target) !== path.resolve(assetsDir)) refuse("asset_name", `${name} escapes --assets-dir`);
    try { return fs.readFileSync(target); }
    catch (error) { refuse("asset_read", `${target}: ${error.message}`); }
  };
  return validateManifestAgainstObserved(manifest, {
    tag: manifest.tag,
    commitSha,
    artifactName: manifest.artifact.name,
    artifactBytes: read(manifest.artifact.name),
    checkerName: manifest.checker.name,
    checkerBytes: read(manifest.checker.name),
    checksumsName: manifest.checksums.name,
    checksumsBytes: read(manifest.checksums.name),
  });
}

function platformSentence(platform) {
  if (platform === "linux-x64") return "Linux x86-64";
  if (platform === "darwin-x64") return "macOS x86-64";
  if (platform === "darwin-arm64") return "macOS ARM64";
  refuse("platform", `no documentation wording exists for ${platform}`);
}

function version(manifest) {
  return manifest.tag.slice(1);
}

function readmeRegions(manifest) {
  const platform = platformSentence(manifest.platform);
  return [
    [
      SENTINEL,
      "```bash",
      `SEAL_VERSION=${manifest.tag}`,
      `artifact_name=${JSON.stringify(manifest.artifact.name)}; artifact_sha256=${JSON.stringify(manifest.artifact.sha256)}; artifact_bytes=${manifest.artifact.bytes}`,
      `checker_name=${JSON.stringify(manifest.checker.name)}; checker_sha256=${JSON.stringify(manifest.checker.sha256)}; checker_bytes=${manifest.checker.bytes}`,
      `sums_name=${JSON.stringify(manifest.checksums.name)}; sums_sha256=${JSON.stringify(manifest.checksums.sha256)}`,
      'curl -fsSLO "https://github.com/velvetmonkey/seal/releases/download/$SEAL_VERSION/SHA256SUMS"',
      'curl -fsSLO "https://github.com/velvetmonkey/seal/releases/download/$SEAL_VERSION/seal-$SEAL_VERSION-linux-x64"',
      'curl -fsSLO "https://github.com/velvetmonkey/seal/releases/download/$SEAL_VERSION/seal-receipt-check.mjs" # This checker does not enter the installed payload.',
      'if command -v shasum >/dev/null 2>&1; then sums_actual="$(shasum -a 256 "$sums_name" | awk \'{print $1}\')"; elif command -v sha256sum >/dev/null 2>&1; then sums_actual="$(sha256sum "$sums_name" | awk \'{print $1}\')"; else echo "no SHA-256 tool found (need shasum or sha256sum)" >&2; exit 1; fi; test "$sums_actual" = "$sums_sha256"',
      'read -r expected_digest expected_bytes expected_name < <(awk -v name="$artifact_name" \'$3 == name\' "$sums_name"); test "$expected_name" = "$artifact_name"; test "$expected_digest" = "$artifact_sha256"; test "$expected_bytes" = "$artifact_bytes"',
      'if command -v shasum >/dev/null 2>&1; then actual_digest="$(shasum -a 256 "$artifact_name" | awk \'{print $1}\')"; elif command -v sha256sum >/dev/null 2>&1; then actual_digest="$(sha256sum "$artifact_name" | awk \'{print $1}\')"; fi; test "$actual_digest" = "$artifact_sha256"; test "$(wc -c < "$artifact_name" | tr -d \' \')" = "$artifact_bytes"',
      'read -r checker_sum checker_count checker_entry < <(awk -v name="$checker_name" \'$3 == name\' "$sums_name"); test "$checker_entry" = "$checker_name"; test "$checker_sum" = "$checker_sha256"; test "$checker_count" = "$checker_bytes"; if command -v shasum >/dev/null 2>&1; then checker_actual="$(shasum -a 256 "$checker_name" | awk \'{print $1}\')"; else checker_actual="$(sha256sum "$checker_name" | awk \'{print $1}\')"; fi; test "$checker_actual" = "$checker_sha256"; test "$(wc -c < "$checker_name" | tr -d \' \')" = "$checker_bytes"',
      'checker="$(pwd -P)/$checker_name"; chmod +x "$expected_name"; ./"$expected_name" --sha256 "$expected_digest" --bytes "$expected_bytes" --prefix ~/.local; export PATH="$HOME/.local/bin:$PATH"',
      "```",
      `Requires Node ${manifest.minimumNodeMajor}+. The published Seal ${manifest.tag} release asset is ${platform}, from commit \`${manifest.commitSha}\`, and its manifest uses \`${manifest.schema}\`. Protect also needs Claude Code's \`claude\` command.`,
      "<!-- Seal installed-tree pin role: published-asset -->",
      "```output",
      `installed seal ${version(manifest)} ${manifest.platform}`,
      `store: /home/you/.local/lib/seal/store/${manifest.artifact.installedTreeSha256}`,
      "command: /home/you/.local/bin/seal",
      `tree: ${manifest.artifact.installedTreeSha256}`,
      "Next:",
      "  export PATH=/home/you/.local/bin:$PATH",
      "  seal demo",
      "```",
      END,
    ].join("\n"),
    [
      SENTINEL,
      `At the exact release tag, your build writes \`${manifest.artifact.name}\` in your own \`dist/\` directory;`,
      manifest.artifact.name,
      END,
    ].join("\n"),
    [
      SENTINEL,
      `With the published ${manifest.tag} CLI, protect one tool:`,
      END,
    ].join("\n"),
  ];
}

function installRegions(manifest) {
  const platform = platformSentence(manifest.platform);
  const releaseUrl = `https://github.com/${REPOSITORY}/releases/tag/${manifest.tag}`;
  const commitUrl = `https://github.com/${REPOSITORY}/commit/${manifest.commitSha}`;
  return [
    [
      SENTINEL,
      `# Install Seal ${manifest.tag}`,
      `The [${manifest.tag} release](${releaseUrl}) was published from commit [\`${manifest.commitSha}\`](${commitUrl}); its \`release-manifest.json\` uses schema \`${manifest.schema}\`. macOS source portability is CI-exercised for install, demo and receipt checking.`,
      `Protect is not supported on macOS yet. The published release asset and supported Protect path are ${platform}; Windows and Linux ARM are unsupported. Node ${manifest.minimumNodeMajor}+ is required.`,
      "The installer refuses before changing anything on an unsupported or mismatched platform.",
      END,
    ].join("\n"),
    [
      SENTINEL,
      "```bash",
      `SEAL_VERSION=${manifest.tag}`,
      `artifact_name=${JSON.stringify(manifest.artifact.name)}; artifact_sha256=${JSON.stringify(manifest.artifact.sha256)}; artifact_bytes=${manifest.artifact.bytes}`,
      `checker_name=${JSON.stringify(manifest.checker.name)}; checker_sha256=${JSON.stringify(manifest.checker.sha256)}; checker_bytes=${manifest.checker.bytes}`,
      `sums_name=${JSON.stringify(manifest.checksums.name)}; sums_sha256=${JSON.stringify(manifest.checksums.sha256)}`,
      'curl -fsSLO "https://github.com/velvetmonkey/seal/releases/download/$SEAL_VERSION/$sums_name"',
      'curl -fsSLO "https://github.com/velvetmonkey/seal/releases/download/$SEAL_VERSION/$artifact_name"',
      'curl -fsSLO "https://github.com/velvetmonkey/seal/releases/download/$SEAL_VERSION/$checker_name"',
      'if command -v shasum >/dev/null 2>&1; then sums_actual="$(shasum -a 256 "$sums_name" | awk \'{print $1}\')"; elif command -v sha256sum >/dev/null 2>&1; then sums_actual="$(sha256sum "$sums_name" | awk \'{print $1}\')"; else echo "no SHA-256 tool found (need shasum or sha256sum)" >&2; exit 1; fi; test "$sums_actual" = "$sums_sha256"',
      'read -r expected_digest expected_bytes expected_name < <(awk -v name="$artifact_name" \'$3 == name\' "$sums_name"); test "$expected_name" = "$artifact_name"; test "$expected_digest" = "$artifact_sha256"; test "$expected_bytes" = "$artifact_bytes"',
      'if command -v shasum >/dev/null 2>&1; then actual_digest="$(shasum -a 256 "$artifact_name" | awk \'{print $1}\')"; elif command -v sha256sum >/dev/null 2>&1; then actual_digest="$(sha256sum "$artifact_name" | awk \'{print $1}\')"; fi; test "$actual_digest" = "$artifact_sha256"; test "$(wc -c < "$artifact_name" | tr -d \' \')" = "$artifact_bytes"',
      'read -r checker_sum checker_count checker_entry < <(awk -v name="$checker_name" \'$3 == name\' "$sums_name"); test "$checker_entry" = "$checker_name"; test "$checker_sum" = "$checker_sha256"; test "$checker_count" = "$checker_bytes"; if command -v shasum >/dev/null 2>&1; then checker_actual="$(shasum -a 256 "$checker_name" | awk \'{print $1}\')"; else checker_actual="$(sha256sum "$checker_name" | awk \'{print $1}\')"; fi; test "$checker_actual" = "$checker_sha256"; test "$(wc -c < "$checker_name" | tr -d \' \')" = "$checker_bytes"',
      'chmod +x "$expected_name"; ./"$expected_name" --sha256 "$expected_digest" --bytes "$expected_bytes" --prefix ~/.local',
      "```",
      `Success prints \`installed seal ${version(manifest)} ${manifest.platform}\` and the store, command,`,
      "and tree lines. Path prefixes on `store:` and `command:` differ per machine.",
      `The tree hash of the published ${manifest.tag} asset is pinned here:`,
      "",
      "**Seal installed-tree pin role:** `published-asset`",
      "```output",
      `installed seal ${version(manifest)} ${manifest.platform}`,
      `store: /home/you/.local/lib/seal/store/${manifest.artifact.installedTreeSha256}`,
      "command: /home/you/.local/bin/seal",
      `tree: ${manifest.artifact.installedTreeSha256}`,
      "```",
      "",
      "Add `~/.local/bin` to PATH:",
      "",
      "```bash",
      '$ export PATH="$HOME/.local/bin:$PATH"',
      "```",
      "",
      "Further distribution detail, including what each payload contains, is in",
      "[DISTRIBUTION.md](../assurance/distribution.md). The published payload in the transcript above",
      `does not include the checker; download the sibling [\`${manifest.checker.name}\` release asset](https://github.com/${REPOSITORY}/releases/download/${manifest.tag}/${manifest.checker.name})`,
      "and verify it against that release's `SHA256SUMS` asset; see [evaluator-walk.md](../start/evaluator-walk.md).",
      END,
    ].join("\n"),
  ];
}

function replaceRegions(relative, replacements) {
  const target = path.join(ROOT, relative);
  const original = fs.readFileSync(target, "utf8");
  const pattern = new RegExp(`${SENTINEL.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[\\s\\S]*?${END.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "g");
  const hits = [...original.matchAll(pattern)];
  if (hits.length !== replacements.length) refuse("region_population", `${relative} has ${hits.length} generated regions; expected ${replacements.length}`);
  let index = 0;
  const rewritten = original.replace(pattern, () => replacements[index++]);
  return { relative, target, original, rewritten };
}

function option(name) {
  const at = process.argv.indexOf(name);
  return at < 0 ? undefined : process.argv[at + 1];
}

async function main() {
  const manifestPath = option("--manifest");
  const assetsDir = option("--assets-dir");
  const localCommit = option("--tag-commit");
  if ([manifestPath, assetsDir, localCommit].some(Boolean) && ![manifestPath, assetsDir, localCommit].every(Boolean)) {
    refuse("arguments", "--manifest, --assets-dir, and --tag-commit must be supplied together");
  }
  const manifest = manifestPath
    ? localManifest(path.resolve(manifestPath), path.resolve(assetsDir), localCommit)
    : await remoteManifest();
  const changes = [
    replaceRegions("README.md", readmeRegions(manifest)),
    replaceRegions("docs/start/install.md", installRegions(manifest)),
  ];
  const stale = changes.filter((change) => change.original !== change.rewritten);
  if (process.argv.includes("--check")) {
    if (stale.length) {
      for (const change of stale) process.stderr.write(`FAIL release docs stale: ${change.relative}\n`);
      process.exitCode = 1;
      return;
    }
    process.stdout.write(`PASS release docs match latest published release ${manifest.tag}\n`);
    return;
  }
  for (const change of stale) {
    fs.writeFileSync(change.target, change.rewritten);
    process.stdout.write(`updated ${change.relative}\n`);
  }
  if (!stale.length) process.stdout.write(`unchanged release docs for ${manifest.tag}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
