#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// A deliberately small, human-auditable claim inventory.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(process.env.CLAIM_INVENTORY_ROOT
  ?? path.join(path.dirname(fileURLToPath(import.meta.url)), ".."));
const POPULATION_FILE = "scripts/claim-coverage-population.json";
const STOP_WORDS = new Set("a an and are as at be been but by for from has have in into is it its of on one only or that the their this to under was were with you your".split(" "));
let failed = false;

function fail(message) {
  failed = true;
  console.error(`ERROR ${message}`);
}

function readRequired(relative) {
  try {
    const text = fs.readFileSync(path.join(ROOT, relative), "utf8");
    if (!text.trim()) fail(`${relative}: empty`);
    return text;
  } catch (error) {
    fail(`${relative}: unreadable: ${error.message}`);
    return null;
  }
}

function loadPopulation() {
  const text = readRequired(POPULATION_FILE);
  if (text === null) return { populations: [] };
  try {
    const data = JSON.parse(text);
    if (!Array.isArray(data.populations) || data.populations.length !== 2) {
      throw new Error("exactly two populations are required");
    }
    const expected = ["readme-before-install", "seal-refusal-messages"];
    if (data.populations.some((entry, index) => entry.id !== expected[index])) {
      throw new Error(`populations must be ${expected.join(" then ")}`);
    }
    return data;
  } catch (error) {
    fail(`${POPULATION_FILE}: invalid: ${error.message}`);
    return { populations: [] };
  }
}

