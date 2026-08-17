#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Claim coverage is sentence accounting, not a keyword search.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(process.env.CLAIM_INVENTORY_ROOT
  ?? path.join(path.dirname(fileURLToPath(import.meta.url)), ".."));
const MARKDOWN = [
  "README.md",
  "docs/guide/README.md",
  "docs/guide/choosing-what-to-protect.md",
  "docs/guide/github-actions-provenance.md",
  "docs/guide/knowing-it-worked.md",
  "docs/guide/what-is-protected-right-now.md",
  "docs/guide/when-something-looks-wrong.md",
];
const PROGRAM_OUTPUT = ["bin/seal", "checker/seal-receipt-check.mjs"];

// Population rule: every complete prose sentence outside headings, tables,
// code/transcript fences, HTML, and link-only navigation in the named Markdown
// files, plus every static refusal sentence in bin/seal and every static CLI
// output/refusal sentence in the receipt checker. Source comments, examples,
// commands, headings, tables, dynamic error text, and fragments are excluded.

// A backing is deliberately specific: the cited assertion executes the named
// behaviour. A test that merely contains related prose is not listed here.
const BACKINGS = [
  {
    file: "README.md",
    sentence: "Seal will not run it twice.",
    check: "test/spine-retry.test.cjs:78",
    assertion: "assert.equal(readCount(countFile), \"1\"",
  },
  {
    file: "README.md",
    sentence: "It might not run it at all.",
    check: "test/approval-contract.test.cjs:129",
    assertion: "assert.equal(child.count(), \"0\")",
  },
  {
    file: "README.md",
    sentence: "The project file is byte-identical before and after.",
    check: "test/protect3b.test.cjs:152",
    assertion: "assert.equal(fs.readFileSync(path.join(project, \".mcp.json\"), \"utf8\"), beforeBytes)",
  },
];

let failed = false;
function fail(message) {
  failed = true;
  console.error(`ERROR ${message}`);
}

function readRequired(relative) {
  try {
    const bytes = fs.readFileSync(path.join(ROOT, relative));
    if (bytes.length === 0) throw new Error("file is empty");
    if (bytes.includes(0)) throw new Error("file is not readable UTF-8 text");
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (error) {
    fail(`${relative}: unreadable: ${error.message}`);
    return null;
  }
}

function cleanMarkdown(text) {
  return text
    .replace(/<!--.*?-->/gs, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\[[^\]]*\]/g, "$1")
    .replace(/[*_~]/g, "")
    .replace(/[ \t]+/g, " ")
    .trim();
}

function splitSentences(text, startLine) {
  const rows = [];
  const pattern = /\S(?:[\s\S]*?\S)?(?:[.!?](?=\s|$)|$)/g;
  for (const match of text.matchAll(pattern)) {
    const sentence = match[0].replace(/\s+/g, " ").trim();
    if (!sentence) continue;
    const line = startLine + text.slice(0, match.index).split("\n").length - 1;
    // A punctuation-free fragment is outside the stated sentence population.
    if (/[.!?]$/.test(sentence)) rows.push({ line, sentence });
  }
  return rows;
}

