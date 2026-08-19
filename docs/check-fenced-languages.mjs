#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
//
// Fail closed: every Markdown fence in the supplied file or directory must
// declare a language. Guide examples additionally keep commands and product
// output in separate, role-named fences. This is intentionally a small
// command-line guard so it can be run before the product suite as well as from
// its declared test.
import { accessSync, constants, lstatSync, readdirSync, readFileSync } from "node:fs";
import { extname, join, resolve } from "node:path";

const target = resolve(process.argv[2] ?? "docs");
const errors = [];

function readable(path) {
  try {
    accessSync(path, constants.R_OK);
    return true;
  } catch {
    errors.push(`${path}: cannot read path`);
    return false;
  }
}

function markdownFiles(path) {
  let stat;
  try {
    stat = lstatSync(path);
  } catch {
    errors.push(`${path}: path does not exist`);
    return [];
  }
  if (!readable(path)) return [];
  if (stat.isFile()) return [path];
  if (!stat.isDirectory()) {
    errors.push(`${path}: expected a file or directory`);
    return [];
  }

  let names;
  try {
    names = readdirSync(path);
  } catch {
    errors.push(`${path}: cannot read directory`);
    return [];
  }
  return names.flatMap((name) => markdownFiles(join(path, name)))
    .filter((file) => extname(file) === ".md");
}

function scan(path) {
  let source;
  try {
    source = readFileSync(path, "utf8");
  } catch {
    errors.push(`${path}: cannot read file`);
    return;
  }
  if (source.length === 0) {
    errors.push(`${path}: file is empty`);
    return;
  }

  const lines = source.split(/\r?\n/);
  let fence = null;
  lines.forEach((line, index) => {
    const match = line.match(/^( {0,3})(`{3,}|~{3,})(.*)$/);
    if (!match) return;
    const lineNumber = index + 1;
    const [, , marker, info] = match;
    if (!fence) {
      if (!info.trim()) errors.push(`${path}:${lineNumber}: fenced block has no language`);
      fence = { marker: marker[0], length: marker.length, language: info.trim().split(/\s+/)[0] || "", line: index };
      return;
    }
    if (marker[0] === fence.marker && marker.length >= fence.length && !info.trim()) {
      if (resolve(path).includes(`${join("docs", "guide")}/`)) {
        const body = lines.slice(fence.line + 1, index);
        if (fence.language === "bash" && body.some((entry) => /^(?:Protection|Runtime|Receipts|Most recent|ASSUMPTION|REFUSED|REFUSE|ACCEPT|BLOCKED|child calls observed|installed seal|store:|command:|tree:|Project \.mcp\.json hash|State:)/.test(entry.trim()))) {
          errors.push(`${path}:${fence.line + 1}: bash fence contains product output; use an output fence`);
        }
      }
      fence = null;
    }
  });
  if (fence) errors.push(`${path}: unterminated fenced block`);
}

const files = markdownFiles(target);
for (const file of files) scan(file);
if (errors.length) {
  for (const error of errors) console.error(`ERROR docs fence guard: ${error}`);
  process.exitCode = 1;
} else {
  console.log(`PASS docs fence guard: ${files.length} Markdown files checked`);
}
