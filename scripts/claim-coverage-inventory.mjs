#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Sentence population plus repository-derived executable backing evidence.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(process.env.CLAIM_INVENTORY_ROOT
  ?? path.join(path.dirname(fileURLToPath(import.meta.url)), ".."));
const POPULATION_FILE = "scripts/claim-coverage-population.json";
const SOURCE_TEST_WORDS = new Set(["readme", "markdown", "prose", "wording", "source", "document", "docs", "claim"]);
const STOP_WORDS = new Set("a an and are as at be because been before being both but by can could did do does every for from had has have if in into is it its may might must no not of on one only or other our out over same should so than that the their them then there these they this those through to under up use used uses using value was we were what when where which while who will with without would you your".split(" "));

let failed = false;
function fail(message) { failed = true; console.error(`ERROR ${message}`); }

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

function loadPopulation() {
  const text = readRequired(POPULATION_FILE);
  if (text === null) return { files: [] };
  try {
    const data = JSON.parse(text);
    if (!Array.isArray(data.files) || data.files.length === 0) throw new Error("files must be a non-empty array");
    const seen = new Set();
    for (const entry of data.files) {
      if (!entry || typeof entry.path !== "string" || !["markdown", "seal-refusals", "checker-output"].includes(entry.kind)) {
        throw new Error("each file needs path and a known kind");
      }
      if (seen.has(entry.path)) throw new Error(`duplicate path ${entry.path}`);
      seen.add(entry.path);
    }
    return data;
  } catch (error) {
    fail(`${POPULATION_FILE}: invalid: ${error.message}`);
    return { files: [] };
  }
}

function walk(directory, accept, out = []) {
  let entries;
  try { entries = fs.readdirSync(directory, { withFileTypes: true }); }
  catch (error) { fail(`${path.relative(ROOT, directory) || "."}: unreadable directory: ${error.message}`); return out; }
  for (const entry of entries) {
    if ([".git", "node_modules", "dist", ".family"].includes(entry.name)) continue;
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(full, accept, out);
    else if (accept(full)) out.push(path.relative(ROOT, full).replaceAll(path.sep, "/"));
  }
  return out;
}

function verifyPopulation(population) {
  const listedMarkdown = population.files.filter((entry) => entry.kind === "markdown").map((entry) => entry.path).sort();
  const actualMarkdown = walk(ROOT, (file) => file.endsWith(".md")).sort();
  const missing = listedMarkdown.filter((file) => !actualMarkdown.includes(file));
  const unlisted = actualMarkdown.filter((file) => !listedMarkdown.includes(file));
  if (missing.length) fail(`population lists absent Markdown: ${missing.join(", ")}`);
  if (unlisted.length) fail(`unclassified Markdown outside population: ${unlisted.join(", ")}`);
}

function cleanMarkdown(text) {
  return text.replace(/<!--.*?-->/gs, " ").replace(/<[^>]+>/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ").replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\[[^\]]*\]/g, "$1").replace(/[*_~]/g, "")
    .replace(/[ \t]+/g, " ").trim();
}

function splitSentences(text, startLine) {
  const rows = [];
  const pattern = /\S(?:[\s\S]*?\S)?(?:[.!?](?=\s|$)|$)/g;
  for (const match of text.matchAll(pattern)) {
    const sentence = match[0].replace(/\s+/g, " ").trim();
    if (!sentence || !/[.!?]$/.test(sentence)) continue;
    rows.push({ line: startLine + text.slice(0, match.index).split("\n").length - 1, sentence });
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
    if (prose && !/^\[[^\]]+\]:/.test(prose)) for (const row of splitSentences(prose, paragraphLine)) rows.push({ file, ...row });
    paragraph = [];
  };
  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index];
    if (/^\s*```/.test(raw)) { flush(); fenced = !fenced; continue; }
    if (fenced) continue;
    const trimmed = raw.trim();
    const excluded = !trimmed || /^#{1,6}\s/.test(trimmed) || /^\|.*\|$/.test(trimmed)
      || /^[-:| ]+$/.test(trimmed) || /^<[^>]+>$/.test(trimmed) || /^\[[^\]]+\]:\s*\S+/.test(trimmed);
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
    const value = match[2].replace(/\\n/g, " ").replace(/\\(["'`])/g, "$1")
      .replace(/\$\{[^}]+\}/g, "<value>").replace(/\s+/g, " ").trim();
    if (value) values.push(value);
  }
  return values;
}

