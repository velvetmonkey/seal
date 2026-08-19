// SPDX-License-Identifier: Apache-2.0
const ROLE_MARKER = /^\*\*Seal installed-tree pin role:\*\* `([A-Za-z0-9][A-Za-z0-9-]*)`\r?$/;
const KNOWN_ROLES = new Set(["published-asset", "fresh-build"]);
const TREE_HASH = /\btree:?\s+([0-9a-f]{64})\b/g;
const TREE_HASH_WITHOUT_SPACE = /\btree:([0-9a-f]{64})\b/g;
const STORE_HASH = /\/store\/([0-9a-f]{64})(?=\/|\b)/g;

function lineNumber(text, index) {
  return text.slice(0, index).split("\n").length;
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
    const line = lines[index].replace(/\r$/, "");
    if (!/^```/.test(line)) continue;
    if (open === null) {
      const markers = [];
      for (let markerIndex = index - 1; markerIndex >= 0; markerIndex -= 1) {
        const marker = lines[markerIndex].replace(/\r$/, "").match(ROLE_MARKER);
        if (!marker) break;
        markers.unshift({
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
          "**Seal installed-tree pin role:** `fresh-build` immediately before its fenced block",
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

module.exports = {
  formatInstalledTreeRefusal,
  scanInstalledTreeRegions,
};
