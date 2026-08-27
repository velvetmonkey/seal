#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Internal-link integrity check for the Seal landing repo: every relative
// link/src in the docs must resolve to a file. Run: node scripts/linkcheck.mjs
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const { Parser: CommonMarkParser } = require("./vendor/commonmark.cjs");

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
function isRepositoryPage(file) {
  return file === "README.md" || /\.(md|html)$/.test(file);
}

const files = [...new Set(["README.md", ...walk(ROOT).filter((f) => /\.(md|html)$/.test(f) && !f.startsWith("node_modules/"))])];
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

export function countDestination(file, raw, sourceRoot, roots, counts, checkTargets, rootRelative = false) {
  let link = raw.trim();
  if (!link || link.startsWith("#") || link.startsWith("//") || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(link)) return;
  if (checkTargets) scannedTargets.add(link);
  link = link.split("#")[0].split("?")[0];
  if (!link) return;
  const target = targetFor(file, link, sourceRoot, roots, rootRelative);
  if (target.kind === "external") {
    counts.externalOccurrences++;
    const [family] = link.split("/", 1);
    if (!checkTargets) return;
    const familyExists = existsSync(roots.get(family));
    if (!familyExists) {
      console.log(`UNVERIFIED  ${file} -> ${link}`);
      counts.unverified++;
      unverifiedTargets.add(raw.trim());
    } else {
      const targetExists = existsSync(target.path);
      checkedTargets.add(raw.trim());
      if (!targetExists) {
        console.log(`BROKEN  ${file} -> ${link}`);
        counts.bad++;
      }
    }
    return;
  }
  counts.internalOccurrences++;
  if (checkTargets) {
    const targetExists = existsSync(target.path);
    checkedTargets.add(raw.trim());
    if (!targetExists) { console.log(`BROKEN  ${file} -> ${link}`); counts.bad++; }
  }
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

const scannedTargets = new Set();
const checkedTargets = new Set();
const unverifiedTargets = new Set();
const re = /\]\(([^)]+)\)|(?:href|src)\s*=\s*"([^"]+)"/g;

function countOccurrences({ sourceRoot, sourceFiles, readText, checkTargets }) {
  const roots = new Map([
    ["seal", sourceRoot],
    ["seal-check", process.env.FAMILY_SEAL_CHECK_ROOT ?? resolve(sourceRoot, ".family/seal-check")],
    ["seal-demo", process.env.FAMILY_SEAL_DEMO_ROOT ?? resolve(sourceRoot, ".family/seal-demo")],
    ["seal-live-demo", process.env.FAMILY_SEAL_LIVE_DEMO_ROOT ?? resolve(sourceRoot, ".family/seal-live-demo")],
    ["seal-verify-action", process.env.FAMILY_SEAL_VERIFY_ACTION_ROOT ?? resolve(sourceRoot, ".family/seal-verify-action")],
    ["seal-assurance-kit", process.env.FAMILY_SEAL_ASSURANCE_KIT_ROOT ?? resolve(sourceRoot, ".family/seal-assurance-kit")],
    ["mcp-seal-dev", process.env.FAMILY_MCP_SEAL_DEV_ROOT ?? resolve(sourceRoot, ".family/mcp-seal-dev")],
  ]);
  const files = [...new Set(["README.md", ...sourceFiles.filter((f) => /\.(md|html)$/.test(f) && !f.startsWith("node_modules/"))])];
  const dataFiles = sourceFiles.filter((f) =>
    f !== "scripts/mandatory-doc-claim-bindings.json"
      && (/^\.github\//.test(f) || /^scripts\//.test(f)) && /\.(json|ya?ml)$/i.test(f),
  );
  const counts = { internalOccurrences: 0, externalOccurrences: 0, unverified: 0, bad: 0, files: {} };
  for (const file of [...new Set([...files, ...dataFiles])].sort()) {
    counts.files[file] = { internalOccurrences: 0, externalOccurrences: 0 };
  }
  const count = (file, raw, rootRelative = false) => {
    const beforeInternal = counts.internalOccurrences;
    const beforeExternal = counts.externalOccurrences;
    countDestination(file, raw, sourceRoot, roots, counts, checkTargets, rootRelative);
    counts.files[file].internalOccurrences += counts.internalOccurrences - beforeInternal;
    counts.files[file].externalOccurrences += counts.externalOccurrences - beforeExternal;
  };
  for (const file of files) {
    const text = readText(file);
    if (file.endsWith(".md")) for (const link of markdownDestinations(text)) count(file, link);
    else for (const match of text.matchAll(re)) count(file, match[1] || match[2] || "");
  }
  for (const file of dataFiles) {
    const text = readText(file);
    const candidates = file.endsWith(".json") ? strings(JSON.parse(text)) : [text];
    for (const candidate of candidates) for (const link of pathStrings(candidate)) count(file, link, true);
  }
  return counts;
}

function baselineTree(sourceRoot) {
  try {
    const gitOptions = { cwd: sourceRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] };
    const base = execFileSync("git", ["merge-base", "HEAD", "origin/main"], gitOptions).trim();
    const names = execFileSync("git", ["ls-tree", "-r", "--name-only", base], gitOptions).trim();
    return { base, files: new Set(names ? names.split("\n") : []) };
  } catch (error) {
    const reason = (error.stderr?.toString() || error.message || "unknown error").trim().replace(/\s+/g, " ");
    console.error(`REFUSE link-check baseline unresolved: origin/main: git merge-base HEAD origin/main failed: ${reason}`);
    process.exit(1);
  }
}

