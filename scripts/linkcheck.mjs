#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Internal-link integrity check for the Seal landing repo: every relative
// link/src in the docs must resolve to a file. Run: node scripts/linkcheck.mjs
import { readFileSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const { Parser: CommonMarkParser } = require("./vendor/commonmark.cjs");

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const POPULATION_FILE = resolve(ROOT, "test/support/linkcheck-population.mjs");
const POPULATION_KEYS = ["internalOccurrences", "externalOccurrences"];
const FILE_COUNT_KEYS = ["internalOccurrences", "externalOccurrences"];
const HIGH_WATER_KEYS = {
  internalOccurrences: "internalOccurrencesHighWaterMark",
  externalOccurrences: "externalOccurrencesHighWaterMark",
};
const FAMILY_REPOSITORIES = [
  ["seal-check", "master"],
  ["seal-demo", "main"],
  ["seal-live-demo", "master"],
  ["seal-verify-action", "main"],
  ["seal-assurance-kit", "main"],
  ["mcp-seal-dev", "main"],
];
function walk(dir, prefix = "") {
  const out = [];
  for (const name of readdirSync(resolve(dir, prefix), { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${name.name}` : name.name;
    const full = resolve(dir, relative);
    // The system temporary directory may be deliberately located inside this
    // checkout. It is runtime state, not a source directory for link checks.
    if (name.isDirectory() && name.name !== ".git" && full !== resolve(tmpdir())) out.push(...walk(dir, relative));
    else if (name.isFile()) out.push(relative);
  }
  return out;
}
function familyRoots(sourceRoot) {
  return new Map([
    ["seal", process.env.FAMILY_SEAL_ROOT ?? sourceRoot],
    ["seal-check", process.env.FAMILY_SEAL_CHECK_ROOT ?? resolve(sourceRoot, ".family/seal-check")],
    ["seal-demo", process.env.FAMILY_SEAL_DEMO_ROOT ?? resolve(sourceRoot, ".family/seal-demo")],
    ["seal-live-demo", process.env.FAMILY_SEAL_LIVE_DEMO_ROOT ?? resolve(sourceRoot, ".family/seal-live-demo")],
    ["seal-verify-action", process.env.FAMILY_SEAL_VERIFY_ACTION_ROOT ?? resolve(sourceRoot, ".family/seal-verify-action")],
    ["seal-assurance-kit", process.env.FAMILY_SEAL_ASSURANCE_KIT_ROOT ?? resolve(sourceRoot, ".family/seal-assurance-kit")],
    ["mcp-seal-dev", process.env.FAMILY_MCP_SEAL_DEV_ROOT ?? resolve(sourceRoot, ".family/mcp-seal-dev")],
  ]);
}

function prepareFamilyTree(sourceRoot) {
  const familyDir = resolve(sourceRoot, ".family");
  const present = FAMILY_REPOSITORIES.filter(([repo]) => existsSync(resolve(familyDir, repo)));
  if (present.length === FAMILY_REPOSITORIES.length) return () => {};
  if (present.length !== 0 || existsSync(familyDir)) {
    throw new Error(`partial .family tree: found ${present.length} of ${FAMILY_REPOSITORIES.length} repositories`);
  }

  mkdirSync(familyDir);
  try {
    for (const [repo, branch] of FAMILY_REPOSITORIES) {
      const clone = spawnSync("git", ["clone", "--quiet", "--depth", "1", "--branch", branch,
        `https://github.com/velvetmonkey/${repo}`, resolve(familyDir, repo)], {
        cwd: sourceRoot,
        encoding: "utf8",
      });
      if (clone.status !== 0) throw new Error(`git clone ${repo} exited ${clone.status}: ${clone.stderr.trim()}`);
    }
  } catch (error) {
    rmSync(familyDir, { recursive: true, force: true });
    throw error;
  }
  return () => rmSync(familyDir, { recursive: true, force: true });
}

function targetFor(file, link, sourceRoot, roots, rootRelative = false) {
  const [family] = link.split("/", 1);
  if (roots.has(family)) {
    return {
      kind: family === "seal" ? "internal" : "external",
      path: resolve(roots.get(family), link.slice(family.length + 1)),
    };
  }
  return { kind: "internal", path: resolve(rootRelative ? sourceRoot : dirname(`${sourceRoot}/${file}`), link) };
}

