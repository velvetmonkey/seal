#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// A release claim is useful only if the named bytes exist.  Network failure is
// UNKNOWN, never a skip or a green result.
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const ROOT = path.join(__dirname, "..");
const version = fs.readFileSync(path.join(ROOT, "VERSION"), "utf8").trim();
const tag = `v${version}`;
const semver = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
if (!semver.test(version)) fail(`VERSION is not SemVer: ${version}`);

function fail(message) {
  console.error(`FAIL published_claim: ${message}`);
  process.exit(1);
}
function unknown(message) {
  console.error(`UNKNOWN published_claim: ${message}`);
  process.exit(2);
}
function originRepo() {
  let url;
  try { url = execFileSync("git", ["config", "--get", "remote.origin.url"], { cwd: ROOT, encoding: "utf8" }).trim(); }
  catch (error) { unknown(`cannot determine origin repository: ${error.message}`); }
  const match = url.match(/github\.com[/:]([^/]+)\/([^/]+?)(?:\.git)?$/);
  if (!match) unknown(`origin is not a GitHub repository: ${url}`);
  return `${match[1]}/${match[2]}`;
}
async function get(url) {
  try {
    const response = await fetch(url, { headers: { accept: "application/vnd.github+json" } });
    if (!response.ok) unknown(`GitHub returned HTTP ${response.status} for ${url}`);
    return response;
  } catch (error) {
    unknown(`cannot reach GitHub releases API: ${error.message}`);
  }
}
function trackedText() {
  let files;
  try { files = execFileSync("git", ["ls-files", "-z"], { cwd: ROOT }).toString().split("\0").filter(Boolean); }
  catch (error) { unknown(`cannot enumerate tracked documents: ${error.message}`); }
  return files.filter((file) => /\.(md|html|txt|yml|yaml|json|cjs|mjs|js|sh)$/.test(file))
    .map((file) => {
      try { return { file, text: fs.readFileSync(path.join(ROOT, file), "utf8") }; }
      catch (error) { unknown(`cannot read ${file}: ${error.message}`); }
    });
}
function downloadLines(documents) {
  return documents.flatMap(({ file, text }) => text.split(/\r?\n/).flatMap((line, index) =>
    /(?:releases\/download|curl\b|wget\b|download)/i.test(line)
      ? [{ file, line: index + 1, text: line }] : []));
}

(async () => {
  const repo = originRepo();
  const api = process.env.SEAL_RELEASES_API || `https://api.github.com/repos/${repo}/releases?per_page=100`;
  const releases = await (await get(api)).json();
  if (!Array.isArray(releases)) unknown("GitHub releases response was not an array");
  const release = releases.find((candidate) => candidate.tag_name === tag);
  const documents = trackedText();
  const currentNames = new RegExp(`(?:seal-v${version}-linux-x64|releases/download/${tag})(?:[^\\w]|$)`);
  const lines = downloadLines(documents);
  const selectedCurrent = documents.some(({ text }) => new RegExp(`SEAL_VERSION\\s*=\\s*${tag}\\b`).test(text));
  const genericReleaseDownload = lines.some(({ text }) => /releases\/download\/\$SEAL_VERSION/.test(text));
  const namedDownload = lines.filter(({ text }) => currentNames.test(text));
  if (selectedCurrent && genericReleaseDownload) {
    namedDownload.push({ file: "README.md", line: 0, text: `SEAL_VERSION=${tag} selects the generic release download instruction` });
  }
  if (!release) {
    if (!version.includes("-")) fail(`VERSION ${version} is not pre-release`);
    if (namedDownload.length) {
      namedDownload.forEach(({ file, line, text }) => console.error(`${file}:${line}: ${text.trim()}`));
      fail(`download instruction names unpublished v${version}`);
    }
    console.log(`PASS published_claim: v${version} is unpublished pre-release and no download names it`);
    return;
  }

  const sumsAsset = release.assets.find((asset) => asset.name === "SHA256SUMS");
  if (!sumsAsset) fail(`published v${version} has no SHA256SUMS asset`);
  const sumsText = await (await get(sumsAsset.browser_download_url)).text();
  const fields = sumsText.trim().split(/\s+/);
  if (fields.length !== 3 || !/^[0-9a-f]{64}$/.test(fields[0]) || !/^\d+$/.test(fields[1])) {
    fail(`published SHA256SUMS is malformed for v${version}`);
  }
  const [digest, bytes, artifact] = fields;
  const artifactAsset = release.assets.find((asset) => asset.name === artifact);
  if (!artifactAsset) fail(`published SHA256SUMS names missing asset ${artifact}`);
  const liveDigest = (artifactAsset.digest || "").replace(/^sha256:/, "");
  if (liveDigest && liveDigest !== digest) fail(`digest differs for ${artifact}: SHA256SUMS ${digest}, GitHub ${liveDigest}`);
  if (Number(artifactAsset.size) !== Number(bytes)) fail(`byte count differs for ${artifact}: SHA256SUMS ${bytes}, GitHub ${artifactAsset.size}`);

  const explicitDigests = documents.flatMap(({ file, text }) =>
    [...text.matchAll(/(?:--sha256|^sha256)\s+([0-9a-f]{64})/gm)].map((match) => ({ file, value: match[1] })));
  for (const claim of explicitDigests) if (claim.value !== digest) fail(`${claim.file} leads readers to digest ${claim.value}, live SHA256SUMS says ${digest}`);
  const explicitBytes = documents.flatMap(({ file, text }) =>
    [...text.matchAll(/(?:--bytes|^bytes)\s+(\d+)/gm)].map((match) => ({ file, value: match[1] })));
  for (const claim of explicitBytes) if (claim.value !== bytes) fail(`${claim.file} leads readers to ${claim.value} bytes, live SHA256SUMS says ${bytes}`);
  console.log(`PASS published_claim: v${version} is published; ${artifact} digest and bytes match live SHA256SUMS`);
})().catch((error) => unknown(`unanswerable release response: ${error.message}`));
