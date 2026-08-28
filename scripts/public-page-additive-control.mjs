#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { FAMILY_SCOPE_TOKEN } from "./public-page-language-rules.mjs";

const ROOT = resolve(process.env.SEAL_PUBLIC_PAGE_ROOT || resolve(import.meta.dirname, ".."));
const SCOPE = resolve(process.env.SEAL_PUBLIC_PAGE_SCOPE || resolve(ROOT, "scripts/public-page-language-scope.json"));
const ALLOWLIST = resolve(process.env.SEAL_PUBLIC_PAGE_ADDITIVE_ALLOWLIST || resolve(ROOT, "scripts/public-page-additive-allowlist.json"));
const BASE = process.env.SEAL_PUBLIC_PAGE_ADDITIVE_BASE || execFileSync("git", ["merge-base", "origin/main", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim();

function fail(message) {
  process.stderr.write(`FAIL public-page additive control: ${message}\n`);
  process.exitCode = 1;
}

function stripScopeTokens(text) {
  return text.split(/(?=\[)/u).reduce((stripped, part) => {
    const match = FAMILY_SCOPE_TOKEN.exec(` ${part}`);
    return match ? `${stripped.replace(/\s$/u, "")}${part.slice(match[0].length - 1)}` : `${stripped}${part}`;
  }, "");
}

function expectedRewrite(entries, file, text) {
  const digest = createHash("sha256").update(text).digest("hex");
  return entries.some((entry) => entry.file === file && entry.strippedSha256 === digest);
}

function lineDiff(baseLines, headLines) {
  const table = Array.from({ length: baseLines.length + 1 }, () => new Uint32Array(headLines.length + 1));
  for (let base = baseLines.length - 1; base >= 0; base -= 1) {
    for (let head = headLines.length - 1; head >= 0; head -= 1) {
      table[base][head] = baseLines[base] === headLines[head]
        ? table[base + 1][head + 1] + 1
        : Math.max(table[base + 1][head], table[base][head + 1]);
    }
  }
  const groups = []; let changes = []; let base = 0; let head = 0;
  while (base < baseLines.length || head < headLines.length) {
    if (baseLines[base] === headLines[head]) {
      if (changes.length) groups.push(changes);
      changes = []; base += 1; head += 1; continue;
    }
    if (head === headLines.length || (base < baseLines.length && table[base + 1][head] >= table[base][head + 1])) {
      changes.push({ side: "base", line: base + 1 }); base += 1;
    } else {
      changes.push({ side: "head", line: head + 1 }); head += 1;
    }
  }
  if (changes.length) groups.push(changes);
  return groups;
}

const scope = JSON.parse(readFileSync(SCOPE, "utf8"));
const allowlist = JSON.parse(readFileSync(ALLOWLIST, "utf8"));
for (const file of scope.pages) {
  const stripped = stripScopeTokens(readFileSync(resolve(ROOT, file), "utf8"));
  const head = stripped.split("\n");
  const base = execFileSync("git", ["show", `${BASE}:${file}`], { cwd: ROOT, encoding: "utf8" }).split("\n");
  if (head.join("\n") !== base.join("\n") && expectedRewrite(allowlist.rewrites, file, stripped)) continue;
  for (const group of lineDiff(base, head)) {
    const changedHeadLines = group.filter((change) => change.side === "head");
    const first = changedHeadLines[0] || group[0];
    fail(`${file}:${first.line} differs from merge base ${BASE}`);
  }
}
if (!process.exitCode) process.stdout.write(`PASS public-page additive control: ${scope.pages.length} fixed pages, merge base ${BASE}\n`);