function check(file, raw, sourceRoot, roots, rootRelative = false) {
  let link = raw.trim();
  if (!link || link.startsWith("#") || link.startsWith("//") || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(link)) return;
  scannedTargets.add(link);
  link = link.split("#")[0].split("?")[0];
  if (!link) return;
  const target = targetFor(file, link, sourceRoot, roots, rootRelative);
  if (target.kind === "external") {
    externalLinks++;
    fileOccurrences[file].externalOccurrences++;
    if (!existsSync(target.path)) console.log(`EXTERNAL  ${file} -> ${link}`);
    return;
  }
  checked++;
  fileOccurrences[file].internalOccurrences++;
  if (!existsSync(target.path)) { console.log(`BROKEN  ${file} -> ${link}`); bad++; }
}

function strings(value, out = []) {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) for (const item of value) strings(item, out);
  else if (value && typeof value === "object") for (const item of Object.values(value)) strings(item, out);
  return out;
}

const markdownParser = new CommonMarkParser();
const htmlTag = /<[A-Za-z][^>"']*(?:"[^"]*"|'[^']*'|[^'"<>])*?>/g;
const htmlAttribute = /(?:^|\s)(?:src|href)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/gi;

function htmlDestinations(text) {
  const destinations = [];
  for (const tag of text.matchAll(htmlTag)) {
    for (const attribute of tag[0].matchAll(htmlAttribute)) {
      destinations.push(attribute[1] ?? attribute[2] ?? attribute[3] ?? "");
    }
  }
  return destinations;
}

export function markdownDestinations(text) {
  const destinations = [];
  const walker = markdownParser.parse(text).walker();
  let event;
  while ((event = walker.next())) {
    if (!event.entering) continue;
    const { node } = event;
    if ((node.type === "link" || node.type === "image") && node.destination) {
      destinations.push(node.destination);
    }
    if ((node.type === "html_block" || node.type === "html_inline") && node.literal) {
      destinations.push(...htmlDestinations(node.literal));
    }
  }
  return destinations;
}

// Deliberately narrow: a path must contain a directory separator and end in a
// filename extension whose first character is alphabetic. That catches stale
// filenames with unknown extensions without treating `v0.2.0.1` as a path.
const pathString = /(?:^|[\s"'`])((?:(?:\.{1,2}\/)?(?:[A-Za-z0-9_.-]+\/)+[A-Za-z0-9_.-]+\.[A-Za-z][A-Za-z0-9_-]*)|(?:(?:README|index|EVALUATOR-START)\.(?:md|html)))(?:$|[\s"'`),:#?])/gm;
function pathStrings(text) {
  return [...text.matchAll(pathString)].map((match) => match[1]);
}

let bad = 0, checked = 0, externalLinks = 0;
let fileOccurrences = {};
const scannedTargets = new Set();
const re = /\]\(([^)]+)\)|(?:href|src)\s*=\s*"([^"]+)"/g;

function populationSource(population) {
  const history = population.shrinkHistory.map(({ date, oldCounts, newCounts }) =>
    `    { date: ${JSON.stringify(date)}, oldCounts: ${JSON.stringify(oldCounts)}, newCounts: ${JSON.stringify(newCounts)} },`,
  );
  return [
    "// Generated by node scripts/linkcheck.mjs --write; review by rerunning that command.",
    "// The separate-source target cross-check lives in test/linkcheck.test.mjs and",
    "// cannot be refreshed from LINKCHECK_REPORT_SCANNED_TARGETS. It is deliberately",
    "// described as a cross-check; docs/assurance/linkcheck-population-control.md",
    "// records its shared blind spots.",
    "// High-water marks never move down automatically; accepted shrink history stays review-visible.",
    "export default {",
    ...(population.populationRule === 1 ? ["  populationRule: 1,"] : []),
    `  internalOccurrences: ${population.internalOccurrences},`,
    `  externalOccurrences: ${population.externalOccurrences},`,
    `  internalOccurrencesHighWaterMark: ${population.internalOccurrencesHighWaterMark},`,
    `  externalOccurrencesHighWaterMark: ${population.externalOccurrencesHighWaterMark},`,
    `  fileOccurrences: ${JSON.stringify(population.fileOccurrences, null, 2).replace(/^/gm, "  ")},`,
    `  fileOccurrencesHighWaterMarks: ${JSON.stringify(population.fileOccurrencesHighWaterMarks, null, 2).replace(/^/gm, "  ")},`,
    "  shrinkHistory: [",
    ...history,
    "  ],",
    "};",
    "",
  ].join("\n");
}

