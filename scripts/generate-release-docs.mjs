#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import {
  isLegacyReleaseTag,
  legacyManifestFromObserved,
  validateManifestAgainstObserved,
  validateManifestShape,
} from "./release-manifest-lib.mjs";

const require = createRequire(import.meta.url);
const { protectPlatformSupported } = require("../spine/platform.cjs");
const ROOT = path.resolve(process.env.SEAL_RELEASE_DOCS_ROOT || path.join(import.meta.dirname, ".."));
const SENTINEL = "<!-- generated from published release; do not edit -->";
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

async function observedMatrixFromRelease(release, manifest) {
  const artifactAssets = manifest.artifacts.map((artifact) => oneAsset(release, artifact.name));
  const checkerAsset = oneAsset(release, manifest.checker.name);
  const checksumsAsset = oneAsset(release, manifest.checksums.name);
  const [artifactBytes, checkerBytes, checksumsBytes, commitSha] = await Promise.all([
    Promise.all(artifactAssets.map(fetchBytes)),
    fetchBytes(checkerAsset),
    fetchBytes(checksumsAsset),
    tagCommit(release.tag_name),
  ]);
  return {
    tag: release.tag_name,
    commitSha,
    artifacts: artifactAssets.map((asset, index) => ({ name: asset.name, bytes: artifactBytes[index] })),
    checkerName: checkerAsset.name,
    checkerBytes,
    checksumsName: checksumsAsset.name,
    checksumsBytes,
  };
}

function documentationManifest(manifest) {
  if (!Array.isArray(manifest.artifacts)) return manifest;
  const artifact = manifest.artifacts.find((candidate) => candidate.platform === "linux-x64");
  if (!artifact) refuse("platform", "release manifest has no linux-x64 documentation artifact");
  return { ...manifest, artifact, platform: artifact.platform };
}

async function remoteManifest() {
  const release = await latestPublishedRelease();
  const manifestAssets = release.assets.filter((asset) => asset.name === "release-manifest.json");
  if (manifestAssets.length > 1) refuse("asset_population", `${release.tag_name} publishes more than one release-manifest.json`);
  if (manifestAssets.length === 0) {
    if (!isLegacyReleaseTag(release.tag_name)) {
      refuse("manifest_absent", `${release.tag_name} must publish exactly one release-manifest.json, found 0`);
    }
    const artifacts = release.assets.filter((asset) => asset.name.startsWith(`seal-${release.tag_name}-`) && asset.name !== "seal-receipt-check.mjs");
    if (artifacts.length !== 1) refuse("legacy_asset_population", `${release.tag_name} has no manifest and does not have one unambiguous Seal artifact`);
    const observed = await observedFromRelease(release, {
      artifact: artifacts[0].name,
      checker: "seal-receipt-check.mjs",
      checksums: "SHA256SUMS",
    });
    process.stderr.write(`COMPAT release_docs_legacy: ${release.tag_name} predates release-manifest.json; derived and verified its facts from published assets\n`);
    return { manifest: legacyManifestFromObserved(observed), manifestPublished: false };
  }
  let manifest;
  try {
    manifest = JSON.parse((await fetchBytes(manifestAssets[0])).toString("utf8"));
  } catch (error) {
    refuse("manifest_json", `release-manifest.json is invalid: ${error.message}`);
  }
  validateManifestShape(manifest);
  if (manifest.tag !== release.tag_name) refuse("release_mismatch", `manifest tag ${manifest.tag} is not latest release ${release.tag_name}`);
  const observed = await observedMatrixFromRelease(release, manifest);
  return { manifest: documentationManifest(validateManifestAgainstObserved(manifest, observed)), manifestPublished: true };
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
  const observed = {
    tag: manifest.tag,
    commitSha,
    artifacts: manifest.artifacts.map((artifact) => ({ name: artifact.name, bytes: read(artifact.name) })),
    checkerName: manifest.checker.name,
    checkerBytes: read(manifest.checker.name),
    checksumsName: manifest.checksums.name,
    checksumsBytes: read(manifest.checksums.name),
  };
  return { manifest: documentationManifest(validateManifestAgainstObserved(manifest, observed)), manifestPublished: true };
}

function platformSentence(platform) {
  if (platform === "linux-x64") return "Linux x86-64";
  if (platform === "darwin-x64") return "macOS x86-64";
  if (platform === "darwin-arm64") return "macOS ARM64";
  refuse("platform", `no documentation wording exists for ${platform}`);
}

