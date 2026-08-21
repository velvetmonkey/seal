#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { PAYLOAD_PATHS } = require("./dist-payload.cjs");

const ROOT = path.join(__dirname, "..");

function rel(file) {
  return path.relative(ROOT, file).split(path.sep).join("/");
}

function lineNumber(text, index) {
  let line = 1;
  for (let i = 0; i < index; i += 1) if (text.charCodeAt(i) === 10) line += 1;
  return line;
}

function consumerFiles() {
  const names = execFileSync("git", ["-C", ROOT, "ls-files", "-z"], { encoding: "utf8" })
    .split("\0")
    .filter(Boolean);
  return names.map((name) => path.join(ROOT, name));
}

function addHit(hits, seen, file, text, index, required) {
  const site = `${rel(file)}:${lineNumber(text, index)}`;
  const key = `${required}\0${site}`;
  if (seen.has(key)) return;
  seen.add(key);
  hits.push({ path: required, site });
}

function quotedPathPart(value) {
  const match = /^\s*(["'])([A-Za-z0-9._-]+)\1\s*$/.exec(value);
  return match ? match[2] : null;
}

function pathJoinCalls(text) {
  const calls = [];
  const marker = "path.join(";
  let start = 0;
  while ((start = text.indexOf(marker, start)) !== -1) {
    let depth = 1;
    let quote = null;
    let escaped = false;
    let end = start + marker.length;
    for (; end < text.length && depth > 0; end += 1) {
      const ch = text[end];
      if (quote) {
        if (escaped) escaped = false;
        else if (ch === "\\") escaped = true;
        else if (ch === quote) quote = null;
      } else if (ch === '"' || ch === "'") quote = ch;
      else if (ch === "(") depth += 1;
      else if (ch === ")") depth -= 1;
    }
    if (depth === 0) calls.push({ index: start, args: text.slice(start + marker.length, end - 1) });
    start += marker.length;
  }
  return calls;
}

function jsInstalledPaths(file, text, hits, seen) {
  // A store root is derived from install.json, not from a variable name or a
  // list of consumer files. Keep this deliberately structural: a new test or
  // tool that joins a literal path below such a root is a new requirement.
  const roots = new Set();
  const rootPattern = /\b(?:(?:const|let|var)\s+)?([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*=\s*path\.join\(([^;\n]*)\)/g;
  let rootMatch;
  while ((rootMatch = rootPattern.exec(text)) !== null) {
    if (/\brecord\.store\b/.test(rootMatch[2])) roots.add(rootMatch[1]);
  }

  for (const joinMatch of pathJoinCalls(text)) {
    const args = joinMatch.args.split(",");
    let storeAt = args.findIndex((arg) => /\brecord\.store\b/.test(arg));
    if (storeAt < 0) {
      storeAt = args.findIndex((arg) => {
        const value = arg.trim();
        return [...roots].some((root) => value === root || value.endsWith(`.${root}`));
      });
    }
    if (storeAt < 0) continue;

    const parts = args.slice(storeAt + 1).map(quotedPathPart);
    if (parts.length === 0 || parts.some((part) => part === null)) continue;

    // A negative existence assertion names a forbidden path, not a payload
    // requirement. Its assertion is intentionally the opposite of a read.
    const lineStart = text.lastIndexOf("\n", joinMatch.index) + 1;
    const lineEnd = text.indexOf("\n", joinMatch.index);
    const line = text.slice(lineStart, lineEnd < 0 ? text.length : lineEnd);
    if (/assert\.equal\(\s*fs\.existsSync\(/.test(line) && /,\s*false\s*\)/.test(line)) continue;

    addHit(hits, seen, file, text, joinMatch.index, parts.join("/"));
  }
}

function extractInstalledPaths(file, text, hits, seen) {
  const patterns = [
    /\*\/([A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)+)/g,
    /\$store\/([A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)+)/g,
    /\/store\/[0-9a-f]{64}\/([A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)+)/g,
  ];

  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(text)) !== null) {
      addHit(hits, seen, file, text, match.index, match[1]);
    }
  }
  jsInstalledPaths(file, text, hits, seen);
}

function requiredInstalledPaths() {
  const hits = [];
  const seen = new Set();
  for (const file of consumerFiles()) {
    const text = fs.readFileSync(file, "utf8");
    if (text.trim().length === 0) {
      const prior = execFileSync("git", ["-C", ROOT, "show", `HEAD:${rel(file)}`], { encoding: "utf8" });
      const priorHits = [];
      extractInstalledPaths(file, prior, priorHits, new Set());
      if (priorHits.length > 0) throw new Error(`empty installed-store consumer source: ${rel(file)}`);
    }
    extractInstalledPaths(file, text, hits, seen);
  }
  return hits;
}

function main() {
  const payload = new Set(PAYLOAD_PATHS);
  const required = requiredInstalledPaths();
  if (required.length === 0) {
    process.stderr.write("FAIL dist payload completeness found no installed-store consumer requirements\n");
    process.exit(1);
  }

  const missing = required.filter((hit) => !payload.has(hit.path));
  if (missing.length > 0) {
    for (const hit of missing) {
      process.stderr.write(`FAIL dist payload missing required installed file ${hit.path} required by ${hit.site}\n`);
    }
    process.exit(1);
  }

  const files = [...new Set(required.map((hit) => hit.path))].sort();
  process.stdout.write(`PASS dist payload includes ${files.length} installed-store consumer requirement(s): ${files.join(", ")}\n`);
}

if (require.main === module) main();

module.exports = { requiredInstalledPaths };