export function populationChanges(oldPopulation, newPopulation) {
  return POPULATION_KEYS.map((key) => ({
    key,
    oldCount: oldPopulation[key],
    newCount: newPopulation[key],
    difference: newPopulation[key] - oldPopulation[key],
  }));
}

function duplicateObjectKeys(source, marker) {
  const markerIndex = source.indexOf(marker);
  if (markerIndex < 0) return [];
  const open = source.indexOf("{", markerIndex + marker.length);
  if (open < 0) return [];
  const keys = [];
  const seen = new Set();
  let depth = 0;
  let quote = null;
  let escaped = false;
  for (let index = open; index < source.length; index++) {
    const character = source[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'") {
      if (depth === 1) {
        let end = index + 1;
        let stringEscaped = false;
        for (; end < source.length; end++) {
          if (stringEscaped) stringEscaped = false;
          else if (source[end] === "\\") stringEscaped = true;
          else if (source[end] === character) break;
        }
        let after = end + 1;
        while (/\s/u.test(source[after] ?? "")) after++;
        if (source[after] === ":") {
          const raw = source.slice(index, end + 1);
          const key = character === '"' ? JSON.parse(raw) : raw.slice(1, -1);
          if (seen.has(key)) keys.push(key);
          else seen.add(key);
        }
      }
      quote = character;
    } else if (character === "{") depth++;
    else if (character === "}") {
      depth--;
      if (depth === 0) break;
    }
  }
  return keys;
}

function validateOccurrenceMap(map, name) {
  for (const [file, occurrences] of Object.entries(map)) {
    if (!occurrences || typeof occurrences !== "object" || Array.isArray(occurrences)) {
      throw new Error(`bad value in ${name} for ${file}: expected an object`);
    }
    for (const key of FILE_COUNT_KEYS) {
      const value = occurrences[key];
      if (!Number.isSafeInteger(value) || value < 0) {
        throw new Error(`bad value in ${name} for ${file} ${key}: ${String(value)}`);
      }
    }
    const unexpectedKeys = Object.keys(occurrences).filter((key) => !FILE_COUNT_KEYS.includes(key));
    if (unexpectedKeys.length) {
      throw new Error(`bad value in ${name} for ${file}: unexpected key ${unexpectedKeys[0]}`);
    }
  }
}

function validateFileHighWaterMarks(population, currentPopulation) {
  const marks = population.fileOccurrencesHighWaterMarks;
  const recordedFiles = population.fileOccurrences ?? {};
  const countedFiles = currentPopulation.fileOccurrences ?? {};
  validateOccurrenceMap(recordedFiles, "fileOccurrences");
  validateOccurrenceMap(marks, "fileOccurrencesHighWaterMarks");
  for (const file of Object.keys(recordedFiles)) {
    if (!Object.hasOwn(marks, file)) {
      throw new Error(`incomplete fileOccurrencesHighWaterMarks: missing recorded file ${file}`);
    }
  }
  for (const file of Object.keys(marks)) {
    if (!Object.hasOwn(recordedFiles, file) && !Object.hasOwn(countedFiles, file)) {
      throw new Error(`stranger key in fileOccurrencesHighWaterMarks: ${file}`);
    }
  }
}

