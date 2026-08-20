// SPDX-License-Identifier: Apache-2.0
const fs = require("node:fs");
const path = require("node:path");

// REGION BOUNDARY: previous fence, else start of file.
// A role marker declares the fence it sits above, so this fence's declaration
// region is every line after the previous fence (or from the start of the file
// when there is no previous fence). The previous fence is the boundary because
// a marker above an earlier fence already declared that earlier fence; anything
// between — comment, blank line, prose, padding — is still this fence's
// preamble and cannot hide a marker.
const REGION_BOUNDARY = "previous-fence-or-start-of-file";

// Shared file set. Both the pin and repin read exactly these paths, from this
// one array. docs/COMPREHENSION-CHECK.md is included even though it currently
// quotes no store hash, so a conflict planted there cannot be visible to only
// one consumer.
const INSTALLED_TREE_PIN_FILES = Object.freeze([
  "README.md",
  "docs/guide/README.md",
  "docs/COMPREHENSION-CHECK.md",
]);

// Leading and trailing whitespace are stripped before matching. Padding is not
// part of the declaration: trailing spaces must not hide a marker, and an
// indented marker in the region is still a marker, not an absence.
const ROLE_MARKER = /^\*\*Seal installed-tree pin role:\*\* `([A-Za-z0-9][A-Za-z0-9-]*)`$/;
const KNOWN_ROLES = new Set(["published-asset", "fresh-build"]);