function outputClaims(file, text, kind) {
  const rows = [];
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    const selected = kind === "checker-output"
      ? /(?:new Refusal|process\.(?:stdout|stderr)\.write)/.test(line)
      : /(?:throw (?:runtimeRefusal|new protection\.ProtectionError)|console\.(?:log|error)\(`?REFUS)/.test(line);
    if (!selected) continue;
    for (const value of literalContents(line)) for (const match of value.matchAll(/\S(?:.*?\S)?(?:[.!?](?=\s|$)|$)/g)) {
      const sentence = match[0].trim();
      if (sentence.length < 12 || /^[a-z0-9_ -]+:?$/.test(sentence) && !/\s/.test(sentence)) continue;
      rows.push({ file, line: index + 1, sentence });
    }
  }
  return rows;
}

function stem(word) {
  if (/^(?:untouched|unmodified|identical)$/.test(word.toLowerCase())) return "unchanged";
  if (word.length > 5) return word.replace(/(?:ies|ing|ers|ed|es|s)$/i, (suffix) => suffix === "ies" ? "y" : "");
  if (word.length > 3) return word.replace(/s$/i, "");
  return word;
}

function terms(text) {
  return new Set((text.match(/[A-Za-z][A-Za-z0-9_-]*/g) ?? [])
    .flatMap((word) => word.replace(/([a-z])([A-Z])/g, "$1 $2").split(/[-_ ]/))
    .map((word) => stem(word.toLowerCase()))
    .filter((word) => word.length > 2 && !/^v\d/.test(word) && !STOP_WORDS.has(word)));
}

function intersection(a, b) { return new Set([...a].filter((item) => b.has(item))); }

function assertionActual(statement) {
  const open = statement.indexOf("(");
  if (open === -1) return "";
  let depth = 0;
  for (let index = open + 1; index < statement.length; index += 1) {
    const char = statement[index];
    if (char === "(") depth += 1;
    else if (char === ")") depth -= 1;
    else if (char === "," && depth === 0) return statement.slice(open + 1, index);
  }
  return "";
}

function assertionExpected(statement) {
  const open = statement.indexOf("(");
  if (open === -1) return "";
  let depth = 0;
  let comma = -1;
  let quote = null;
  for (let index = open + 1; index < statement.length; index += 1) {
    const char = statement[index];
    if (quote) {
      if (char === "\\") index += 1;
      else if (char === quote) quote = null;
      continue;
    }
    if (/["'`]/.test(char)) { quote = char; continue; }
    if (/[(\[{]/.test(char)) depth += 1;
    else if (/[)\]}]/.test(char)) {
      if (depth === 0) return comma === -1 ? "" : statement.slice(comma + 1, index);
      depth -= 1;
    } else if (char === "," && depth === 0) {
      if (comma !== -1) return statement.slice(comma + 1, index);
      comma = index;
    }
  }
  return comma === -1 ? "" : statement.slice(comma + 1);
}

