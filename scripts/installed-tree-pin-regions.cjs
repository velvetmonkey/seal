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
const TREE_HASH = /\btree:?\s+([0-9a-f]{64})\b/g;
const TREE_HASH_WITHOUT_SPACE = /\btree:([0-9a-f]{64})\b/g;
const STORE_HASH = /\/store\/([0-9a-f]{64})(?=\/|\b)/g;

function lineNumber(text, index) {
  return text.slice(0, index).split("\n").length;
}

function matchRoleMarker(line) {
  return line.replace(/\r$/, "").trim().match(ROLE_MARKER);
}

function isFenceLine(line) {
  return /^```/.test(line.replace(/\r$/, ""));
}

function listInstalledTreePinFiles() {
  return INSTALLED_TREE_PIN_FILES;
}

function fencedRegions(text) {
  const lines = text.split("\n");
  const offsets = [];
  let offset = 0;
  for (let index = 0; index < lines.length; index += 1) {
    offsets.push(offset);
    offset += lines[index].length + (index < lines.length - 1 ? 1 : 0);
  }

  const regions = [];
  let open = null;
  for (let index = 0; index < lines.length; index += 1) {
    if (!isFenceLine(lines[index])) continue;
    if (open === null) {
      let regionBegin = 0;
      for (let previous = index - 1; previous >= 0; previous -= 1) {
        if (isFenceLine(lines[previous])) {
          regionBegin = previous + 1;
          break;
        }
      }
      const markers = [];
      for (let markerIndex = regionBegin; markerIndex < index; markerIndex += 1) {
        const marker = matchRoleMarker(lines[markerIndex]);
        if (!marker) continue;
        markers.push({
          role: marker[1],
          line: markerIndex + 1,
          start: offsets[markerIndex],
        });
      }
      open = {
        start: offsets[index],
        end: text.length,
        regionStart: markers.length > 0 ? markers[0].start : offsets[index],
        openingLine: index + 1,
        markers,
      };
    } else {
      const width = lines[index].length + (index < lines.length - 1 ? 1 : 0);
      open.end = offsets[index] + width;
      regions.push(open);
      open = null;
    }
  }
  if (open !== null) regions.push(open);
  return regions;
}

function formatInstalledTreeRefusal(issue) {
  return `REFUSE ${issue.code}: ${issue.file}:${issue.line} ${issue.reason}`;
}

function scanInstalledTreeRegions(text, file = "<memory>") {
  const regions = fencedRegions(text);
  const validHits = [
    ...text.matchAll(TREE_HASH),
    ...text.matchAll(STORE_HASH),
  ].map((match) => ({
    hash: match[1],
    index: match.index,
    line: lineNumber(text, match.index),
    role: null,
    region: null,
  })).sort((left, right) => left.index - right.index);
  const malformedHits = [...text.matchAll(TREE_HASH_WITHOUT_SPACE)].map((match) => ({
    hash: match[1],
    index: match.index,
    line: lineNumber(text, match.index),
  }));
  const candidates = [...validHits, ...malformedHits];
  const issues = malformedHits.map((hit) => ({
    code: "tree_hash_spacing",
    file,
    line: hit.line,
    index: hit.index,
    reason: `tree hash must contain whitespace after "tree:"; found tree:${hit.hash}`,
  }));

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

  issues.sort((left, right) => left.index - right.index);
  return { regions, hits: validHits, issues };
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
  formatInstalledTreeRefusal,
  listInstalledTreePinFiles,
  scanInstalledTreeRegions,
  scanInstalledTreePinFiles,
};