function markdownClaims(file, text) {
  const rows = [];
  const lines = text.split(/\r?\n/);
  let fenced = false;
  let paragraph = [];
  let paragraphLine = 0;
  const flush = () => {
    if (!paragraph.length) return;
    const prose = cleanMarkdown(paragraph.join("\n"));
    if (prose && !/^\[[^\]]+\]:/.test(prose)) {
      for (const row of splitSentences(prose, paragraphLine)) rows.push({ file, ...row });
    }
    paragraph = [];
  };
  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index];
    if (/^\s*```/.test(raw)) { flush(); fenced = !fenced; continue; }
    if (fenced) continue;
    const trimmed = raw.trim();
    const excluded = !trimmed || /^#{1,6}\s/.test(trimmed) || /^\|.*\|$/.test(trimmed)
      || /^[-:| ]+$/.test(trimmed) || /^<[^>]+>$/.test(trimmed)
      || /^\[[^\]]+\]:\s*\S+/.test(trimmed);
    if (excluded) { flush(); continue; }
    if (!paragraph.length) paragraphLine = index + 1;
    paragraph.push(raw.replace(/^\s*(?:[-*+] |\d+[.)] |>\s*)/, ""));
  }
  flush();
  if (fenced) fail(`${file}: unclassified Markdown (unterminated code fence)`);
  return rows;
}

function literalContents(line) {
  const values = [];
  for (const match of line.matchAll(/(["'`])((?:\\.|(?!\1).)*)\1/g)) {
    const value = match[2]
      .replace(/\\n/g, " ")
      .replace(/\\(["'`])/g, "$1")
      .replace(/\$\{[^}]+\}/g, "<value>")
      .replace(/\s+/g, " ")
      .trim();
    if (value) values.push(value);
  }
  return values;
}

function outputClaims(file, text) {
  const rows = [];
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    const checker = file.startsWith("checker/") && /(?:new Refusal|process\.(?:stdout|stderr)\.write)/.test(line);
    const sealRefusal = file === "bin/seal" && /(?:throw (?:runtimeRefusal|new protection\.ProtectionError)|console\.(?:log|error)\(`?REFUS)/.test(line);
    if (!checker && !sealRefusal) continue;
    for (const value of literalContents(line)) {
      // Codes and field names are not sentences shown to a user. An emitted
      // line without terminal punctuation is still one CLI sentence.
      for (const match of value.matchAll(/\S(?:.*?\S)?(?:[.!?](?=\s|$)|$)/g)) {
        const sentence = match[0].trim();
        if (sentence.length < 12 || /^[a-z0-9_ -]+:?$/.test(sentence) && !/\s/.test(sentence)) continue;
        rows.push({ file, line: index + 1, sentence });
      }
    }
  }
  return rows;
}

function validateBacking(backing, claims) {
  const matches = claims.filter((claim) => claim.file === backing.file && claim.sentence === backing.sentence);
  if (matches.length !== 1) {
    fail(`backing target must match exactly one claim: ${backing.file} ${JSON.stringify(backing.sentence)} (found ${matches.length})`);
    return;
  }
  const match = /^(.*):(\d+)$/.exec(backing.check);
  if (!match) { fail(`invalid check reference ${backing.check}`); return; }
  const proof = readRequired(match[1]);
  if (proof === null) return;
  const line = proof.split(/\r?\n/)[Number(match[2]) - 1];
  if (line === undefined || !line.includes("assert.") || !line.includes(backing.assertion)) {
    fail(`${backing.check}: cited line is not the named executable assertion`);
    return;
  }
  matches[0].backedBy = backing.check;
}

const claims = [];
for (const file of MARKDOWN) {
  const text = readRequired(file);
  if (text !== null) {
    const found = markdownClaims(file, text);
    if (found.length === 0) fail(`${file}: claim population is empty`);
    claims.push(...found);
  }
}
for (const file of PROGRAM_OUTPUT) {
  const text = readRequired(file);
  if (text !== null) {
    const found = outputClaims(file, text);
    if (found.length === 0) fail(`${file}: claim population is empty`);
    claims.push(...found);
  }
}
for (const backing of BACKINGS) validateBacking(backing, claims);

if (claims.length === 0) fail("claim population is empty");
const unclassified = claims.filter((claim) => claim.unclassified);
const backed = claims.filter((claim) => claim.backedBy);
const unbacked = claims.filter((claim) => !claim.backedBy);
console.log(`total=${claims.length} backed=${backed.length} unbacked=${unbacked.length} unclassified=${unclassified.length}`);
for (const claim of backed) console.log(`BACKED ${claim.file}:${claim.line} ${claim.backedBy}`);
for (const claim of unbacked) console.log(`UNBACKED ${claim.file}:${claim.line}`);
if (unclassified.length) for (const claim of unclassified) console.error(`UNCLASSIFIED ${claim.file}:${claim.line}`);
if (unclassified.length) failed = true;
process.exitCode = failed ? 1 : 0;