function installPlatformParagraphs(manifest, platform) {
  const linux = protectPlatformSupported("linux", "x64");
  const darwinX64 = protectPlatformSupported("darwin", "x64");
  const darwinArm64 = protectPlatformSupported("darwin", "arm64");
  if (darwinX64 !== darwinArm64) {
    refuse("platform_table", `darwin-x64 Protect support is ${darwinX64}, but darwin-arm64 Protect support is ${darwinArm64}`);
  }
  if (!linux) refuse("platform_table", "linux-x64 Protect support is absent");
  if (!darwinX64) {
    return [
      "macOS source portability is CI-exercised for install, demo and receipt checking.",
      `Protect is not supported on macOS yet. The published release asset and supported Protect path are ${platform}; Windows and Linux ARM are unsupported. Node ${manifest.minimumNodeMajor}+ is required.`,
    ];
  }
  return [
    manifest.artifacts
      ? "This checkout supports Protect on Linux x86-64 and macOS x64/arm64."
      : `The published release asset is ${platform}. This checkout supports Protect on Linux x86-64 and macOS x64/arm64.`,
    manifest.artifacts
      ? `The native macOS process-start witness helper is release-produced, not independently reproduced. Windows and Linux ARM are unsupported. Node ${manifest.minimumNodeMajor}+ is required.`
      : `Windows and Linux ARM are unsupported. Node ${manifest.minimumNodeMajor}+ is required.`,
  ];
}

function version(manifest) {
  return manifest.tag.slice(1);
}

function releaseSentence(manifest, manifestPublished) {
  const releaseUrl = `https://github.com/${REPOSITORY}/releases/tag/${manifest.tag}`;
  const commitUrl = `https://github.com/${REPOSITORY}/commit/${manifest.commitSha}`;
  const artifactNames = (manifest.artifacts || [manifest.artifact]).map((artifact) => `\`${artifact.name}\``);
  const assets = `${artifactNames.join(", ")}, \`${manifest.checker.name}\`, and \`${manifest.checksums.name}\``;
  const observable = `The [${manifest.tag} release](${releaseUrl}) publishes ${assets}; its tag resolves to commit [\`${manifest.commitSha}\`](${commitUrl}).`;
  if (!manifestPublished) return observable;
  return `${observable} Its \`release-manifest.json\` uses schema \`${manifest.schema}\`.`;
}