export function populationDecision(oldPopulation, newPopulation, { allowShrinkFiles = [], date = new Date().toISOString().slice(0, 10) } = {}) {
  const authorizedFiles = new Set(allowShrinkFiles);
  const currentShrinks = populationChanges(oldPopulation, newPopulation).filter(({ difference }) => difference < 0);
  const recordedCounts = oldPopulation.fileOccurrencesHighWaterMarks;
  const newCounts = newPopulation.fileOccurrences ?? {};
  const files = [...new Set([...Object.keys(recordedCounts), ...Object.keys(newCounts)])].sort();
  const shrinks = files.flatMap((file) => FILE_COUNT_KEYS.flatMap((key) => {
    const oldCount = recordedCounts[file]?.[key] ?? 0;
    const newCount = newCounts[file]?.[key] ?? 0;
    const difference = newCount - oldCount;
    return difference < 0 ? [{ file, key, oldCount, newCount, difference }] : [];
  }));
  const shrinkingFiles = new Set(shrinks.map(({ file }) => file));
  const unauthorizedShrinks = shrinks.filter(({ file }) => !authorizedFiles.has(file));
  const unusedAuthorizations = [...authorizedFiles].filter((file) => !shrinkingFiles.has(file)).sort();
  if (unauthorizedShrinks.length || unusedAuthorizations.length) {
    return { population: null, shrinks, unauthorizedShrinks, unusedAuthorizations };
  }
  return {
    shrinks,
    unauthorizedShrinks: [],
    unusedAuthorizations: [],
    population: {
      populationRule: 1,
      ...newPopulation,
      ...Object.fromEntries(POPULATION_KEYS.map((key) => [
        HIGH_WATER_KEYS[key],
        Math.max(oldPopulation[HIGH_WATER_KEYS[key]], newPopulation[key]),
      ])),
      fileOccurrencesHighWaterMarks: Object.fromEntries(
        files
          .filter((file) => Object.hasOwn(newCounts, file))
          .map((file) => [file, Object.fromEntries(FILE_COUNT_KEYS.map((key) => [
            key, Math.max(recordedCounts[file]?.[key] ?? 0, newCounts[file]?.[key] ?? 0),
          ]))]),
      ),
      shrinkHistory: currentShrinks.length ? [
        ...oldPopulation.shrinkHistory,
        {
          date,
          oldCounts: Object.fromEntries(POPULATION_KEYS.map((key) => [key, oldPopulation[key]])),
          newCounts: Object.fromEntries(POPULATION_KEYS.map((key) => [key, newPopulation[key]])),
        },
      ] : oldPopulation.shrinkHistory,
    },
  };
}

async function committedPopulation() {
  const source = readFileSync(POPULATION_FILE, "utf8");
  for (const marker of ["fileOccurrences:", "fileOccurrencesHighWaterMarks:"]) {
    const duplicateKeys = duplicateObjectKeys(source, marker);
    if (duplicateKeys.length) {
      throw new Error(`duplicate key in ${marker.slice(0, -1)}: ${duplicateKeys[0]}`);
    }
  }
  const imported = await import(`${pathToFileURL(POPULATION_FILE).href}?linkcheck=${Date.now()}`);
  const recordedPopulation = imported.default;
  if (!recordedPopulation || typeof recordedPopulation !== "object" || Array.isArray(recordedPopulation)) {
    throw new Error("invalid population record: expected an object");
  }
  const legacyPopulation = recordedPopulation.populationRule === undefined;
  if (!legacyPopulation && recordedPopulation.populationRule !== 1) {
    throw new Error(`invalid populationRule: ${String(recordedPopulation.populationRule)}`);
  }
  const population = {};
  for (const key of POPULATION_KEYS) {
    const highWaterKey = HIGH_WATER_KEYS[key];
    if (!Number.isSafeInteger(recordedPopulation[key]) || recordedPopulation[key] < 0) {
      throw new Error(`invalid non-negative integer ${key}`);
    }
    if (!Number.isSafeInteger(recordedPopulation[highWaterKey]) || recordedPopulation[highWaterKey] < recordedPopulation[key]) {
      throw new Error(`invalid ${highWaterKey}: must be an integer at least ${key}`);
    }
    population[key] = recordedPopulation[key];
    population[highWaterKey] = recordedPopulation[highWaterKey];
  }
  if (recordedPopulation.fileOccurrences !== undefined &&
      (!recordedPopulation.fileOccurrences || typeof recordedPopulation.fileOccurrences !== "object" ||
       Array.isArray(recordedPopulation.fileOccurrences))) {
    throw new Error("invalid fileOccurrences: must be an object");
  }
  if (!Object.hasOwn(recordedPopulation, "fileOccurrencesHighWaterMarks")) {
    throw new Error("invalid fileOccurrencesHighWaterMarks: expected a non-empty object");
  }
  if (!recordedPopulation.fileOccurrencesHighWaterMarks ||
      typeof recordedPopulation.fileOccurrencesHighWaterMarks !== "object" ||
      Array.isArray(recordedPopulation.fileOccurrencesHighWaterMarks) ||
      Object.keys(recordedPopulation.fileOccurrencesHighWaterMarks).length === 0) {
    throw new Error("invalid fileOccurrencesHighWaterMarks: expected a non-empty object");
  }
  population.fileOccurrences = recordedPopulation.fileOccurrences ?? {};
  population.fileOccurrencesHighWaterMarks = recordedPopulation.fileOccurrencesHighWaterMarks;
  if (!Array.isArray(recordedPopulation.shrinkHistory)) throw new Error("invalid shrinkHistory: must be an array");
  population.shrinkHistory = recordedPopulation.shrinkHistory;
  if (!legacyPopulation) population.populationRule = 1;
  if (populationSource(population) !== source) {
    throw new Error("population record is not canonical; comments, duplicate keys, or hand edits are not accepted");
  }
  if (legacyPopulation) {
    // One-time migration from the layered record: the last generated current
    // counts become the sole union-rule floor. Later authorized partial
    // decreases retain that floor instead of re-baselining it.
    population.fileOccurrencesHighWaterMarks = population.fileOccurrences;
  }
  return { population, source };
}

