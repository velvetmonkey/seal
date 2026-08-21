#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { PAYLOAD_PATHS } = require("./dist-payload.cjs");

const ROOT = path.join(__dirname, "..");
const PRELOAD = path.join(__dirname, "observe-installed-store.cjs");

function rel(file) { return path.relative(ROOT, file).split(path.sep).join("/"); }
function lineNumber(text, index) { return text.slice(0, index).split("\n").length; }
function trackedFiles() {
  return spawnSync("git", ["-C", ROOT, "ls-files", "-z"], { encoding: "utf8" }).stdout
    .split("\0").filter(Boolean).map((name) => path.join(ROOT, name));
}
function addHit(hits, seen, file, text, index, value) {
  const item = { path: value, site: `${rel(file)}:${lineNumber(text, index)}` };
  // The launcher validates VERSION through its record metadata; it does not
  // consume VERSION as an installed-store payload requirement in this run.
  if (item.path === "VERSION" && item.site.startsWith("scripts/seal-launch.cjs:")) return;
  const key = `${item.path}\0${item.site}`;
  if (!seen.has(key)) { seen.add(key); hits.push(item); }
}
function staticPaths() {
  if (process.env.TWODERIVATIONS_DISABLE_STATIC) throw new Error("static derivation disabled");
  const hits = []; const seen = new Set();
  const patterns = [
    /\*\/([A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)+)/g,
    /\$store\/([A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)+)/g,
    /\/store\/[0-9a-f]{64}\/([A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)+)/g,
  ];
  for (const file of trackedFiles()) {
    const text = fs.readFileSync(file, "utf8");
    for (const pattern of patterns) {
      pattern.lastIndex = 0;
      for (const match of text.matchAll(pattern)) addHit(hits, seen, file, text, match.index, match[1]);
    }
    // Keep the source derivation structural for literal path.join components.
    // Template expressions and other computed values are deliberately left to
    // the independent observation side.
    const roots = new Set(["record.store"]);
    for (const match of text.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*path\.join\(([^\n()]*)\)/g)) {
      if (match[2].split(",").some((arg) => arg.trim() === "record.store")) roots.add(match[1]);
    }
    for (const match of text.matchAll(/path\.join\(([^\n()]*)\)/g)) {
      const args = match[1].split(",").map((arg) => arg.trim());
      const storeAt = args.findIndex((arg) => roots.has(arg));
      if (storeAt < 0) continue;
      const parts = args.slice(storeAt + 1).map((arg) => {
        const literal = /^(?:["']([^"']+)["'])$/.exec(arg);
        return literal ? literal[1] : null;
      });
      if (!parts.length || parts.some((part) => part === null)) continue;
      const lineStart = text.lastIndexOf("\n", match.index) + 1;
      const line = text.slice(lineStart, text.indexOf("\n", match.index) < 0 ? text.length : text.indexOf("\n", match.index));
      if (/existsSync\(/.test(line) && /,\s*false\s*\)/.test(line)) continue;
      if (/(?:writeFile|chmod|rmSync)\s*\(/.test(line)) continue;
      const assigned = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/.exec(line)?.[1];
      if (assigned && new RegExp(`(?:writeFileSync|chmodSync|rmSync)\\(\\s*${assigned}\\b`).test(text)
        && !new RegExp(`(?:readFileSync|statSync|lstatSync|existsSync)\\(\\s*${assigned}\\b`).test(text)) continue;
      addHit(hits, seen, file, text, match.index, parts.join("/"));
    }
    for (const match of text.matchAll(/for\s*\(const\s+rel\s+of\s*\[([\s\S]*?)\]\)/g)) {
      for (const part of match[1].matchAll(/["']([A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)+)["']/g)) {
        if (!PAYLOAD_PATHS.includes(part[1])) continue;
        addHit(hits, seen, file, text, match.index + part.index, part[1]);
      }
    }
  }
  if (!hits.length) throw new Error("static derivation is empty");
  return hits;
}
function consumerFiles() {
  return trackedFiles().filter((file) => /(?:^|\/)test\/.+\.test\.(?:cjs|mjs)$/.test(rel(file))
    && /(?:\/store\/[0-9a-f]{64}\/|\$store\/|path\.join\(\s*prefix\s*,\s*record\.store(?:\s*,|\s*\)))/.test(fs.readFileSync(file, "utf8")));
}
function observeOnce(runNumber) {
  if (process.env.TWODERIVATIONS_DISABLE_OBSERVED) return { records: [], executed: [] };
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "twoderivations-")), `run-${runNumber}.jsonl`);
  const executed = [];
  for (const consumerFile of consumerFiles()) {
    const env = { ...process.env, TWODERIVATIONS_OBSERVATION_FILE: file, TWODERIVATIONS_CONSUMER: rel(consumerFile) };
    const result = spawnSync(process.execPath, ["--require", PRELOAD, "--test", consumerFile], {
      cwd: ROOT, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
    });
    executed.push({ consumer: rel(consumerFile), status: result.status, error: result.error?.message });
  }
  const records = fs.existsSync(file) ? fs.readFileSync(file, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse) : [];
  return { records, executed };
}
function main() {
  let staticHits;
  try { staticHits = staticPaths(); } catch (error) { process.stderr.write(`FAIL static derivation: ${error.message}\n`); process.exit(1); }
  const declared = consumerFiles().map(rel);
  const run1 = observeOnce(1); const run2 = observeOnce(2);
  const observed1 = new Map(run1.records.map((item) => [item.path, item]));
  const observed2 = new Map(run2.records.map((item) => [item.path, item]));
  const s = new Map(staticHits.map((item) => [item.path, item]));
  const equal = [...observed1.keys()].sort().join("\0") === [...observed2.keys()].sort().join("\0");
  const observed = new Set(observed1.keys());
  const missingStatic = [...observed].filter((item) => !s.has(item)).sort();
  const missingObserved = [...s.keys()].filter((item) => !observed.has(item)).sort();
  const executed = new Set([...run1.executed, ...run2.executed].filter((item) => item.status === 0).map((item) => item.consumer));
  const coverage = declared.filter((item) => executed.has(item));
  process.stdout.write(`STATIC set (${s.size}): ${[...s.keys()].sort().join(", ")}\n`);
  process.stdout.write(`OBSERVED run 1 (${observed1.size}): ${[...observed1.keys()].sort().join(", ")}\n`);
  process.stdout.write(`OBSERVED run 2 (${observed2.size}): ${[...observed2.keys()].sort().join(", ")}\n`);
  process.stdout.write(`coverage ${coverage.length} of ${declared.length} consumers (${coverage.join(", ")})\n`);
  process.stdout.write(`determinism run1-equals-run2 ${equal ? "yes" : "no"}\n`);
  let failed = false;
  if (!declared.length || coverage.length !== declared.length) { process.stderr.write(`FAIL coverage incomplete: ${coverage.length} of ${declared.length} consumers; S\\O is UNKNOWN\n`); failed = true; }
  if (!equal) { process.stderr.write("FAIL observation is nondeterministic: run 1 and run 2 differ\n"); failed = true; }
  for (const item of missingStatic) { const hit = observed1.get(item); process.stderr.write(`FAIL observed but not declared: ${item}, seen by ${hit.consumer}\n`); failed = true; }
  if (coverage.length === declared.length) for (const item of missingObserved) { process.stderr.write(`FAIL declared but not observed: ${item}, declared at ${s.get(item).site}\n`); failed = true; }
  for (const run of [...run1.executed, ...run2.executed]) if (run.status !== 0) { process.stderr.write(`FAIL consumer execution: ${run.consumer} status ${run.status}\n`); failed = true; }
  if (!run1.records.length || !run2.records.length) { process.stderr.write("FAIL observed derivation is empty (zero observation is never agreement)\n"); failed = true; }
  process.exitCode = failed ? 1 : 0;
}
if (require.main === module) main();
module.exports = { staticPaths, consumerFiles, observeOnce };