function legacyReadmeRegions({ manifest, manifestPublished }) {
  const platform = platformSentence(manifest.platform);
  return [
    [
      SENTINEL,
      "## Before you start",
      "",
      `This is a clean-machine walkthrough for the published ${platform} release.`,
      "It keeps every command in the order a new reader needs to run it.",
      "",
      "Use a disposable project directory and a writable local tools directory.",
      "The walkthrough creates both and leaves your project `.mcp.json` unchanged.",
      "",
      "The commands fetch a release asset and verify its supplied digest and byte count.",
      "Compare those values with release information obtained through a separate channel.",
      "",
      "The demo is approve-once; Protect uses Claude Code's local override.",
      "Both leave local evidence you can inspect before removing the throw-away files.",
      "",
      "Keep the printed receipt paths until you have checked them.",
      "",
      `Install the published ${platform} release before you run the command. The release tag also identifies its \`${manifest.checksums.name}\`. These commands download the binary and sibling receipt-checker asset from that release. Check both assets' digests and byte counts before you run them. For provenance, compare them with release information you got from a separate channel. See the [full install guide](docs/start/install.md) for source builds.`,
      ...(manifest.artifacts ? ["", "The native macOS process-start witness helper is release-produced, not independently reproduced."] : []),
      "",
      "```bash",
      `SEAL_VERSION=${manifest.tag}`,
      `artifact_name=${JSON.stringify(manifest.artifact.name)} \\`,
      `&& artifact_sha256=${JSON.stringify(manifest.artifact.sha256)} \\`,
      `&& artifact_bytes=${manifest.artifact.bytes} \\`,
      `&& sums_name=${JSON.stringify(manifest.checksums.name)} \\`,
      `&& sums_sha256=${JSON.stringify(manifest.checksums.sha256)} \\`,
      `&& checker_name=${JSON.stringify(manifest.checker.name)} \\`,
      `&& checker_sha256=${JSON.stringify(manifest.checker.sha256)} \\`,
      `&& checker_bytes=${manifest.checker.bytes} \\`,
      `&& curl -fsSLO \"https://github.com/velvetmonkey/seal/releases/download/$SEAL_VERSION/${manifest.checksums.name}\" \\`,
      `&& curl -fsSLO \"https://github.com/velvetmonkey/seal/releases/download/$SEAL_VERSION/${manifest.artifact.name.replace(manifest.tag, "$SEAL_VERSION")}\" \\`,
      `&& curl -fsSLO \"https://github.com/velvetmonkey/seal/releases/download/$SEAL_VERSION/${manifest.checker.name}\" \\`,
      "&& if command -v shasum >/dev/null 2>&1; then sums_actual=\"$(shasum -a 256 \"$sums_name\")\"; else sums_actual=\"$(sha256sum \"$sums_name\")\"; fi \\",
      "&& test \"${sums_actual%% *}\" = \"$sums_sha256\" \\",
      "&& expected_record=\"$(awk -v name=\"$artifact_name\" '$3 == name { print $1, $2, $3 }' \"$sums_name\")\" \\",
      "&& test \"$expected_record\" = \"$artifact_sha256 $artifact_bytes $artifact_name\" \\",
      "&& if command -v shasum >/dev/null 2>&1; then actual_digest=\"$(shasum -a 256 \"$artifact_name\")\"; else actual_digest=\"$(sha256sum \"$artifact_name\")\"; fi \\",
      "&& test \"${actual_digest%% *}\" = \"$artifact_sha256\" \\",
      "&& actual_bytes=\"$(wc -c < \"$artifact_name\")\" \\",
      "&& test \"$actual_bytes\" -eq \"$artifact_bytes\" \\",
      "&& checker_record=\"$(awk -v name=\"$checker_name\" '$3 == name { print $1, $2, $3 }' \"$sums_name\")\" \\",
      "&& test \"$checker_record\" = \"$checker_sha256 $checker_bytes $checker_name\" \\",
      "&& if command -v shasum >/dev/null 2>&1; then checker_actual=\"$(shasum -a 256 \"$checker_name\")\"; else checker_actual=\"$(sha256sum \"$checker_name\")\"; fi \\",
      "&& test \"${checker_actual%% *}\" = \"$checker_sha256\" \\",
      "&& checker_count=\"$(wc -c < \"$checker_name\")\" \\",
      "&& test \"$checker_count\" -eq \"$checker_bytes\" \\",
      "&& chmod +x \"$artifact_name\" \\",
      "&& ./\"$artifact_name\" --sha256 \"$artifact_sha256\" --bytes \"$artifact_bytes\" --prefix ~/.local \\",
      "&& checker=\"$(pwd -P)/$checker_name\" \\",
      "&& export PATH=\"$HOME/.local/bin:$PATH\"",
      "```",
      manifestPublished
        ? `Requires Node ${manifest.minimumNodeMajor}+. The published Seal ${manifest.tag} release asset is ${platform}, from commit \`${manifest.commitSha}\`, and its \`release-manifest.json\` uses \`${manifest.schema}\`. Protect also needs Claude Code's \`claude\` command.`
        : `Requires Node ${manifest.minimumNodeMajor}+. The published Seal ${manifest.tag} release asset is ${platform}, from commit \`${manifest.commitSha}\`. Protect also needs Claude Code's \`claude\` command.`,
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
      "",
      `The checker downloaded above is a sibling release asset covered by the same \`${manifest.checksums.name}\`.`,
      "It is not in the installed binary tree.",
      "Run the verified download when the demo prints a receipt and trusted public key.",
      END,
    ].join("\n"),
    [
      SENTINEL,
      `With the published ${manifest.tag} CLI, protect one tool:`,
      END,
    ].join("\n"),
    [
      SENTINEL,
      `- [Limitations and assurance material](docs/assurance/RELEASE-NOTES-${manifest.tag}.md#what-seal-does-not-cover)`,
      END,
    ].join("\n"),
  ];
}