function describeChanges(changes) {
  return changes.map(({ file, key, oldCount, newCount, difference }) =>
    `${file ? `${file} ` : ""}${key} old=${oldCount} new=${newCount} difference=${difference}`,
  ).join("; ");
}

async function main({ sourceRoot = ROOT, write = false, allowShrinkFiles = [] } = {}) {
  bad = 0;
  checked = 0;
  externalLinks = 0;
  scannedTargets.clear();
  let sourceFiles;
  try {
    sourceFiles = walk(sourceRoot);
  } catch (error) {
    console.error(`REFUSE link-check source tree unreadable: ${sourceRoot}: ${error.message}`);
    return 1;
  }
  if (sourceFiles.length === 0) {
    console.error(`REFUSE link-check source tree empty: ${sourceRoot}`);
    return 1;
  }
  let cleanupFamilyTree = () => {};
  if (write) {
    try {
      cleanupFamilyTree = prepareFamilyTree(sourceRoot);
      sourceFiles = walk(sourceRoot);
    } catch (error) {
      console.error(`REFUSE link-check family tree unavailable: ${error.message}`);
      return 1;
    }
  }
  try {
    return await measure({ sourceRoot, sourceFiles, write, allowShrinkFiles });
  } finally {
    cleanupFamilyTree();
  }
}

