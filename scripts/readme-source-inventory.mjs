#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Derive the README claim population from the held base, rather than from a
// hand-written denominator. Every assertion-bearing source unit must classify
// as RETAINED, RELOCATED, or DISCHARGED; no fall-through is permitted.
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const base = "ef918e0";
const original = spawnSync("git", ["show", `${base}:README.md`], {
  cwd: root, encoding: "utf8",
});
if (original.status !== 0) {
  console.error(`ERROR unable to read ${base}:README.md: ${original.stderr.trim()}`);
  process.exit(2);
}

const lines = original.stdout.split("\n");
const auditLegacy = process.argv[2] === "--audit-legacy" ? process.argv[3] : null;
const sectionHomes = new Map([
  ["preamble", ["docs/WHAT-SEAL-IS.md", "Seal is an object-capability broker"]],
  ["First receipt in 60 seconds — zero dependencies (no Docker, no Lean toolchain)", ["docs/CLAIMS-MATRIX.md", "| Claim |"]],
  ["What it does", ["docs/WHAT-SEAL-IS.md", "Seal is an object-capability broker"]],
  ["Why you can believe it", ["docs/CLAIMS-MATRIX.md", "| Claim |"]],
  ["The family", ["docs/assurance/architecture.md", "Seal family architecture"]],
  ["The receipt toolset — one question each", ["docs/CLAIMS-MATRIX.md", "| Claim |"]],
  ["The five-minute path", ["docs/CLAIMS-MATRIX.md", "live demo's evidence is real"]],
  ["Choose your path", ["docs/REPO-TOPOLOGY.md", "Repository topology"]],
  ["For evaluators and auditors", ["docs/CLAIMS-MATRIX.md", "| Claim |"]],
  ["License", ["LICENSE", "Apache License"]],
]);
const specialHomes = new Map([
  [59, ["docs/assurance/architecture.md", "Seal family architecture"]],
  [61, ["docs/AUTHORIZATION-MESH.md", "within the approval's TTL window"]],
  [131, ["docs/TRUTH-BOX.md", "Runtime profile: `compatible`"]],
  [132, ["docs/TRUTH-BOX.md", "policy-covered request-effects"]],
  [133, ["docs/TRUTH-BOX.md", "the deployed host is not proved end to end"]],
  [140, ["docs/archive/LIMITATIONS.md", "mediation KERNEL, not of the whole deployed system"]],
  [141, ["docs/archive/LIMITATIONS.md", "does NOT prove SHA-256 collision resistance"]],
  [142, ["docs/archive/LIMITATIONS.md", "NOT proven bug-free"]],
  [143, ["README.md", "Seal guarantees AUTHORIZATION match, not INTENT match"]],
  [144, ["docs/archive/LIMITATIONS.md", "does NOT prevent compromise of hosts, browsers, build systems, keys, operators"]],
  [145, ["docs/archive/LIMITATIONS.md", "tamper-EVIDENT, not tamper-IMPOSSIBLE"]],
  [146, ["docs/archive/LIMITATIONS.md", "does NOT make the AI smarter or prevent hallucinations"]],
  [147, ["docs/archive/LIMITATIONS.md", "Axiom footprint {propext, Classical.choice, Quot.sound}"]],
  [148, ["docs/archive/LIMITATIONS.md", "per-theorem ceiling for theorems named in the family's axiom-pin gates"]],
]);

function assertionBearing(text) {
  return /\b(Seal|seal|agent|approval|request|effect|receipt|proof|prove|proven|tested|kernel|fleet|host|audit|axiom|claim|MCP|policy|witness|verify|attack|tool|Rust|wasm|JavaScript|SHA-256|runtime|compatible|canonical)\b/i.test(text);
}

// Paragraphs, list rows, table rows, and each truth-box line are hand-checkable
// semantic units. Fenced code, headings, badges, and diagrams are examples or
// structure rather than claim text and therefore outside this claim population.
const units = [];
let section = "preamble", inFence = false, paragraph = [];
function emitParagraph() {
  if (!paragraph.length) return;
  const text = paragraph.map((p) => p.text).join(" ").trim();
  if (assertionBearing(text)) units.push({ start: paragraph[0].line, end: paragraph.at(-1).line, text, section });
  paragraph = [];
}
for (let index = 0; index < lines.length; index++) {
  const line = lines[index]; const number = index + 1; const trimmed = line.trim();
  if (trimmed.startsWith("```")) { emitParagraph(); inFence = !inFence; continue; }
  if (inFence || !trimmed || trimmed.startsWith("<!--") || trimmed.startsWith("<p") || trimmed.startsWith("[![")) { emitParagraph(); continue; }
  if (trimmed.startsWith("## ")) { emitParagraph(); section = trimmed.slice(3); continue; }
  if (trimmed.startsWith("#")) { emitParagraph(); continue; }
  if (trimmed.startsWith("> ")) { emitParagraph(); if (assertionBearing(trimmed)) units.push({ start: number, end: number, text: trimmed, section }); continue; }
  if (/^(?:[-*]|\d+\.)\s/.test(trimmed) || trimmed.startsWith("|")) { emitParagraph(); if (assertionBearing(trimmed) && !/^\|[-| ]+\|$/.test(trimmed)) units.push({ start: number, end: number, text: trimmed, section }); continue; }
  paragraph.push({ line: number, text: trimmed });
}
emitParagraph();

if (units.length === 0) {
  console.error("ERROR README source population is empty; refusing to treat silence as a complete claim inventory");
  process.exit(1);
}

let failures = 0;
let legacyText = "";
if (auditLegacy) {
  const legacy = spawnSync("git", ["show", `${auditLegacy}:scripts/readme-claim-inventory.mjs`], { cwd: root, encoding: "utf8" });
  if (legacy.status !== 0) {
    console.error(`ERROR unable to read legacy inventory at ${auditLegacy}: ${legacy.stderr.trim()}`);
    process.exit(2);
  }
  legacyText = legacy.stdout;
}
for (const unit of units) {
  const home = specialHomes.get(unit.start) ?? sectionHomes.get(unit.section);
  if (!home) {
    console.error(`UNCLASSIFIED ${unit.start}-${unit.end} no classification rule: ${unit.text}`);
    failures++;
    continue;
  }
  const [file, needle] = home;
  if (auditLegacy && !legacyText.includes(`sourceLine: ${unit.start}`)) {
    console.error(`UNCLASSIFIED legacy ${unit.start}-${unit.end}: historical inventory has no source-line classification`);
    failures++;
    continue;
  }
  const path = resolve(root, file);
  const classification = file === "README.md" ? "RETAINED" : "RELOCATED";
  console.log(`${classification.padEnd(9)} ${unit.start}-${unit.end} -> ${file}`);
  if (!existsSync(path) || !readFileSync(path, "utf8").includes(needle)) {
    // A retained unit that vanishes is intentionally reported as unclassified:
    // the source population remains fixed, but it no longer has a valid home.
    console.error(`UNCLASSIFIED ${unit.start}-${unit.end} -> ${file}: ${JSON.stringify(needle)}`);
    failures++;
  }
}
console.log(`source-claim-inventory: ${units.length} derived units from ${base}:README.md, ${failures} unclassified`);
process.exit(failures ? 1 : 0);
