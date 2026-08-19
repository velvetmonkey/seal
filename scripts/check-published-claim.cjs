#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Every version-looking token in tracked text is denied unless GitHub's live
// release list publishes that exact version or the token is in one declared,
// narrowly bounded historical section. Network failure is UNKNOWN, never an
// empty release list or a green result.
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const ROOT = path.join(__dirname, "..");
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const VERSION_TOKEN = /(?<![0-9A-Za-z.])v?\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?![0-9A-Za-z-]|\.[0-9A-Za-z-])/g;
const UTF8 = new TextDecoder("utf-8", { fatal: true });
const UTF16LE = new TextDecoder("utf-16le", { fatal: true });
const UTF16BE = new TextDecoder("utf-16be", { fatal: true });
const LATIN1 = new TextDecoder("latin1");
const versionValue = (...parts) => parts.join(".");

// This is the only exemption list. Every version exemption names an exact
// token and an anchored section; none ignores a whole file. Each reason says
// why the token is historical or fixture evidence rather than a Seal release
// claim. The one empty-file entry preserves the repository's asserted
// between-releases SHA256SUMS state while every other empty tracked file fails.
const DECLARED_EXEMPTIONS = [
  {
    kind: "empty-file",
    file: "SHA256SUMS",
    reason: "The root release pin is intentionally empty between releases; the live release SHA256SUMS asset remains authoritative.",
  },
  {
    kind: "version-section",
    file: "contract/renderer.cjs",
    versions: [versionValue("2", "1", "232")],
    start: "// The approval-dialog renderer",
    end: "//   Approval required",
    reason: "This measured Claude Code client version identifies the historical terminal-size observation, not a Seal release.",
  },
  {
    kind: "version-section",
    file: "docs/CLAUDE-CODE-EVIDENCE.md",
    versions: [versionValue("0", "0", "0-synthetic-stand-in")],
    start: "The four labels below remain useful warnings",
    end: "Removing the warnings does not launder the pack",
    reason: "This section documents the deliberately synthetic client's self-identifying fixture version.",
  },
  {
    kind: "version-section",
    file: "docs/OPEN-FINDINGS.md",
    versions: [versionValue("4", "28", "0")],
    start: "| 37 |",
    end: "\n\n---",
    reason: "Open finding 37 records the historical upstream Lean toolchain version used by the cited experiment.",
  },
  {
    kind: "version-section",
    file: "docs/OPEN-FINDINGS.md",
    versions: [versionValue("3", "0", "0")],
    start: "| 39 |",
    end: "\n| 40 |",
    reason: "Open finding 39 records the historical ed25519-dalek dependency version under review.",
  },
  {
    kind: "version-section",
    file: "docs/ROADMAP-KERNEL-OUTWARD.md",
    versions: [versionValue("6", "0", "0")],
    start: "2.6 **Emscripten toolchain availability",
    end: "2.7 **Keep the completed numeric work complete",
    reason: "This closed roadmap section records the historical Emscripten toolchain measurement.",
  },
  {
    kind: "version-section",
    file: "docs/guide/README.md",
    versions: [versionValue("2", "1", "233")],
    start: "Check the last one first:",
    end: "Download a binary and the `SHA256SUMS` asset",
    reason: "This transcript identifies Claude Code, a third-party prerequisite, rather than a Seal release.",
  },
  {
    kind: "version-section",
    file: "harness/claude-code/cc-harness.cjs",
    versions: [versionValue("0", "0", "0-synthetic-stand-in")],
    start: "state.claude = options[\"client-command\"]",
    end: "// Install the pinned artifact",
    reason: "The harness assigns its explicit synthetic stand-in fixture version in this branch.",
  },
  {
    kind: "version-section",
    file: "harness/claude-code/synthetic-client.cjs",
    versions: [versionValue("0", "0", "0-synthetic-stand-in")],
    start: "await link.request(\"initialize\"",
    end: "if (args[0] === \"mcp\")",
    reason: "The synthetic client reports its fixture-only identity in initialization and --version output.",
  },
  {
    kind: "version-section",
    file: "runtime/kernel/kernel.js",
    versions: [versionValue("4", "28", "0")],
    start: "export const LEAN_TOOLCHAIN",
    end: "export const KERNEL_AXIOMS",
    reason: "This constant pins the upstream Lean compiler toolchain, not a Seal release.",
  },
  {
    kind: "version-section",
    file: "scripts/check-version-drift.cjs",
    versions: [versionValue("1", "1", "0-rc", "1")],
    start: "const fixtureVersions = new Set",
    end: "for (const file of files)",
    reason: "The older drift check explicitly declares this isolated collision-test fixture version.",
  },
  {
    kind: "version-section",
    file: "test/cc-evidence.test.cjs",
    versions: [versionValue("9", "9", "9")],
    start: "function promotedSyntheticPack()",
    end: "test(\"the frisk's exact synthetic promotion",
    reason: "These tests forge one fake Claude Code client version and prove its evidence cannot be promoted.",
  },
  {
    kind: "version-section",
    file: "test/executable-population.test.mjs",
    versions: [versionValue("0", "0", "0")],
    start: "function fixture()",
    end: "function executable(",
    reason: "The executable-population unit fixture needs a non-product VERSION file to initialize its scratch repository.",
  },
  {
    kind: "version-section",
    file: "test/failure5.test.cjs",
    versions: [versionValue("0", "0", "0")],
    start: "test(\"5a incompatible state (version)",
    end: "test(\"5b incompatible state (schema)",
    reason: "This negative test writes an intentionally incompatible stored-state version.",
  },
  {
    kind: "version-section",
    file: "test/protect3b.test.cjs",
    versions: [versionValue("0", "0", "0")],
    start: "test(\"protect names install-time refusals",
    end: "test(\"proxy activation promotes pending",
    reason: "This refusal test writes an intentionally incompatible protected-state version.",
  },
  {
    kind: "version-section",
    file: "test/version-identity-gate.test.cjs",
    versions: [versionValue("1", "1", "0-rc", "1")],
    start: "test(\"version identity gate refuses a claim inherited from only one merge base",
    end: "test(\"version identity gate distinguishes an absent committed VERSION",
    reason: "These two criss-cross history fixtures create a local alternate tag to test merge-base ownership.",
  },
  {
    kind: "version-section",
    file: "test/version-identity.test.cjs",
    versions: [versionValue("9", "9", "9"), versionValue("9", "9", "10")],
    start: "test(\"sync leaves no old product version",
    end: null,
    reason: "This final unit test uses sentinel bump values only inside a scratch copy to prove stale literals are removed.",
  },
];