function outputAssertion(statement) {
  const actual = assertionActual(statement);
  if (!/(?:\.out\b|stdout|stderr|\.text\b|\bscope\b|readState|existsSync|sha256|\.count\(|\bcalls\b|\.code\b)/.test(actual)) return false;
  const actualTerms = terms(actual);
  if ([...SOURCE_TEST_WORDS].some((word) => actualTerms.has(word)) && !/(?:\.out\b|stdout|stderr|readState|existsSync|sha256|\.count\(|\bcalls\b|\.code\b)/.test(actual)) return false;
  return true;
}

function collectStatement(lines, start) {
  let statement = lines[start];
  let end = start;
  while (!statement.includes(";") && end + 1 < lines.length && end - start < 7) statement += ` ${lines[++end].trim()}`;
  return statement;
}

function assertionSemantics(statement) {
  const derived = new Set();
  if (/assert\.(?:equal|strictEqual)\s*\([^;]*sha256\s*\([^;]*readFileSync[^;]*,\s*before(?:Hash|Bytes)\b/.test(statement)) {
    for (const term of ["byte", "unchanged"]) derived.add(term);
  }
  return derived;
}

function assertionPatterns(statement) {
  const patterns = [...literalContents(statement)];
  for (const match of statement.matchAll(/\/(?![/*])((?:\\.|[^/\n])+)\/[dgimsuvy]*/g)) patterns.push(match[1]);
  return patterns.map((literal) => {
    const patternTerms = terms(literal.replace(/\\[dwsbDSWB]|[\^$.*+?()[\]{}|]/g, " "));
    return { terms: patternTerms, text: [...patternTerms].join(" ") };
  }).filter((pattern) => pattern.terms.size >= 3 && pattern.text.length >= 16);
}

function evidenceRecord(kind, file, line, name, statement) {
  const patternSource = kind === "guard" ? statement : assertionExpected(statement);
  return {
    kind, file, line, name, statement,
    titleTerms: terms(name),
    assertionTerms: terms(statement),
    semanticTerms: assertionSemantics(statement),
    patterns: assertionPatterns(patternSource),
  };
}

function discoverAssertions() {
  const evidence = [];
  const testFiles = walk(path.join(ROOT, "test"), (file) => /\.(?:cjs|mjs|js)$/.test(file)).sort();
  for (const file of testFiles) {
    const text = readRequired(file);
    if (text === null) continue;
    const lines = text.split(/\r?\n/);
    const starts = [];
    for (let index = 0; index < lines.length; index += 1) {
      const match = lines[index].match(/^\s*test\(\s*(["'`])(.+?)\1/);
      if (match) starts.push({ index, title: match[2] });
    }
    for (let item = 0; item < starts.length; item += 1) {
      const { index: start, title } = starts[item];
      const end = starts[item + 1]?.index ?? lines.length;
      for (let index = start; index < end; index += 1) {
        if (!/\bassert\.(?:equal|strictEqual|deepEqual|match|doesNotMatch|ok|notEqual)\s*\(/.test(lines[index])) continue;
        const statement = collectStatement(lines, index);
        if (!outputAssertion(statement)) continue;
        evidence.push(evidenceRecord("test", file, index + 1, title, statement));
      }
    }
  }
  const checkFiles = walk(path.join(ROOT, "scripts"), (file) => /\.(?:cjs|mjs|js)$/.test(file)
    && /(?:check|guard|gate|inventory|drift)/.test(path.basename(file))
    && !file.endsWith("claim-coverage-inventory.mjs")).sort();
  for (const file of checkFiles) {
    const text = readRequired(file);
    if (text === null) continue;
    const lines = text.split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      const executableGuard = /^\s*if\s*\((?![^)]*\b(?:readme|claims|source|prose)\b)[^)]*\)\s*fail\s*\(/i.test(lines[index]);
      if (!executableGuard && !/(?:requireMatch|assert\.)\s*\(/.test(lines[index])) continue;
      const statement = collectStatement(lines, index);
      if (!executableGuard && !outputAssertion(statement)) continue;
      evidence.push(evidenceRecord(executableGuard ? "guard" : "check", file, index + 1, path.basename(file), statement));
    }
  }
  if (evidence.length === 0) fail("executable assertion population is empty");
  return evidence;
}

function directPhraseMatch(claim, item) {
  const claimTerms = claim.termSet;
  if (claimTerms.size < 2) return false;
  if (!/\b(?:is|are|has|have|does|do|can|cannot|will|must|should|supports?|refuses?|changes?|continues?|matches?|uses?|runs?|only)\b/i.test(claim.sentence)) return false;
  for (const pattern of item.patterns) {
    const shared = intersection(claimTerms, pattern.terms).size;
    const covered = shared / claimTerms.size;
    if (shared >= 2 && covered >= 0.8
      && (claim.termText.includes(pattern.text) || pattern.text.includes(claim.termText))) return true;
  }
  return false;
}

function backingFor(claim, evidence) {
  let best = null;
  for (const item of evidence) {
    const direct = directPhraseMatch(claim, item);
    const claimTerms = claim.termSet;
    const guardCoverage = intersection(claimTerms, item.assertionTerms).size / Math.max(1, claimTerms.size);
    const guard = item.kind === "guard" && claimTerms.size >= 4 && guardCoverage === 1;
    const semantic = claimTerms.size >= 2 && intersection(claimTerms, item.semanticTerms).size === claimTerms.size;
    if (!direct && !guard && !semantic) continue;
    const score = [...terms(item.statement)].size;
    if (!best || score > best.score) best = { ...item, score };
  }
  return best;
}

const population = loadPopulation();
verifyPopulation(population);
const claims = [];
for (const entry of population.files) {
  console.log(`POPULATION ${entry.path} ${entry.kind}`);
  const text = readRequired(entry.path);
  if (text === null) continue;
  const found = entry.kind === "markdown" ? markdownClaims(entry.path, text) : outputClaims(entry.path, text, entry.kind);
  if (found.length === 0) fail(`${entry.path}: claim population is empty`);
  claims.push(...found);
}
if (claims.length === 0) fail("claim population is empty");

const evidence = discoverAssertions();
for (const claim of claims) {
  claim.termSet = terms(claim.sentence);
  claim.termText = [...claim.termSet].join(" ");
  claim.backing = backingFor(claim, evidence);
}
const backed = claims.filter((claim) => claim.backing);
const unbacked = claims.filter((claim) => !claim.backing);
console.log(`total=${claims.length} backed=${backed.length} unbacked=${unbacked.length} unclassified=0 population=${population.files.length} assertions=${evidence.length}`);
for (const claim of backed) console.log(`BACKED ${claim.file}:${claim.line} ${claim.backing.file}:${claim.backing.line}`);
for (const claim of unbacked) console.log(`UNBACKED ${claim.file}:${claim.line}`);
process.exitCode = failed ? 1 : 0;
