// SPDX-License-Identifier: Apache-2.0
// Scan installed-tree claims using the same visible Markdown structure readers see.
const ROLE_MARKER = /^\*\*Seal installed-tree pin role:\*\* `([A-Za-z0-9][A-Za-z0-9-]*)`\r?$/;
const KNOWN_ROLES = new Set(["published-asset", "fresh-build"]);
const TREE_HASH = /\btree:?\s+([0-9a-f]{64})\b/g;
const TREE_HASH_WITHOUT_SPACE = /\btree:([0-9a-f]{64})\b/g;
const STORE_HASH = /\/store\/([0-9a-f]{64})(?=\/|\b)/g;

function lineNumber(text, index) { return text.slice(0, index).split("\n").length; }
function invisibleLine(line) { return line.trim() === "" || /^\s*<!--(?:[\s\S]*?)-->\s*$/.test(line); }

function fencedRegions(text) {
  const lines = text.split("\n");
  const offsets = [];
  let offset = 0;
  for (let i = 0; i < lines.length; i += 1) {
    offsets.push(offset);
    offset += lines[i].length + (i < lines.length - 1 ? 1 : 0);
  }
  const regions = [];
  let open = null;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].replace(/\r$/, "");
    if (!/^```/.test(line)) continue;
    if (!open) {
      const markers = [];
      for (let j = i - 1; j >= 0; j -= 1) {
        const candidate = lines[j].replace(/\r$/, "");
        const marker = candidate.match(ROLE_MARKER);
        if (marker) {
          markers.unshift({ role: marker[1], line: j + 1, start: offsets[j] });
          continue;
        }
        if (invisibleLine(candidate)) continue;
        break;
      }
      open = { start: offsets[i], end: text.length, regionStart: markers[0]?.start ?? offsets[i], openingLine: i + 1, markers };
    } else {
      const width = lines[i].length + (i < lines.length - 1 ? 1 : 0);
      open.end = offsets[i] + width;
      regions.push(open);
      open = null;
    }
  }
  if (open) regions.push(open);
  return regions;
}

function formatInstalledTreeRefusal(issue) { return `REFUSE ${issue.code}: ${issue.file}:${issue.line} ${issue.reason}`; }

function scanInstalledTreeRegions(text, file = "<memory>") {
  const regions = fencedRegions(text);
  const validHits = [...text.matchAll(TREE_HASH), ...text.matchAll(STORE_HASH)]
    .map((match) => ({ hash: match[1], index: match.index, line: lineNumber(text, match.index), role: null, region: null }))
    .sort((a, b) => a.index - b.index);
  const malformedHits = [...text.matchAll(TREE_HASH_WITHOUT_SPACE)].map((match) => ({ hash: match[1], index: match.index, line: lineNumber(text, match.index) }));
  const issues = malformedHits.map((hit) => ({ code: "tree_hash_spacing", file, line: hit.line, index: hit.index, reason: `tree hash must contain whitespace after "tree:"; found tree:${hit.hash}` }));
  const conflicted = new Set();
  for (const region of regions) {
    const hasHash = validHits.some((hit) => hit.index >= region.start && hit.index < region.end);
    if (hasHash && region.markers.length > 1) {
      conflicted.add(region);
      const roles = region.markers.map((marker) => `${marker.role} at line ${marker.line}`).join(", ");
      issues.push({ code: "role_marker_conflict", file, line: region.markers[0].line, index: region.regionStart, reason: `conflicting installed-tree role markers (${roles}); region must declare exactly one role` });
    }
  }
  const reportedUnknown = new Set();
  for (const hit of validHits) {
    const region = regions.find((candidate) => hit.index >= candidate.start && hit.index < candidate.end);
    hit.region = region || null;
    if (!region || region.markers.length === 0) {
      issues.push({ code: "role_marker_absent", file, line: hit.line, index: hit.index, reason: "store hash has no role marker; add **Seal installed-tree pin role:** `published-asset` or **Seal installed-tree pin role:** `fresh-build` immediately before its fenced block" });
    } else if (!conflicted.has(region)) {
      const marker = region.markers[0];
      if (!KNOWN_ROLES.has(marker.role)) {
        if (!reportedUnknown.has(region)) {
          reportedUnknown.add(region);
          issues.push({ code: "role_marker_unknown", file, line: marker.line, index: marker.start, reason: `unknown store-hash role ${JSON.stringify(marker.role)} for hash at line ${hit.line}` });
        }
      } else hit.role = marker.role;
    }
  }
  issues.sort((a, b) => a.index - b.index);
  return { regions, hits: validHits, issues };
}

module.exports = { formatInstalledTreeRefusal, scanInstalledTreeRegions };