async function measure({ sourceRoot, sourceFiles, write, allowShrinkFiles }) {
  const roots = familyRoots(sourceRoot);
  const files = [...new Set(["README.md", ...sourceFiles.filter((f) => /\.(md|html)$/.test(f) && !f.startsWith("node_modules/"))])];
  const dataFiles = sourceFiles.filter((f) =>
    f !== "scripts/mandatory-doc-claim-bindings.json"
      && (/^\.github\//.test(f) || /^scripts\//.test(f)) && /\.(json|ya?ml)$/i.test(f),
  );
  fileOccurrences = Object.fromEntries([...new Set([...files, ...dataFiles])].sort().map((file) => [file, {
    internalOccurrences: 0,
    externalOccurrences: 0,
  }]));

  try {
    for (const f of files) {
      const txt = readFileSync(`${sourceRoot}/${f}`, "utf8");
      if (f.endsWith(".md")) {
        for (const link of markdownDestinations(txt)) check(f, link, sourceRoot, roots);
      } else {
        for (const m of txt.matchAll(re)) check(f, m[1] || m[2] || "", sourceRoot, roots);
      }
    }

    // Binding records use path:line proof references, not document links.
    for (const f of dataFiles) {
      const text = readFileSync(resolve(sourceRoot, f), "utf8");
      const candidates = f.endsWith(".json") ? strings(JSON.parse(text)) : [text];
      for (const candidate of candidates) {
        for (const link of pathStrings(candidate)) check(f, link, sourceRoot, roots, true);
      }
    }
  } catch (error) {
    console.error(`REFUSE link-check source tree unreadable: ${sourceRoot}: ${error.message}`);
    return 1;
  }

  if (checked === 0 && externalLinks === 0) {
    console.error(`REFUSE link-check measured zero links in source tree: ${sourceRoot}`);
    return 1;
  }

  if (process.env.LINKCHECK_REPORT_SCANNED_TARGETS === "1") {
    console.log(`link-check-targets: ${JSON.stringify([...scannedTargets].sort())}`);
  }

  const requiredLiveLinks = new Map([
    ["https://velvetmonkey.github.io/seal-check/", ["README.md", "spine/demo.cjs"]],
  ]);
  let externalChecked = 0;
  for (const [link, carriers] of requiredLiveLinks) {
    for (const carrier of carriers) {
      if (!readFileSync(resolve(sourceRoot, carrier), "utf8").includes(link)) {
        console.log(`BROKEN  ${carrier} -> missing required live link ${link}`);
        bad++;
      }
    }
    try {
      const response = await fetch(link, { redirect: "follow", signal: AbortSignal.timeout(10000) });
      externalChecked++;
      if (!response.ok) {
        console.log(`BROKEN  ${link} -> HTTP ${response.status}`);
        bad++;
      }
      await response.body?.cancel();
    } catch (error) {
      console.log(`BROKEN  ${link} -> ${error.message}`);
      bad++;
    }
  }

  console.log(`link-check: ${checked} internal links, ${externalLinks} external links, ${externalChecked} required live links, ${bad} broken`);
  if (bad) return 1;
  if (write) {
    let oldPopulation, oldSource;
    try {
      ({ population: oldPopulation, source: oldSource } = await committedPopulation());
    } catch (error) {
      console.error(`REFUSE link-check population unreadable: ${POPULATION_FILE}: ${error.message}`);
      return 1;
    }
    const newPopulation = {
      internalOccurrences: checked,
      externalOccurrences: externalLinks,
      fileOccurrences,
    };
    try {
      validateFileHighWaterMarks(oldPopulation, newPopulation);
    } catch (error) {
      console.error(`REFUSE link-check population record: ${error.message}`);
      return 1;
    }
    const decision = populationDecision(oldPopulation, newPopulation, { allowShrinkFiles });
    if (!decision.population) {
      const { shrinks, unauthorizedShrinks, unusedAuthorizations } = decision;
      if (unauthorizedShrinks.length) {
        console.error(`REFUSE link-check population below recorded per-file count: ${describeChanges(unauthorizedShrinks)}; rerun with --write --allow-shrink FILE for each legitimate deletion`);
      }
      if (unusedAuthorizations.length) {
        console.error(`REFUSE unused --allow-shrink authorization: ${unusedAuthorizations.join(", ")} did not shrink`);
      }
      return 1;
    }
    const { population: acceptedPopulation, shrinks } = decision;
    if (shrinks.length) {
      console.log(`OVERRIDE link-check population below recorded per-file count: ${describeChanges(shrinks)}`);
    }
    const newSource = populationSource(acceptedPopulation);
    if (newSource === oldSource) {
      console.log(`link-check-population: unchanged ${POPULATION_FILE} (${checked} internal, ${externalLinks} external)`);
      return 0;
    }
    writeFileSync(POPULATION_FILE, newSource, "utf8");
    console.log(`link-check-population: wrote ${POPULATION_FILE} (${checked} internal, ${externalLinks} external)`);
  }
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  let sourceRoot = ROOT;
  let write = false;
  const allowShrinkFiles = [];
  while (args.length) {
    const arg = args.shift();
    if (arg === "--write") write = true;
    else if (arg === "--allow-shrink" && args.length && !args[0].startsWith("--")) allowShrinkFiles.push(args.shift());
    else if (arg === "--allow-shrink") {
      console.error("usage: --allow-shrink requires a file name");
      process.exit(2);
    }
    else if (arg === "--root" && args.length) sourceRoot = resolve(args.shift());
    else {
      console.error("usage: node scripts/linkcheck.mjs [--write [--allow-shrink FILE ...]] [--root PATH]");
      process.exit(2);
    }
  }
  if (allowShrinkFiles.length && !write) {
    console.error("usage: --allow-shrink requires --write");
    process.exit(2);
  }
  process.exit(await main({ sourceRoot, write, allowShrinkFiles }));
}