function readmeRegions({ manifest }) {
  const sourceVersion = process.env.SEAL_RELEASE_SOURCE_VERSION
    ?? fs.readFileSync(path.resolve(import.meta.dirname, "../VERSION"), "utf8").trim();
  const divergence = manifest.tag === `v${sourceVersion}` ? [] : [
    `> The current source is the unreleased \`v${sourceVersion}\` candidate. The install commands below fetch the`,
    `> published \`${manifest.tag}\`, which carries the previous receipt format and Linux-only Protect support.`,
    "",
  ];
  return [[
    SENTINEL,
    ...divergence,
    "```bash",
    `SEAL_VERSION=${manifest.tag}`,
    `artifact_name=${JSON.stringify(manifest.artifact.name)} \\`,
    `&& artifact_sha256=${JSON.stringify(manifest.artifact.sha256)} \\`,
    `&& artifact_bytes=${manifest.artifact.bytes} \\`,
    `&& sums_name=${JSON.stringify(manifest.checksums.name)} \\`,
    `&& sums_sha256=${JSON.stringify(manifest.checksums.sha256)} \\`,
    `&& curl -fsSLO \"https://github.com/velvetmonkey/seal/releases/download/$SEAL_VERSION/${manifest.checksums.name}\" \\`,
    `&& curl -fsSLO \"https://github.com/velvetmonkey/seal/releases/download/$SEAL_VERSION/${manifest.artifact.name.replace(manifest.tag, "$SEAL_VERSION")}\" \\`,
    "&& if command -v shasum >/dev/null 2>&1; then sums_actual=\"$(shasum -a 256 \"$sums_name\")\"; else sums_actual=\"$(sha256sum \"$sums_name\")\"; fi \\",
    "&& test \"${sums_actual%% *}\" = \"$sums_sha256\" \\",
    "&& expected_record=\"$(awk -v name=\"$artifact_name\" '$3 == name { print $1, $2, $3 }' \"$sums_name\")\" \\",
    "&& test \"$expected_record\" = \"$artifact_sha256 $artifact_bytes $artifact_name\" \\",
    "&& if command -v shasum >/dev/null 2>&1; then actual_digest=\"$(shasum -a 256 \"$artifact_name\")\"; else actual_digest=\"$(sha256sum \"$artifact_name\")\"; fi \\",
    "&& test \"${actual_digest%% *}\" = \"$artifact_sha256\" \\",
    "&& actual_bytes=\"$(wc -c < \"$artifact_name\")\" \\",
    "&& test \"$actual_bytes\" -eq \"$artifact_bytes\" \\",
    "&& expected_name=\"$artifact_name\" \\",
    "&& expected_digest=\"$artifact_sha256\" \\",
    "&& expected_bytes=\"$artifact_bytes\" \\",
    "&& chmod +x \"$expected_name\" \\",
    "&& ./\"$expected_name\" --sha256 \"$expected_digest\" --bytes \"$expected_bytes\" --prefix ~/.local \\",
    "&& export PATH=\"$HOME/.local/bin:$PATH\"",
    "```",
    END,
  ].join("\n")];
}