function fail(message) {
  console.error(`FAIL published_claim: ${message}`);
  process.exit(1);
}

function unknown(message) {
  console.error(`UNKNOWN published_claim: ${message}`);
  process.exit(2);
}

function readVersion() {
  const file = path.join(ROOT, "VERSION");
  let stat;
  try {
    stat = fs.statSync(file);
  } catch (error) {
    fail(`VERSION: tracked file is absent or unreadable: ${error.message}`);
  }
  if ((stat.mode & 0o444) === 0) fail("VERSION: tracked file has no read permission bits");
  let version;
  try {
    version = fs.readFileSync(file, "utf8").trim();
  } catch (error) {
    fail(`VERSION: tracked file is unreadable: ${error.message}`);
  }
  if (version === "") fail("VERSION: tracked file is empty");
  if (!SEMVER.test(version)) fail(`VERSION is not SemVer: ${version}`);
  return version;
}

function originRepo() {
  let url;
  try {
    url = execFileSync("git", ["config", "--get", "remote.origin.url"], { cwd: ROOT, encoding: "utf8" }).trim();
  } catch (error) {
    unknown(`cannot determine origin repository: ${error.message}`);
  }
  const match = url.match(/github\.com[/:]([^/]+)\/([^/]+?)(?:\.git)?$/);
  if (!match) unknown(`origin is not a GitHub repository: ${url}`);
  return `${match[1]}/${match[2]}`;
}

async function get(url, purpose = "GitHub releases API") {
  let response;
  try {
    response = await fetch(url, { headers: { accept: "application/vnd.github+json" } });
  } catch (error) {
    unknown(`cannot reach ${purpose}: ${error.message}`);
  }
  if (!response.ok) unknown(`${purpose} returned HTTP ${response.status} for ${url}`);
  return response;
}

function nextPage(response) {
  const links = response.headers.get("link");
  if (!links) return null;
  for (const item of links.split(",")) {
    const match = item.match(/^\s*<([^>]+)>\s*;\s*rel="([^"]+)"\s*$/);
    if (match && match[2].split(/\s+/).includes("next")) return match[1];
  }
  return null;
}

