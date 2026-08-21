#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
const fs = require("node:fs");
const path = require("node:path");
const { PAYLOAD_PATHS } = require("./dist-payload.cjs");

const ROOT = path.join(__dirname, "..");
const DOCS = path.join(ROOT, "docs");

function walkFiles(dir, suffix, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkFiles(full, suffix, out);
    else if (entry.isFile() && entry.name.endsWith(suffix)) out.push(full);
  }
  return out;
}

function rel(file) {
  return path.relative(ROOT, file).split(path.sep).join("/");
}

function lineNumber(text, index) {
  let line = 1;
  for (let i = 0; i < index; i += 1) if (text.charCodeAt(i) === 10) line += 1;
  return line;
}

function consumerFiles() {
  return [
    path.join(ROOT, ".github", "workflows", "ci.yml"),
    path.join(ROOT, ".github", "workflows", "release.yml"),
    path.join(ROOT, "README.md"),
    ...walkFiles(DOCS, ".md"),
  ];
}

function requiredInstalledPaths() {
  const hits = [];
  const seen = new Set();
  const patterns = [
    /\*\/([A-Za-z0-9._/-]+)/g,
    /\$store\/([A-Za-z0-9._/-]+)/g,
    /\/store\/[0-9a-f]{64}\/([A-Za-z0-9._/-]+)/g,
  ];

  for (const file of consumerFiles()) {
    const text = fs.readFileSync(file, "utf8");
    for (const pattern of patterns) {
      pattern.lastIndex = 0;
      let match;
      while ((match = pattern.exec(text)) !== null) {
        const required = match[1];
        if (!required.includes("/")) continue;
        if (!/seal-receipt-check\.mjs$/.test(required)) continue;
        const site = `${rel(file)}:${lineNumber(text, match.index)}`;
        const key = `${required}\0${site}`;
        if (seen.has(key)) continue;
        seen.add(key);
        hits.push({ path: required, site });
      }
    }
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