function installRegions({ manifest, manifestPublished }) {
  const platform = platformSentence(manifest.platform);
  const [platformSupport, platformLimit] = installPlatformParagraphs(manifest, platform);
  return [
    [
      SENTINEL,
      `# Install Seal ${manifest.tag}`,
      `${releaseSentence(manifest, manifestPublished)} ${platformSupport}`,
      platformLimit,
      "The installer refuses before changing anything on an unsupported or mismatched platform.",
      "",
      "This page is the SHA256SUMS verification wall. The [README](../../README.md)",
      "short form uses the same shell gate. In every install command below, a failed",
      "checksum comparison prevents both `chmod` and execution of the artifact.",
      "The commands use POSIX syntax for `sh`, `dash`, `bash`, and `zsh`. Copy each",
      "whole command, including its continuation backslashes and `&&` operators;",
      "there is no shell-option preamble. The release version is a separate assignment;",
      "omitting it cannot remove the verification gate. Each continuation starts with",
      "`&&`, so copying a continuation alone produces a syntax error.",
      "",
      "The digest comparison below is *your* check, with the OS SHA-256 tool,",
      `against the \`${manifest.checksums.name}\` asset attached to the same GitHub release. That is`,
      "not the installer checking itself. The `--sha256` / `--bytes` flags are a",
      "second pin the installer demands and will refuse without. Together they",
      'answer "did I download the bytes the release named?" They do not answer',
      '"is the publisher honest?"',
      "",
      "## Verify, then install",
      END,
    ].join("\n"),
    [
      SENTINEL,
      "```bash",
      `SEAL_VERSION=${manifest.tag}`,
      `artifact_name=${JSON.stringify(manifest.artifact.name)} \\`,
      `&& artifact_sha256=${JSON.stringify(manifest.artifact.sha256)} \\`,
      `&& artifact_bytes=${manifest.artifact.bytes} \\`,
      `&& sums_name=${JSON.stringify(manifest.checksums.name)} \\`,
      `&& sums_sha256=${JSON.stringify(manifest.checksums.sha256)} \\`,
      `&& checker_name=${JSON.stringify(manifest.checker.name)} \\`,
      `&& checker_sha256=${JSON.stringify(manifest.checker.sha256)} \\`,
      `&& checker_bytes=${manifest.checker.bytes} \\`,
      `&& curl -fsSLO \"https://github.com/velvetmonkey/seal/releases/download/$SEAL_VERSION/${manifest.checksums.name}\" \\`,
      `&& curl -fsSLO \"https://github.com/velvetmonkey/seal/releases/download/$SEAL_VERSION/${manifest.artifact.name.replace(manifest.tag, "$SEAL_VERSION")}\" \\`,
      `&& curl -fsSLO \"https://github.com/velvetmonkey/seal/releases/download/$SEAL_VERSION/${manifest.checker.name}\" \\`,
      "&& if command -v shasum >/dev/null 2>&1; then sums_actual=\"$(shasum -a 256 \"$sums_name\")\"; else sums_actual=\"$(sha256sum \"$sums_name\")\"; fi \\",
      "&& test \"${sums_actual%% *}\" = \"$sums_sha256\" \\",
      "&& expected_record=\"$(awk -v name=\"$artifact_name\" '$3 == name { print $1, $2, $3 }' \"$sums_name\")\" \\",
      "&& test \"$expected_record\" = \"$artifact_sha256 $artifact_bytes $artifact_name\" \\",
      "&& if command -v shasum >/dev/null 2>&1; then actual_digest=\"$(shasum -a 256 \"$artifact_name\")\"; else actual_digest=\"$(sha256sum \"$artifact_name\")\"; fi \\",
      "&& test \"${actual_digest%% *}\" = \"$artifact_sha256\" \\",
      "&& actual_bytes=\"$(wc -c < \"$artifact_name\")\" \\",
      "&& test \"$actual_bytes\" -eq \"$artifact_bytes\" \\",
      "&& checker_record=\"$(awk -v name=\"$checker_name\" '$3 == name { print $1, $2, $3 }' \"$sums_name\")\" \\",
      "&& test \"$checker_record\" = \"$checker_sha256 $checker_bytes $checker_name\" \\",
      "&& if command -v shasum >/dev/null 2>&1; then checker_actual=\"$(shasum -a 256 \"$checker_name\")\"; else checker_actual=\"$(sha256sum \"$checker_name\")\"; fi \\",
      "&& test \"${checker_actual%% *}\" = \"$checker_sha256\" \\",
      "&& checker_count=\"$(wc -c < \"$checker_name\")\" \\",
      "&& test \"$checker_count\" -eq \"$checker_bytes\" \\",
      "&& chmod +x \"$artifact_name\" \\",
      "&& ./\"$artifact_name\" --sha256 \"$artifact_sha256\" --bytes \"$artifact_bytes\" --prefix ~/.local",
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
      "[DISTRIBUTION.md](../assurance/distribution.md). The downloaded checker is",
      "only checked against `SHA256SUMS`; from a source checkout, run",
      "`node checker/seal-receipt-v2.mjs docs/reference/receipt-operations-v1/receipt-block.json`.",
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

const SEMVER = String.raw`\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?`;
const CHECKER_ASSET = String.raw`seal-receipt-(?:check|v2)\.mjs`;
const HISTORICAL_LIMITATIONS_NOTES = "RELEASE-NOTES-v0.2.0-rc.3.md";
const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function replacePublishedSurface(relative, replacements) {
  const target = path.join(ROOT, relative);
  const original = fs.readFileSync(target, "utf8");
  let rewritten = original;
  for (const [pattern, replacement, label] of replacements) {
    const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
    const everyOccurrence = new RegExp(pattern.source, flags);
    if (![...rewritten.matchAll(everyOccurrence)].length) {
      refuse("published_surface_marker", `${relative}: ${label} marker is absent`);
    }
    rewritten = rewritten.replace(everyOccurrence, replacement);
  }
  return { relative, target, original, rewritten };
}

function publishedSurfaceChanges(manifest) {
  const tag = manifest.tag;
  const releaseNotes = `RELEASE-NOTES-${tag}.md`;
  const historicalLimitationsLabel = `“What Seal does not cover” in assurance/${HISTORICAL_LIMITATIONS_NOTES}`;
  const version = tag.slice(1);
  const sourceVersion = process.env.SEAL_RELEASE_SOURCE_VERSION
    ?? fs.readFileSync(path.resolve(import.meta.dirname, "../VERSION"), "utf8").trim();
  const checkerUrl = `https://github.com/${REPOSITORY}/releases/download/${tag}/${manifest.checker.name}`;
  const notePattern = new RegExp(`RELEASE-NOTES-v${SEMVER}\\.md`);
  const archiveScopeFiles = [
    "docs/archive/AUTHORIZATION-MESH.md",
    "docs/archive/CLAIMS-MATRIX.md",
    "docs/archive/LIMITATIONS.md",
    "docs/archive/WHAT-SEAL-IS.md",
    "docs/archive/WHY-DIFFERENT.md",
    "docs/assurance/architecture.md",
  ];
  return [
    ...archiveScopeFiles.map((relative) => replacePublishedSurface(relative, [
      [notePattern, releaseNotes, "published release-note route"],
    ])),
    replacePublishedSurface("docs/archive/TRUTH-BOX.md", [
      [notePattern, `RELEASE-NOTES-v${sourceVersion}.md`, "source-version release-note route"],
    ]),
    replacePublishedSurface("docs/assurance/README.md", [
      [new RegExp(`(?<=^4\\. \\[assurance/)RELEASE-NOTES-v${SEMVER}\\.md(?=\\]\\(RELEASE-NOTES-v${SEMVER}\\.md\\) — what v${SEMVER} contains and$)`, "m"), releaseNotes, "primary release-note label"],
      [new RegExp(`(?<=^4\\. \\[assurance/${escapeRegExp(releaseNotes)}\\]\\()RELEASE-NOTES-v${SEMVER}\\.md(?=\\) — what v${SEMVER} contains and$)`, "m"), releaseNotes, "primary release-note target"],
      [new RegExp(`(?<=^4\\. \\[assurance/${escapeRegExp(releaseNotes)}\\]\\(${escapeRegExp(releaseNotes)}\\) — what )v${SEMVER}(?= contains and$)`, "m"), tag, "primary release-note version"],
      [new RegExp(`(?<=^2\\. \\[)(?:“What Seal does not cover” in the release notes|${escapeRegExp(historicalLimitationsLabel)})(?=\\]\\(RELEASE-NOTES-v${SEMVER}\\.md\\) —$)`, "m"), historicalLimitationsLabel, "historical limitations release-note label"],
      [new RegExp(`(?<=^2\\. \\[${escapeRegExp(historicalLimitationsLabel)}\\]\\()RELEASE-NOTES-v${SEMVER}\\.md(?=\\) —$)`, "m"), HISTORICAL_LIMITATIONS_NOTES, "historical limitations release-note route"],
      [new RegExp(`(?<=^5\\. \\[The \\x60)${CHECKER_ASSET}(?=\\x60 release asset\\]\\()`, "m"), manifest.checker.name, "checker release label"],
      [new RegExp(`(?<=^5\\. \\[The \\x60${escapeRegExp(manifest.checker.name)}\\x60 release asset\\]\\()https://github\\.com/${REPOSITORY}/releases/download/v${SEMVER}/${CHECKER_ASSET}(?=\\) — the$)`, "m"), checkerUrl, "checker release route"],
      [new RegExp(`(?<=^Dated records of how )v${SEMVER}(?= got its shape\\.)`, "m"), tag, "design-history release identity"],
    ]),
    replacePublishedSurface("docs/assurance/distribution.md", [
      [new RegExp(`(?<=^The current install payload excludes \\x60)${CHECKER_ASSET}(?=\\x60\\. Download the sibling$)`, "m"), manifest.checker.name, "excluded checker asset label"],
      [new RegExp(`(?<=^\\[\\x60)${CHECKER_ASSET}(?=\\x60 release asset\\]\\()`, "m"), manifest.checker.name, "checker release label"],
      [new RegExp(`(?<=^\\[\\x60${escapeRegExp(manifest.checker.name)}\\x60 release asset\\]\\()https://github\\.com/${REPOSITORY}/releases/download/v${SEMVER}/${CHECKER_ASSET}(?=\\)$)`, "m"), checkerUrl, "checker release route"],
    ]),
    replacePublishedSurface("docs/assurance/index.html", [
      [new RegExp(`(?<=href=")RELEASE-NOTES-v${SEMVER}\\.md(?=">Release notes</a>)`), releaseNotes, "release-note navigation"],
    ]),
    replacePublishedSurface("docs/start/evaluator-walk.md", [
      [new RegExp("(?<=published GitHub release `)v" + SEMVER + "(?=`)"), tag, "published release identity"],
    ]),
    replacePublishedSurface("docs/guide/README.md", [
      [new RegExp(`(?<=^installed seal )${SEMVER}(?= linux-x64$)`, "m"), version, "published install version"],
      [new RegExp(`(?<=^store: /home/you/\\.local/lib/seal/store/)[0-9a-f]{64}$`, "m"), manifest.artifact.installedTreeSha256, "published store pin"],
      [new RegExp(`(?<=^tree: )[0-9a-f]{64}$`, "m"), manifest.artifact.installedTreeSha256, "published tree pin"],
    ]),
  ];
}

function generatedClaims(relative, expectedRegions) {
  const target = path.join(ROOT, relative);
  const document = fs.readFileSync(target, "utf8");
  const pattern = new RegExp(`${SENTINEL.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([\\s\\S]*?)${END.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "g");
  const regions = [...document.matchAll(pattern)].map((match) => match[1]);
  if (regions.length !== expectedRegions) {
    return { relative, text: regions.join("\n"), failures: [`has ${regions.length} generated regions; expected ${expectedRegions}`] };
  }
  return { relative, text: regions.join("\n"), failures: [] };
}

function values(text, pattern) {
  return [...text.matchAll(pattern)].map((match) => match[1] ?? match[0]);
}

function checkPublishedClaims(document, facts) {
  const { manifest, manifestPublished } = facts;
  const requireAll = (label, actual, expected, minimum = 1) => {
    if (actual.length < minimum) document.failures.push(`${label} is absent`);
    const wrong = [...new Set(actual.filter((value) => String(value) !== String(expected)))];
    if (wrong.length) document.failures.push(`${label} names ${wrong.join(", ")}; release names ${expected}`);
  };
  const releaseTags = [
    ...values(document.text, /\bSEAL_VERSION=(v[^\s]+)\b/g),
    ...values(document.text, /\/releases\/(?:tag|download)\/(v[^/)]+)[/)]/g),
    ...values(document.text, /\bRELEASE-NOTES-(v[^/]+?)\.md\b/g),
    ...values(document.text, /\bpublished (?:Seal )?(v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?) (?:release|CLI)/g),
    ...values(document.text, /^# Install Seal (v[^\s]+)$/gm),
  ];
  requireAll("release tag", releaseTags, manifest.tag);
  const namedArtifacts = values(document.text, /\bseal-v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?-[a-z0-9]+-[a-z0-9]+\b/g);
  if (manifest.artifacts) {
    const expectedArtifacts = new Set(manifest.artifacts.map((artifact) => artifact.name));
    const unknownArtifacts = [...new Set(namedArtifacts.filter((name) => !expectedArtifacts.has(name)))];
    const missingArtifacts = [...expectedArtifacts].filter((name) => !namedArtifacts.includes(name));
    if (unknownArtifacts.length) document.failures.push(`artifact names are not published release data: ${unknownArtifacts.join(", ")}`);
    if (missingArtifacts.length) document.failures.push(`published artifacts are absent: ${missingArtifacts.join(", ")}`);
  } else {
    requireAll("artifact", namedArtifacts, manifest.artifact.name);
  }
  requireAll("tag commit", values(document.text, /\b([0-9a-f]{40})\b/g), manifest.commitSha);
  requireAll("artifact byte count", values(document.text, /\bartifact_bytes=(\d+)\b/g), manifest.artifact.bytes);
  requireAll("checker byte count", values(document.text, /\bchecker_bytes=(\d+)\b/g), manifest.checker.bytes);

  const digests = values(document.text, /\b([0-9a-f]{64})\b/g);
  const allowedDigests = new Set([
    manifest.artifact.sha256,
    manifest.checker.sha256,
    manifest.checksums.sha256,
    manifest.artifact.installedTreeSha256,
  ]);
  const unknownDigests = [...new Set(digests.filter((digest) => !allowedDigests.has(digest)))];
  if (unknownDigests.length) document.failures.push(`digest is not published release data: ${unknownDigests.join(", ")}`);
  for (const [label, digest] of [
    ["artifact digest", manifest.artifact.sha256],
    ["checker digest", manifest.checker.sha256],
    ["SHA256SUMS digest", manifest.checksums.sha256],
    ["installed-tree digest", manifest.artifact.installedTreeSha256],
  ]) {
    if (!digests.includes(digest)) document.failures.push(`${label} is absent`);
  }

  const schemas = values(document.text, /\b(seal\.release\/v\d+)\b/g);
  const manifestNames = values(document.text, /\b(release-manifest\.json)\b/g);
  if (manifestPublished) {
    requireAll("manifest schema", schemas, manifest.schema);
    requireAll("manifest asset", manifestNames, "release-manifest.json");
  } else {
    if (schemas.length) document.failures.push(`claims manifest schema ${[...new Set(schemas)].join(", ")} but the release publishes no manifest`);
    if (manifestNames.length) document.failures.push("claims release-manifest.json but the release publishes no such asset");
  }

  requireAll("minimum Node major", values(document.text, /\bNode (?:>= )?(\d+)\+?/g), manifest.minimumNodeMajor);
  if (!document.text.includes(manifest.checker.name)) document.failures.push(`checker asset ${manifest.checker.name} is absent`);
  if (!document.text.includes(manifest.checksums.name)) document.failures.push(`checksum asset ${manifest.checksums.name} is absent`);
  if (!document.text.includes(platformSentence(manifest.platform))) document.failures.push(`platform ${platformSentence(manifest.platform)} is absent`);
  return document;
}

function checkReadmePublishedClaims(facts) {
  const document = generatedClaims("README.md", 1);
  const { manifest } = facts;
  for (const expected of [
    `SEAL_VERSION=${manifest.tag}`,
    `artifact_name=${JSON.stringify(manifest.artifact.name)}`,
    `artifact_sha256=${JSON.stringify(manifest.artifact.sha256)}`,
    `artifact_bytes=${manifest.artifact.bytes}`,
    `sums_name=${JSON.stringify(manifest.checksums.name)}`,
    `sums_sha256=${JSON.stringify(manifest.checksums.sha256)}`,
  ]) {
    if (document.text.split(expected).length - 1 !== 1) document.failures.push(`published install fact is absent or duplicated: ${expected}`);
  }
  const sourceVersion = process.env.SEAL_RELEASE_SOURCE_VERSION
    ?? fs.readFileSync(path.resolve(import.meta.dirname, "../VERSION"), "utf8").trim();
  if (manifest.tag === `v${sourceVersion}` && document.text.includes("The current source is the unreleased")) {
    document.failures.push(`source/release divergence claim is present even though source and release both name ${manifest.tag}`);
  }
  return document;
}

function verifyDocsAgainstRelease(facts) {
  const documents = [
    checkReadmePublishedClaims(facts),
    checkPublishedClaims(generatedClaims("docs/start/install.md", 2), facts),
  ];
  const failed = documents.filter((document) => document.failures.length);
  if (failed.length) {
    for (const document of failed) {
      for (const failure of document.failures) {
        process.stderr.write(`FAIL release docs disagree with published release: ${document.relative}: ${failure}\n`);
      }
    }
    return false;
  }
  return true;
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
  const facts = manifestPath
    ? localManifest(path.resolve(manifestPath), path.resolve(assetsDir), localCommit)
    : await remoteManifest();
  const generatedRegionChanges = [
    replaceRegions("README.md", readmeRegions(facts)),
    replaceRegions("docs/start/install.md", installRegions(facts)),
  ];
  const publishedPointerChanges = publishedSurfaceChanges(facts.manifest);
  const changes = [...generatedRegionChanges, ...publishedPointerChanges];
  if (process.argv.includes("--check")) {
    // Legacy generated regions are checked by their published facts below;
    // forcing old prose through today's template would rewrite history. The
    // separately owned navigation pointers do have one canonical current form.
    const stale = publishedPointerChanges.filter((change) => change.original !== change.rewritten);
    for (const change of stale) process.stderr.write(`FAIL release docs stale: ${change.relative}\n`);
    if (!verifyDocsAgainstRelease(facts) || stale.length) {
      process.exitCode = 1;
      return;
    }
    process.stdout.write(`PASS release docs match latest published release ${facts.manifest.tag}\n`);
    return;
  }
  const stale = changes.filter((change) => change.original !== change.rewritten);
  for (const change of stale) {
    fs.writeFileSync(change.target, change.rewritten);
    process.stdout.write(`updated ${change.relative}\n`);
  }
  if (!stale.length) process.stdout.write(`unchanged release docs for ${facts.manifest.tag}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