async function publishedReleases(firstUrl) {
  const releases = [];
  const seen = new Set();
  let url = firstUrl;
  while (url) {
    if (seen.has(url)) unknown(`GitHub releases pagination repeated ${url}`);
    seen.add(url);
    const response = await get(url);
    let page;
    try {
      page = await response.json();
    } catch (error) {
      unknown(`cannot parse GitHub releases response from ${url}: ${error.message}`);
    }
    if (!Array.isArray(page)) unknown(`GitHub releases response from ${url} was not an array`);
    releases.push(...page);
    url = nextPage(response);
  }
  return releases;
}

function trackedFiles() {
  let output;
  try {
    output = execFileSync("git", ["ls-files", "-z"], { cwd: ROOT });
  } catch (error) {
    unknown(`cannot enumerate tracked files: ${error.message}`);
  }
  const files = output.toString("utf8").split("\0").filter(Boolean);
  if (files.length === 0) unknown("tracked file inventory is empty");
  return files;
}

function emptyFileIsDeclared(file) {
  return DECLARED_EXEMPTIONS.some((entry) => entry.kind === "empty-file" && entry.file === file);
}

function decodeText(bytes) {
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) return UTF16LE.decode(bytes.subarray(2));
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) return UTF16BE.decode(bytes.subarray(2));
  if (bytes.includes(0)) {
    const pairs = Math.floor(bytes.length / 2);
    let evenNuls = 0;
    let oddNuls = 0;
    for (let index = 0; index < pairs * 2; index += 2) {
      if (bytes[index] === 0) evenNuls += 1;
      if (bytes[index + 1] === 0) oddNuls += 1;
    }
    if (pairs > 0 && oddNuls / pairs >= 0.4 && evenNuls / pairs <= 0.1) return UTF16LE.decode(bytes);
    if (pairs > 0 && evenNuls / pairs >= 0.4 && oddNuls / pairs <= 0.1) return UTF16BE.decode(bytes);
    return null;
  }
  try {
    return UTF8.decode(bytes);
  } catch {
    // A NUL-free legacy single-byte document is still text for this check.
    // Latin-1 preserves every ASCII version token while decoding every byte.
    return LATIN1.decode(bytes);
  }
}

function trackedContent() {
  const documents = [];
  const binary = [];
  const files = trackedFiles();
  for (const file of files) {
    const absolute = path.join(ROOT, file);
    let stat;
    try {
      stat = fs.lstatSync(absolute);
    } catch (error) {
      fail(`${file}: tracked file is absent: ${error.message}`);
    }
    if (!stat.isSymbolicLink() && (stat.mode & 0o444) === 0) {
      fail(`${file}: tracked file has no read permission bits`);
    }
    let bytes;
    try {
      bytes = stat.isSymbolicLink()
        ? Buffer.from(fs.readlinkSync(absolute), "utf8")
        : fs.readFileSync(absolute);
    } catch (error) {
      fail(`${file}: tracked file is unreadable: ${error.message}`);
    }
    if (bytes.length === 0 && !emptyFileIsDeclared(file)) fail(`${file}: tracked file is empty`);
    const text = decodeText(bytes);
    if (text === null) {
      binary.push(file);
      continue;
    }
    documents.push({ file, text });
  }
  return { documents, binary, files };
}

function decodeEntity(entity) {
  const lower = entity.toLowerCase();
  if (lower.startsWith("&#x")) {
    const value = Number.parseInt(entity.slice(3).replace(/;$/, ""), 16);
    if (Number.isInteger(value) && value >= 0 && value <= 0x10ffff && !(value >= 0xd800 && value <= 0xdfff)) {
      return String.fromCodePoint(value);
    }
    return null;
  }
  if (lower.startsWith("&#")) {
    const value = Number.parseInt(entity.slice(2).replace(/;$/, ""), 10);
    if (Number.isInteger(value) && value >= 0 && value <= 0x10ffff && !(value >= 0xd800 && value <= 0xdfff)) {
      return String.fromCodePoint(value);
    }
    return null;
  }
  const named = {
    "&amp;": "&",
    "&apos;": "'",
    "&gt;": ">",
    "&lt;": "<",
    "&nbsp;": "\u00a0",
    "&period;": ".",
    "&quot;": "\"",
  };
  return named[lower] || null;
}