// CommonMark fence line, identical to docs/check-fenced-languages.mjs.
// Opening: 0-3 spaces, 3 or more backticks or tildes, then an info string.
// Closing: same marker character, length >= opening length, empty info string.
const FENCE_LINE = /^( {0,3})(`{3,}|~{3,})(.*)$/;

// Store directory names are the hex spelling of a SHA-256.
// Reading 1, cryptographic identity: hexadecimal is case-insensitive, so
// 5181F37E… and 5181f37e… are the same digest.
// Reading 2, store path: on this platform (Linux) the filesystem is
// case-sensitive, so /store/5181F37E… and /store/5181f37e… are different
// directories. The installer materializes lowercase names.
// Both readings are handled: a classified hit carries cryptoIdentity
// (lowercase) and the original spelling; a non-lowercase spelling is a named
// refusal on a case-sensitive filesystem because it cannot name the installer's
// store directory. Case must not make a store hash invisible.
const STORE_PATHS_CASE_SENSITIVE = process.platform === "linux";

function lineNumber(text, index) {
  return text.slice(0, index).split("\n").length;
}

function matchRoleMarker(line) {
  return line.replace(/\r$/, "").trim().match(ROLE_MARKER);
}

function matchFenceLine(line) {
  return line.replace(/\r$/, "").match(FENCE_LINE);
}

function lineOffsets(text) {
  const lines = text.split("\n");
  const offsets = [];
  let offset = 0;
  for (let index = 0; index < lines.length; index += 1) {
    offsets.push(offset);
    offset += lines[index].length + (index < lines.length - 1 ? 1 : 0);
  }
  return { lines, offsets };
}

function listMarkdownFenceSpans(text) {
  const { lines } = lineOffsets(text);
  const spans = [];
  let open = null;
  for (let index = 0; index < lines.length; index += 1) {
    const fence = matchFenceLine(lines[index]);
    if (!fence) continue;
    const marker = fence[2];
    const info = fence[3];
    if (open === null) {
      open = { markerChar: marker[0], markerLength: marker.length, openIndex: index };
      continue;
    }
    if (marker[0] === open.markerChar && marker.length >= open.markerLength && !info.trim()) {
      spans.push({
        openIndex: open.openIndex,
        closeIndex: index,
        markerChar: open.markerChar,
        markerLength: open.markerLength,
        openLine: open.openIndex + 1,
        closeLine: index + 1,
      });
      open = null;
    }
  }
  if (open !== null) {
    spans.push({
      openIndex: open.openIndex,
      closeIndex: null,
      markerChar: open.markerChar,
      markerLength: open.markerLength,
      openLine: open.openIndex + 1,
      closeLine: null,
    });
  }
  return spans;
}

function listInstalledTreePinFiles() {
  return INSTALLED_TREE_PIN_FILES;
}

function fencedRegions(text) {
  const { lines, offsets } = lineOffsets(text);
  const spans = listMarkdownFenceSpans(text);
  const fenceIndexes = [];
  for (const span of spans) {
    fenceIndexes.push(span.openIndex);
    if (span.closeIndex !== null) fenceIndexes.push(span.closeIndex);
  }

  return spans.map((span) => {
    let regionBegin = 0;
    for (const fenceIndex of fenceIndexes) {
      if (fenceIndex < span.openIndex) regionBegin = fenceIndex + 1;
    }
    const markers = [];
    for (let markerIndex = regionBegin; markerIndex < span.openIndex; markerIndex += 1) {
      const marker = matchRoleMarker(lines[markerIndex]);
      if (!marker) continue;
      markers.push({
        role: marker[1],
        line: markerIndex + 1,
        start: offsets[markerIndex],
      });
    }
    const closeIndex = span.closeIndex;
    const end = closeIndex === null
      ? text.length
      : offsets[closeIndex] + lines[closeIndex].length + (closeIndex < lines.length - 1 ? 1 : 0);
    return {
      start: offsets[span.openIndex],
      end,
      regionStart: markers.length > 0 ? markers[0].start : offsets[span.openIndex],
      openingLine: span.openLine,
      markers,
    };
  });
}

function classifyHashToken(token) {
  if (/^[0-9a-fA-F]{64}$/.test(token)) {
    const cryptoIdentity = token.toLowerCase();
    return {
      hashShaped: true,
      classified: "hex-sha256",
      spelling: token,
      cryptoIdentity,
      nonCanonicalCase: token !== cryptoIdentity,
    };
  }
  if (/^0x[0-9a-fA-F]{64}$/i.test(token)) {
    return {
      hashShaped: true,
      classified: null,
      spelling: token,
      reason: `0x-prefixed hex is not a store-hash spelling: ${token}`,
    };
  }
  const stripped = token.replace(/[:._-]/g, "");
  if (stripped !== token && /^[0-9a-fA-F]+$/.test(stripped) && stripped.length >= 32) {
    return {
      hashShaped: true,
      classified: null,
      spelling: token,
      reason: `separated hex is not a store-hash spelling: ${token}`,
    };
  }
  if (/^[A-Za-z0-9+/]{43,44}={0,2}$/.test(token) && token.length >= 43 && token.length <= 44) {
    return {
      hashShaped: true,
      classified: null,
      spelling: token,
      reason: `base64 digest is not a store-hash spelling: ${token}`,
    };
  }
  if (/^[0-9a-fA-F]+$/.test(token) && token.length >= 32) {
    return {
      hashShaped: true,
      classified: null,
      spelling: token,
      reason: `hex length ${token.length} is not a SHA-256 store hash: ${token}`,
    };
  }
  return { hashShaped: false, classified: null, spelling: token };
}

function findHashCandidates(text) {
  const candidates = [];
  for (const match of text.matchAll(/\/store\/([^\s/]+)/g)) {
    const token = match[1];
    const classified = classifyHashToken(token);
    if (!classified.hashShaped) continue;
    const tokenIndex = match.index + "/store/".length;
    candidates.push({
      context: "store",
      token,
      index: tokenIndex,
      line: lineNumber(text, tokenIndex),
      spacing: "ok",
      ...classified,
    });
  }
  // `tree:` with optional space, or `tree` with required space. Do not match
  // identifiers such as treeSha256.
  for (const match of text.matchAll(/\btree(:(?:[ \t]*)|[ \t]+)([^\s]+)/g)) {
    const token = match[2];
    const classified = classifyHashToken(token);
    if (!classified.hashShaped) continue;
    const delimiter = match[1];
    const spacing = delimiter.startsWith(":") && !/[ \t]/.test(delimiter) ? "missing" : "ok";
    const tokenIndex = match.index + "tree".length + delimiter.length;
    candidates.push({
      context: "tree",
      token,
      index: tokenIndex,
      line: lineNumber(text, tokenIndex),
      spacing,
      ...classified,
    });
  }
  candidates.sort((left, right) => left.index - right.index);
  return candidates;
}

function formatInstalledTreeRefusal(issue) {
  return `REFUSE ${issue.code}: ${issue.file}:${issue.line} ${issue.reason}`;
}

function scanInstalledTreeRegions(text, file = "<memory>") {
  const { lines, offsets } = lineOffsets(text);
  const regions = fencedRegions(text);
  const fenceIndexes = [];
  for (const span of listMarkdownFenceSpans(text)) {
    fenceIndexes.push(span.openIndex);
    if (span.closeIndex !== null) fenceIndexes.push(span.closeIndex);
  }
  const candidates = findHashCandidates(text);
  const issues = [];
  const validHits = [];

  for (const candidate of candidates) {
    if (candidate.context === "tree" && candidate.spacing === "missing" && candidate.classified === "hex-sha256") {
      issues.push({
        code: "tree_hash_spacing",
        file,
        line: candidate.line,
        index: candidate.index,
        reason: `tree hash must contain whitespace after "tree:"; found tree:${candidate.spelling}`,
      });
      continue;
    }
    if (candidate.classified !== "hex-sha256") {
      issues.push({
        code: "unclassified_hash_shape",
        file,
        line: candidate.line,
        index: candidate.index,
        reason: candidate.reason || `hash-shaped token ${JSON.stringify(candidate.token)} cannot be classified as a store hash`,
      });
      continue;
    }
    if (candidate.nonCanonicalCase && STORE_PATHS_CASE_SENSITIVE) {
      issues.push({
        code: "store_hash_case",
        file,
        line: candidate.line,
        index: candidate.index,
        reason:
          `store paths are case-sensitive on this platform; quoted spelling ${candidate.spelling} ` +
          `cannot name the installer store ${candidate.cryptoIdentity}`,
      });
    }
    validHits.push({
      hash: candidate.cryptoIdentity,
      spelling: candidate.spelling,
      index: candidate.index,
      line: candidate.line,
      role: null,
      region: null,
    });
  }

  const conflictedRegions = new Set();
  for (const region of regions) {
    const carriesHash = candidates.some((hit) => hit.index >= region.start && hit.index < region.end);
    if (!carriesHash || region.markers.length <= 1) continue;
    conflictedRegions.add(region);
    const roles = region.markers.map((marker) => `${marker.role} at line ${marker.line}`).join(", ");
    issues.push({
      code: "role_marker_conflict",
      file,
      line: region.markers[0].line,
      index: region.regionStart,
      reason: `conflicting installed-tree role markers (${roles}); region must declare exactly one role`,
    });
  }

  const reportedUnknownRegions = new Set();
  for (const hit of validHits) {
    const region = regions.find((candidate) => hit.index >= candidate.start && hit.index < candidate.end);
    hit.region = region || null;
    if (!region || region.markers.length === 0) {
      issues.push({
        code: "role_marker_absent",
        file,
        line: hit.line,
        index: hit.index,
        reason:
          "store hash has no role marker; add " +
          "**Seal installed-tree pin role:** `published-asset` or " +
          "**Seal installed-tree pin role:** `fresh-build` in the declaration region above its fenced block " +
          "(every line after the previous fence, or from the start of the file if there is no previous fence)",
      });
      continue;
    }
    if (conflictedRegions.has(region)) continue;
    const marker = region.markers[0];
    if (!KNOWN_ROLES.has(marker.role)) {
      if (!reportedUnknownRegions.has(region)) {
        reportedUnknownRegions.add(region);
        issues.push({
          code: "role_marker_unknown",
          file,
          line: marker.line,
          index: marker.start,
          reason: `unknown store-hash role ${JSON.stringify(marker.role)} for hash at line ${hit.line}`,
        });
      }
      continue;
    }
    hit.role = marker.role;
  }

  for (let index = 0; index < lines.length; index += 1) {
    const marker = matchRoleMarker(lines[index]);
    if (!marker) continue;
    const hasFenceAfter = fenceIndexes.some((fenceIndex) => fenceIndex > index);
    if (hasFenceAfter) continue;
    issues.push({
      code: "role_marker_orphan",
      file,
      line: index + 1,
      index: offsets[index],
      reason:
        `orphan installed-tree role marker ${JSON.stringify(marker[1])} has no fence after it; ` +
        "a role marker must declare the fenced block it sits above",
    });
  }

  issues.sort((left, right) => left.index - right.index);
  return { regions, hits: validHits, issues, candidates };
}

function readInstalledTreePinFile(root, file) {
  const target = path.join(root, file);
  try {
    const stat = fs.statSync(target);
    if ((stat.mode & 0o444) === 0) {
      return {
        file,
        text: "",
        scanned: {
          regions: [],
          hits: [],
          issues: [{
            code: "pin_file_unreadable",
            file,
            line: 1,
            index: 0,
            reason: `installed-tree pin file unreadable: ${file}: file has no read bits`,
          }],
        },
      };
    }
    const text = fs.readFileSync(target, "utf8");
    return { file, text, scanned: scanInstalledTreeRegions(text, file) };
  } catch (error) {
    const code = error && error.code === "ENOENT" ? "pin_file_missing" : "pin_file_unreadable";
    return {
      file,
      text: "",
      scanned: {
        regions: [],
        hits: [],
        issues: [{
          code,
          file,
          line: 1,
          index: 0,
          reason: `cannot read installed-tree pin file ${file}: ${error.message}`,
        }],
      },
    };
  }
}

function scanInstalledTreePinFiles(root) {
  return listInstalledTreePinFiles().map((file) => readInstalledTreePinFile(root, file));
}

module.exports = {
  REGION_BOUNDARY,
  INSTALLED_TREE_PIN_FILES,
  FENCE_LINE,
  STORE_PATHS_CASE_SENSITIVE,
  formatInstalledTreeRefusal,
  listInstalledTreePinFiles,
  listMarkdownFenceSpans,
  classifyHashToken,
  scanInstalledTreeRegions,
  scanInstalledTreePinFiles,
};