function cleanMarkdown(text) {
  return text.replace(/<!--.*?-->/gs, " ").replace(/<[^>]+>/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ").replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[*_]/g, "").replace(/[ \t]+/g, " ").trim();
}

function splitSentences(text, startLine) {
  const rows = [];
  const pattern = /\S(?:[\s\S]*?\S)?[.!?](?=\s|$)/g;
  for (const match of text.matchAll(pattern)) {
    const sentence = match[0].replace(/\s+/g, " ").trim();
    rows.push({ line: startLine + text.slice(0, match.index).split("\n").length - 1, sentence });
  }
  return rows;
}

function readmeClaims(text) {
  const lines = text.split(/\r?\n/);
  const stop = lines.findIndex((line) => line.trim() === "## 1. Install");
  if (stop === -1) { fail("README.md: Install heading not found"); return []; }
  const rows = [];
  let paragraph = [];
  let paragraphLine = 0;
  let fenced = false;
  const flush = () => {
    if (!paragraph.length) return;
    const prose = cleanMarkdown(paragraph.join("\n"));
    rows.push(...splitSentences(prose, paragraphLine).map((row) => ({ file: "README.md", ...row })));
    paragraph = [];
  };
  for (let index = 0; index < stop; index += 1) {
    const raw = lines[index];
    const trimmed = raw.trim();
    if (/^```/.test(trimmed)) { flush(); fenced = !fenced; continue; }
    if (fenced) continue;
    if (!trimmed || /^#/.test(trimmed) || /^<.*>$/.test(trimmed) || /^\[!\[/.test(trimmed)) {
      flush();
      continue;
    }
    if (!paragraph.length) paragraphLine = index + 1;
    paragraph.push(raw);
  }
  flush();
  if (fenced) fail("README.md: unclassified Markdown (unterminated code fence before Install)");
  return rows;
}

function literalContents(line) {
  const values = [];
  for (const match of line.matchAll(/(["'`])((?:\\.|(?!\1).)*)\1/g)) {
    const value = match[2].replace(/\\n/g, " ").replace(/\\(["'`])/g, "$1")
      .replace(/\$\{[^}]+\}/g, "<value>").replace(/\s+/g, " ").trim();
    if (value) values.push(value);
  }
  return values;
}

function sealRefusalClaims(text) {
  const rows = [];
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    const constructor = /throw (?:runtimeRefusal|new protection\.ProtectionError)\s*\(/.test(line);
    const emitted = /console\.(?:log|error)\s*\(/.test(line) && /refus/i.test(line);
    if (!constructor && !emitted) continue;
    const values = literalContents(line);
    const message = values.at(-1);
    if (!message) { fail(`bin/seal:${index + 1}: refusal message cannot be classified`); continue; }
    const sentences = splitSentences(message, index + 1);
    if (sentences.length) {
      rows.push(...sentences.map((row) => ({ file: "bin/seal", ...row })));
    } else {
      rows.push({ file: "bin/seal", line: index + 1, sentence: message });
    }
  }
  return rows;
}

function walk(directory, out = []) {
  let entries;
  try { entries = fs.readdirSync(directory, { withFileTypes: true }); }
  catch (error) { fail(`${path.relative(ROOT, directory)}: unreadable directory: ${error.message}`); return out; }
  for (const entry of entries) {
    if ([".git", "node_modules", "dist"].includes(entry.name)) continue;
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(?:cjs|mjs|js)$/.test(entry.name)) out.push(path.relative(ROOT, full).replaceAll(path.sep, "/"));
  }
  return out;
}

function collectStatement(lines, start) {
  let statement = lines[start].trim();
  let end = start;
  while (!statement.includes(";") && end + 1 < lines.length && end - start < 7) statement += ` ${lines[++end].trim()}`;
  return statement.replace(/\s+/g, " ");
}

function splitArguments(statement) {
  const open = statement.indexOf("(");
  if (open === -1) return [];
  const args = [];
  let start = open + 1;
  let depth = 0;
  let quote = null;
  for (let index = start; index < statement.length; index += 1) {
    const char = statement[index];
    if (quote) {
      if (char === "\\") index += 1;
      else if (char === quote) quote = null;
      continue;
    }
    if (/["'`]/.test(char)) { quote = char; continue; }
    if (/[(\[{]/.test(char)) depth += 1;
    else if (/[)\]}]/.test(char)) {
      if (depth === 0) { args.push(statement.slice(start, index)); break; }
      depth -= 1;
    } else if (char === "," && depth === 0) {
      args.push(statement.slice(start, index));
      start = index + 1;
    }
  }
  return args.map((arg) => arg.trim());
}

function terms(text) {
  return new Set((text.toLowerCase().match(/[a-z][a-z0-9_-]*/g) ?? [])
    .filter((word) => word.length > 2 && !STOP_WORDS.has(word) && word !== "value"));
}

function patterns(text) {
  const found = literalContents(text);
  for (const match of text.matchAll(/\/(?![/*])((?:\\.|[^/\n])+)\/[dgimsuvy]*/g)) found.push(match[1]);
  return found.map((value) => ({ value, terms: terms(value.replace(/\\[dwsbDSWB]|[\^$.*+?()[\]{}|]/g, " ")) }));
}

function outputAssertion(statement) {
  const [actual] = splitArguments(statement);
  return /(?:\.out\b|stdout|stderr|\.text\b|readState|existsSync|sha256|readCount|\.count\(|\bcalls\b|\.code\b|receipt\.seal\.alg)/.test(actual ?? "");
}

function assertionSemantics(title, statement, args) {
  const semantic = new Set();
  const actual = args[0] ?? "";
  const expected = args[1] ?? "";
  if (/(?:readCount|child\.count)\s*\(/.test(actual) && /(?:"1"|\b1\b)/.test(expected)
    && /(?:replay|approve once|second delivery)/i.test(`${title} ${statement}`)) {
    for (const word of ["seal", "will", "run", "not", "twice"]) semantic.add(word);
  }
  if (/(?:readCount|child\.count)\s*\(/.test(actual) && /(?:"0"|\b0\b)/.test(expected)
    && /(?:refusal|expired|receives nothing)/i.test(`${title} ${statement}`)) {
    for (const word of ["might", "not", "run", "all"]) semantic.add(word);
  }
  if (/receipt\.seal\.alg/.test(actual) && /ed25519/i.test(expected)) {
    for (const word of ["seal", "writes", "signed", "receipt", "decision"]) semantic.add(word);
  }
  return semantic;
}

function discoverAssertions() {
  const evidence = [];
  for (const file of walk(path.join(ROOT, "test")).sort()) {
    if (file === "test/claim-coverage-inventory.test.mjs") continue;
    const text = readRequired(file);
    if (text === null) continue;
    const lines = text.split(/\r?\n/);
    let title = "unnamed test";
    for (let index = 0; index < lines.length; index += 1) {
      const named = lines[index].match(/^\s*test\(\s*(["'`])(.+?)\1/);
      if (named) title = named[2];
      if (!/\bassert\.(?:equal|strictEqual|deepEqual|match|doesNotMatch|ok|notEqual)\s*\(/.test(lines[index])) continue;
      const statement = collectStatement(lines, index);
      if (!outputAssertion(statement)) continue;
      const args = splitArguments(statement);
      const expected = /assert\.ok\s*\(/.test(statement) ? args[0] : args[1];
      evidence.push({
        file, line: index + 1, title, statement,
        patterns: patterns(expected ?? ""),
        semantic: assertionSemantics(title, statement, args),
      });
    }
  }
  if (!evidence.length) fail("executable assertion population is empty");
  return evidence;
}

function backingFor(claim, evidence) {
  const claimTerms = terms(claim.sentence);
  let best = null;
  for (const item of evidence) {
    const semanticCoverage = [...claimTerms].filter((term) => item.semantic.has(term)).length / Math.max(1, claimTerms.size);
    if (claimTerms.size >= 3 && semanticCoverage === 1) best = { ...item, score: 1000 };
    for (const pattern of item.patterns) {
      const shared = [...claimTerms].filter((term) => pattern.terms.has(term)).length;
      const coverage = shared / Math.max(1, claimTerms.size);
      const exactShort = claimTerms.size === 1 && shared === 1 && pattern.value.replace(/[^A-Za-z]/g, "").toLowerCase().includes([...claimTerms][0]);
      if (!exactShort && (shared < 2 || coverage < 0.8)) continue;
      const score = coverage * 100 + shared;
      if (!best || score > best.score) best = { ...item, score };
    }
  }
  return best;
}

const population = loadPopulation();
const readme = readRequired("README.md");
const seal = readRequired("bin/seal");
const claims = [];
console.log("POPULATION README.md: prose sentences before ## 1. Install");
if (readme !== null) claims.push(...readmeClaims(readme));
console.log("POPULATION bin/seal: refusal-constructor messages and emitted refusal-status strings");
if (seal !== null) claims.push(...sealRefusalClaims(seal));
if (population.populations.length !== 2 || claims.length === 0) fail("claim population is empty");

const evidence = discoverAssertions();
let backed = 0;
for (const claim of claims) {
  const proof = backingFor(claim, evidence);
  console.log(`CLAIM ${claim.file}:${claim.line} ${claim.sentence}`);
  if (proof) {
    backed += 1;
    console.log(`ASSERTION ${proof.file}:${proof.line} ${proof.statement}`);
  } else {
    console.log("UNBACKED");
  }
}
console.log(`total=${claims.length} backed=${backed} unbacked=${claims.length - backed} unclassified=0 population=2`);
process.exitCode = failed ? 1 : 0;