function compareToBaseline(sourceRoot, actual) {
  const { base, files: baselineFiles } = baselineTree(sourceRoot);
  const expectedFiles = [...baselineFiles];
  const expectedSource = (file) => execFileSync("git", ["show", `${base}:${file}`], { cwd: sourceRoot, encoding: "utf8" });
  const expected = countOccurrences({
    sourceRoot,
    sourceFiles: expectedFiles,
    readText: expectedSource,
    checkTargets: false,
  });
  const disagreements = Object.keys(expected.files).flatMap((file) => {
    const oldCounts = expected.files[file];
    const newCounts = actual.files[file] ?? { internalOccurrences: 0, externalOccurrences: 0 };
    return ["internalOccurrences", "externalOccurrences"].flatMap((key) =>
      newCounts[key] < oldCounts[key] ? [`${file} ${key} expected=${oldCounts[key]} actual=${newCounts[key]}`] : [],
    );
  });
  return { base, expected, disagreements };
}

async function main() {
  scannedTargets.clear();
  checkedTargets.clear();
  unverifiedTargets.clear();
  const sourceFiles = walk(ROOT);
  const actual = countOccurrences({
    sourceRoot: ROOT,
    sourceFiles,
    readText: (file) => readFileSync(resolve(ROOT, file), "utf8"),
    checkTargets: true,
  });

  if (process.env.LINKCHECK_REPORT_SCANNED_TARGETS === "1") {
    console.log(`link-check-targets: ${JSON.stringify([...checkedTargets].sort())}`);
  }

  const uncheckedTargets = [...scannedTargets].filter((target) =>
    !checkedTargets.has(target) && !unverifiedTargets.has(target),
  ).sort();
  if (uncheckedTargets.length) {
    console.log(`REFUSE link-check targets not checked: ${uncheckedTargets.join(", ")}`);
    actual.bad++;
  }

  const baselinePopulation = [...baselineTree(ROOT).files].filter(isRepositoryPage);
  const livePopulation = new Set(execFileSync("git", ["ls-files", "-z"], { cwd: ROOT, encoding: "utf8" })
    .split("\0")
    .filter(Boolean)
    .filter(isRepositoryPage));
  const missingPopulation = baselinePopulation.filter((file) => !livePopulation.has(file));
  if (missingPopulation.length) {
    for (const file of missingPopulation) {
      console.log(`REFUSE link-check population lost: ${file}`);
    }
  }

  const requiredLiveLinks = new Map([
    ["https://velvetmonkey.github.io/seal-check/", ["README.md", "spine/demo.cjs"]],
  ]);
  let externalChecked = 0;
  for (const [link, carriers] of requiredLiveLinks) {
    for (const carrier of carriers) {
      if (!readFileSync(resolve(ROOT, carrier), "utf8").includes(link)) {
        console.log(`BROKEN  ${carrier} -> missing required live link ${link}`);
        actual.bad++;
      }
    }
    try {
      const response = await fetch(link, { redirect: "follow", signal: AbortSignal.timeout(10000) });
      externalChecked++;
      if (!response.ok) {
        console.log(`BROKEN  ${link} -> HTTP ${response.status}`);
        actual.bad++;
      }
      await response.body?.cancel();
    } catch (error) {
      console.log(`BROKEN  ${link} -> ${error.message}`);
      actual.bad++;
    }
  }

  console.log(`link-check: ${actual.internalOccurrences} internal links, ${actual.externalOccurrences} external links, ${externalChecked} required live links, ${actual.unverified} unverified, ${actual.bad} broken`);
  if (actual.bad || missingPopulation.length) return 1;
  const comparison = compareToBaseline(ROOT, actual);
  if (comparison.disagreements.length) {
    console.error(`REFUSE link-check tree disagreement with ${comparison.base}: ${comparison.disagreements.join("; ")}`);
    return 1;
  }
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(await main());
}
