#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
import { readFileSync } from "node:fs";
import { extname, resolve } from "node:path";
import { FAMILY_SCOPE_TOKEN } from "./public-page-language-rules.mjs";

const ROOT = resolve(process.env.SEAL_PUBLIC_PAGE_ROOT || resolve(import.meta.dirname, ".."));
const SCOPE = resolve(process.env.SEAL_PUBLIC_PAGE_SCOPE || resolve(ROOT, "scripts/public-page-language-scope.json"));
const BANNED = [
  "formally verified",
  "proves what happened",
  "independent verification",
  "unbypassable",
  "production-ready",
  "enterprise-grade",
  "AI safety platform",
  "protects your agent",
  "secures MCP",
  "independent checker",
  "independent verifier",
];
const BARE_INDEPENDENCE = /(?<![\p{L}\p{N}_])(?:checker|verifier)\s+is\s+independent(?!\s+of\b)/giu;
const PROVED_CLASS = /(?<![\p{L}\p{N}_])(?:proved|proven|machine[- ]checked)(?![\p{L}\p{N}_])/giu;
const EXPLICIT_NEGATION = /\b(?:not|no|never|without)\s*$/iu;

function fail(message) {
  process.stderr.write(`FAIL public-page language guard: ${message}\n`);
  process.exitCode = 1;
}

function preserveLines(text, pattern) {
  return text.replace(pattern, (match) => match.replace(/[^\n]/g, " "));
}

function proseOnly(text, extension) {
  let prose = preserveLines(text, /<!--[\s\S]*?-->/g);
  if (extension === ".html") {
    prose = preserveLines(prose, /<(?:script|style)\b[^>]*>[\s\S]*?<\/(?:script|style)>/gi);
    prose = preserveLines(prose, /<[^>]+>/g);
  }

  const lines = prose.split("\n");
  let fence = null;
  for (let index = 0; index < lines.length; index += 1) {
    const marker = lines[index].match(/^\s{0,3}(`{3,}|~{3,})/u)?.[1];
    if (marker && !fence) {
      fence = marker[0];
      lines[index] = "";
      continue;
    }
    if (fence) {
      const closing = lines[index].match(/^\s{0,3}(`{3,}|~{3,})\s*$/u)?.[1];
      if (closing?.[0] === fence) fence = null;
      lines[index] = "";
      continue;
    }
    if (/^\s{0,3}>/u.test(lines[index])) {
      lines[index] = "";
      continue;
    }
    lines[index] = lines[index]
      .replace(/(`+)(?:[^`]|`(?!\1))*\1/gu, " ")
      .replace(/“[^”\n]*”|"[^"\n]*"/gu, " ");
  }
  prose = lines.join("\n");
  // Ruled residuals: letter substitutions U+0440, U+FF50, U+1D429, and U+1D68F stay visible.
  // Ruled residuals: combining marks U+0301 and U+034F stay visible.
  // Ruled residuals: decorative dashes U+2043 and U+2796 stay visible.
  // ASSUMED: U+00AD is stripped, so the guard and the rendered reader see machinechecked.
  return prose.replace(/\p{Cf}/gu, "").replace(/\p{Pd}/gu, "-")
    .replace(/[\t\p{Zs}]/gu, " ")
    // U+2212 is a dash a reader sees, and Pd does not contain it.
    .replace(/−/gu, "-");
}

function phrasePattern(phrase) {
  const body = phrase.split(/\s+/u)
    .map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("\\s+");
  return new RegExp(`(?<![\\p{L}\\p{N}_])${body}(?![\\p{L}\\p{N}_])`, "giu");
}

let scope;
try {
  scope = JSON.parse(readFileSync(SCOPE, "utf8"));
} catch (error) {
  fail(`cannot read fixed population ${SCOPE}: ${error.message}`);
  process.exit();
}

if (!Array.isArray(scope.pages) || scope.pages.length === 0) {
  fail(`fixed population ${SCOPE} has no pages`);
  process.exit();
}

const seen = new Set();
for (const relative of scope.pages) {
  if (seen.has(relative)) {
    fail(`fixed population duplicates ${relative}`);
    continue;
  }
  seen.add(relative);
  let text;
  try {
    text = readFileSync(resolve(ROOT, relative), "utf8");
  } catch (error) {
    fail(`${relative} is unreadable: ${error.message}`);
    continue;
  }
  const prose = proseOnly(text, extname(relative));
  for (const phrase of BANNED) {
    for (const match of prose.matchAll(phrasePattern(phrase))) {
      const line = prose.slice(0, match.index).split("\n").length;
      fail(`${relative}:${line} contains banned phrase: ${phrase}`);
    }
  }
  for (const match of prose.matchAll(BARE_INDEPENDENCE)) {
    const line = prose.slice(0, match.index).split("\n").length;
    fail(`${relative}:${line} contains a bare independent description of the checker or verifier; name the axis with "is independent of"`);
  }
  for (const match of prose.matchAll(PROVED_CLASS)) {
    const before = prose.slice(Math.max(0, match.index - 24), match.index);
    const after = prose.slice(match.index + match[0].length);
    if (EXPLICIT_NEGATION.test(before) || FAMILY_SCOPE_TOKEN.test(after)) continue;
    const line = prose.slice(0, match.index).split("\n").length;
    fail(`${relative}:${line} contains an unscoped proved-class claim: ${match[0]}`);
  }
}

if (!process.exitCode) {
  process.stdout.write(`PASS public-page language guard: ${scope.pages.length} fixed pages, ${BANNED.length} banned phrases plus contextual independence\n`);
}