function normalize(text, collapseLines) {
  const entity = /&(?:#x[0-9a-f]+;?|#[0-9]+;?|amp;|apos;|gt;|lt;|nbsp;|period;|quot;)/gi;
  let value = "";
  const sourceOffsets = [];
  let cursor = 0;

  function append(chunk, sourceOffset) {
    for (let index = 0; index < chunk.length; index += 1) {
      if (chunk[index] === "\r" || chunk[index] === "\n") {
        if (!collapseLines) {
          value += " ";
          sourceOffsets.push(sourceOffset + index);
        }
        continue;
      }
      value += chunk[index];
      sourceOffsets.push(sourceOffset + index);
    }
  }

  for (const match of text.matchAll(entity)) {
    append(text.slice(cursor, match.index), cursor);
    const decoded = decodeEntity(match[0]);
    if (decoded === null) append(match[0], match.index);
    else {
      for (const character of decoded) {
        if (character === "\r" || character === "\n") {
          if (!collapseLines) {
            value += " ";
            sourceOffsets.push(match.index);
          }
          continue;
        }
        value += character;
        for (let index = 0; index < character.length; index += 1) sourceOffsets.push(match.index);
      }
    }
    cursor = match.index + match[0].length;
  }
  append(text.slice(cursor), cursor);
  return { value, sourceOffsets };
}

function lineNumber(text, offset) {
  let line = 1;
  for (let index = 0; index < offset; index += 1) if (text[index] === "\n") line += 1;
  return line;
}

function sectionBounds(document, exemption) {
  const start = document.text.indexOf(exemption.start);
  if (start < 0) fail(`declared exemption for ${exemption.file} lost its start anchor: ${exemption.start}`);
  if (document.text.indexOf(exemption.start, start + exemption.start.length) >= 0) {
    fail(`declared exemption for ${exemption.file} has an ambiguous start anchor: ${exemption.start}`);
  }
  const end = exemption.end === null
    ? document.text.length
    : document.text.indexOf(exemption.end, start + exemption.start.length);
  if (end < 0) fail(`declared exemption for ${exemption.file} lost its end anchor: ${exemption.end}`);
  return { start, end };
}

function isDeclaredVersion(document, version, sourceOffset) {
  return DECLARED_EXEMPTIONS.some((entry) => {
    if (entry.kind !== "version-section" || entry.file !== document.file || !entry.versions.includes(version)) return false;
    const bounds = sectionBounds(document, entry);
    return sourceOffset >= bounds.start && sourceOffset < bounds.end;
  });
}

function validateExemptionAnchors(documents) {
  const byFile = new Map(documents.map((document) => [document.file, document]));
  for (const entry of DECLARED_EXEMPTIONS) {
    if (entry.kind !== "version-section") continue;
    const document = byFile.get(entry.file);
    if (!document) continue;
    const bounds = sectionBounds(document, entry);
    const section = { file: entry.file, text: document.text.slice(bounds.start, bounds.end) };
    const present = new Set(versionTokens(section).map((token) => token.version));
    for (const version of entry.versions) {
      if (!present.has(version)) fail(`declared exemption for ${entry.file} is stale: section contains no ${version}`);
    }
  }
}

function versionTokens(document) {
  const tokens = new Map();
  for (const collapseLines of [false, true]) {
    const normalized = normalize(document.text, collapseLines);
    for (const match of normalized.value.matchAll(VERSION_TOKEN)) {
      const sourceOffset = normalized.sourceOffsets[match.index] ?? 0;
      let left = match.index;
      let right = match.index + match[0].length;
      while (left > 0 && /[0-9A-Za-z_@:/.-]/.test(normalized.value[left - 1])) left -= 1;
      while (right < normalized.value.length && /[0-9A-Za-z_@:/.-]/.test(normalized.value[right])) right += 1;
      const token = {
        raw: match[0],
        version: match[0].replace(/^v/, ""),
        sourceOffset,
        line: lineNumber(document.text, sourceOffset),
        container: normalized.value.slice(left, right),
      };
      tokens.set(`${sourceOffset}\0${token.raw}`, token);
    }
  }
  return [...tokens.values()];
}

function publishedVersionForToken(token, published, publishedContainers) {
  if (published.has(token.version)) return token.version;
  const prefixes = [...published]
    .filter((version) => token.version.startsWith(`${version}-`) || token.version.startsWith(`${version}.`))
    .sort((left, right) => right.length - left.length);
  for (const version of prefixes) {
    for (const name of publishedContainers) {
      if (name.includes(token.raw) && token.container.includes(name)) return version;
    }
  }
  return null;
}

(async () => {
  const version = readVersion();
  const tag = `v${version}`;
  const repo = originRepo();
  const { documents, binary } = trackedContent();
  validateExemptionAnchors(documents);

  const api = process.env.SEAL_RELEASES_API || `https://api.github.com/repos/${repo}/releases?per_page=100`;
  const releases = await publishedReleases(api);
  const published = new Set();
  for (const release of releases) {
    if (!release || typeof release.tag_name !== "string" || release.draft === true) continue;
    const releasedVersion = release.tag_name.replace(/^v/, "");
    if (SEMVER.test(releasedVersion)) published.add(releasedVersion);
  }
  const publishedContainers = new Set([
    ...releases.flatMap((release) => typeof (release && release.tag_name) === "string"
      ? [`RELEASE-NOTES-${release.tag_name}.md`, `docs/RELEASE-NOTES-${release.tag_name}.md`]
      : []),
    ...releases.flatMap((release) => Array.isArray(release && release.assets)
      ? release.assets.map((asset) => asset && asset.name).filter((name) => typeof name === "string")
      : []),
  ]);

  const unpublished = [];
  let exemptOccurrences = 0;
  for (const document of documents) {
    for (const token of versionTokens(document)) {
      if (publishedVersionForToken(token, published, publishedContainers)) continue;
      if (isDeclaredVersion(document, token.version, token.sourceOffset)) {
        exemptOccurrences += 1;
        continue;
      }
      unpublished.push({ file: document.file, ...token });
    }
  }
  if (unpublished.length > 0) {
    for (const token of unpublished) {
      console.error(`${token.file}:${token.line}: unpublished version token ${token.raw}`);
    }
    fail(`${unpublished.length} unpublished version token(s); every non-exempt token must name a live GitHub release`);
  }

  const release = releases.find((candidate) => candidate && candidate.draft !== true && candidate.tag_name === tag);
  if (!release) fail(`VERSION:1: unpublished version token ${tag}`);
  if (!Array.isArray(release.assets)) unknown(`published ${tag} release has no readable assets list`);
  const sumsAsset = release.assets.find((asset) => asset && asset.name === "SHA256SUMS");
  if (!sumsAsset || typeof sumsAsset.browser_download_url !== "string") fail(`published ${tag} has no SHA256SUMS asset`);
  const sumsText = await (await get(sumsAsset.browser_download_url, `${tag} SHA256SUMS asset`)).text();
  const fields = sumsText.trim().split(/\s+/);
  if (fields.length !== 3 || !/^[0-9a-f]{64}$/.test(fields[0]) || !/^\d+$/.test(fields[1])) {
    fail(`published SHA256SUMS is malformed for ${tag}`);
  }
  const [digest, bytes, artifact] = fields;
  const artifactAsset = release.assets.find((asset) => asset && asset.name === artifact);
  if (!artifactAsset) fail(`published SHA256SUMS names missing asset ${artifact}`);
  const liveDigest = (artifactAsset.digest || "").replace(/^sha256:/, "");
  if (liveDigest && liveDigest !== digest) fail(`digest differs for ${artifact}: SHA256SUMS ${digest}, GitHub ${liveDigest}`);
  if (Number(artifactAsset.size) !== Number(bytes)) fail(`byte count differs for ${artifact}: SHA256SUMS ${bytes}, GitHub ${artifactAsset.size}`);

  const explicitDigests = documents.flatMap(({ file, text }) =>
    [...text.matchAll(/(?:--sha256|^sha256)\s+([0-9a-f]{64})/gm)].map((match) => ({ file, value: match[1] })));
  for (const claim of explicitDigests) {
    if (claim.value !== digest) fail(`${claim.file} leads readers to digest ${claim.value}, live SHA256SUMS says ${digest}`);
  }
  const explicitBytes = documents.flatMap(({ file, text }) =>
    [...text.matchAll(/(?:--bytes|^bytes)\s+(\d+)/gm)].map((match) => ({ file, value: match[1] })));
  for (const claim of explicitBytes) {
    if (claim.value !== bytes) fail(`${claim.file} leads readers to ${claim.value} bytes, live SHA256SUMS says ${bytes}`);
  }

  const fileWord = documents.length === 1 ? "file" : "files";
  const binaryWord = binary.length === 1 ? "file" : "files";
  console.log(
    `PASS published_claim: scanned ${documents.length} tracked text ${fileWord}, skipped ${binary.length} binary ${binaryWord}; `
    + `${published.size} live versions, ${exemptOccurrences} declared historical/fixture occurrences; `
    + `${tag} is published and ${artifact} digest and bytes match live SHA256SUMS`,
  );
})().catch((error) => unknown(`unanswerable release response: ${error.message}`));
