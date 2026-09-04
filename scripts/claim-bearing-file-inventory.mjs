#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Fail-closed inventory for human-facing statements about Seal.
// Run: node scripts/claim-bearing-file-inventory.mjs
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MANIFEST = "scripts/claim-bearing-files.json";
// Ben's first narrow slice. Add a path here to widen the mandatory prose gate.
const MANDATORY_DOC_FILES = ["README.md", "docs/guide/knowing-it-worked.md", "docs/reproduce.md"];
const MANDATORY_BINDINGS = "scripts/mandatory-doc-claim-bindings.json";
const REQUIRED_MANDATORY_CLAIMS = {
  "README.md": "Seal holds each exact call, asks once, permits at most one execution, and writes a signed receipt.",
  "docs/guide/knowing-it-worked.md": "Seal makes the approved call and the executed call the same call: same tool,",
  "docs/reproduce.md": "`result` is `artifact-kernel-match`, `artifact-kernel-mismatch`, or `refused`.",
};

// A text file is claim-bearing when it contains a declarative, present-tense
// sentence whose subject is a Seal product entity. This is deliberately
// language-shaped, not a list of known product nouns or verbs: a new sentence
// such as "Seal intercepts requests" is inventory-bearing even when its
// behaviour verb has never appeared in this repository. Product claims can be
// comments or string literals in source files just as readily as Markdown
// prose. Bare contextual references are deliberately outside this subject-keyed
// rule: for example, "The kernel refuses a stale receipt" is not inventory-
// bearing unless it names Seal as its subject. That limit avoids treating a
// generic component noun as a product entity merely because a nearby document
// happens to make the referent clear. Binary artifacts remain outside the
// population below.
const PRODUCT_ENTITY = /\b(?:seal(?:-check)?|seal[- ]?(?:demo|protect|checker|kernel)|approval gate|guarded (?:tool|path|action)|receipt checker|landing page)\b/i;
const ASSERTION = /\b(?:is|are|was|were|has|have|does|do|will|would|can|cannot|can't|must|should|supports?|requires?|runs?|executes?|checks?|verifies?|writes?|creates?|refuses?|gates?|protects?|controls?|proves?|prevents?|allows?|denies?|blocks?|forwards?|ships?|uses?|works?|matches?|transforms?|turns?|converts?|makes?|renders?|serves?|starts?|stops?|sends?|receives?|calls?|invokes?|launches?|installs?|downloads?|publishes?|signs?|encrypts?|decrypts?)\b/i;
// Present-tense declaratives conventionally put a third-person verb after the
// subject. We use that grammatical shape in addition to the legacy predicate
// list above, so coverage cannot depend on whether a particular verb was
// anticipated when this script was written. Limiting it to sentence subjects
// avoids treating an incidental object mention of Seal as a behaviour claim.
const DIRECT_BEHAVIOUR = /^(?:the\s+)?(?:seal(?:-check)?|seal[- ]?(?:demo|protect|checker|kernel)|approval gate|guarded (?:tool|path|action)|receipt checker|landing page)\s+(?:(?:automatically|always|never|reliably|silently|directly|securely|fully|only)\s+){0,3}(?:is|are|has|does|can|cannot|can't|will|would|must|should|[a-z][a-z'-]*(?:s|es))\b/i;
// These are byte artifacts, not text that can contain a human-facing claim.
// Keep this list small and explicit; source extensions are intentionally absent.
const EXCLUDED_BINARY_PATHS = new Map([
  ["SHA256SUMS", "checksum records are opaque data, not prose"],
  ["bin/seal", "released executable artifact"],
]);
const EXCLUDED_BINARY_SUFFIXES = new Map([
  [".png", "raster image bytes"],
  [".wasm", "WebAssembly binary bytes"],
]);

let bad = false;
function fail(message) { console.error(`FAIL  ${message}`); bad = true; }
function trackedFiles() {
  try {
    return execFileSync("git", ["ls-files", "-z"], { cwd: ROOT, encoding: "utf8" }).split("\0").filter(Boolean).sort();
  } catch (error) {
    fail(`cannot enumerate tracked files: ${error.message}`);
    return [];
  }
}
function excludedBinaryReason(path) {
  if (EXCLUDED_BINARY_PATHS.has(path)) return EXCLUDED_BINARY_PATHS.get(path);
  return [...EXCLUDED_BINARY_SUFFIXES].find(([suffix]) => path.endsWith(suffix))?.[1];
}
function carriesClaim(text, path) {
  // A code-shaped text file contributes only its human-language comments and
  // sentence-like string literals.  This is syntax-shaped rather than
  // extension-shaped: a .js claim is seen, while identifiers such as
  // sealReceipt() do not turn executable implementation into prose inventory.
  // README contains shell examples such as `export PATH`; that does not make a
  // Markdown document source code. Other files retain the syntax-shaped scan.
  const codeShaped = path !== "README.md" && /^\s*(?:#!|import\s|export\s|(?:const|let|var|function|class)\s|["'](?:files|name)["']\s*:)/m.test(text);
  const units = codeShaped
    ? [...text.matchAll(/(?:\/\/|\/\*+|\*|#)\s*(.*)|(?:"([^"\n]{12,}[.!?])"|'([^'\n]{12,}[.!?])')/g)]
      .map((match) => match[1] ?? match[2] ?? match[3] ?? "")
    : text.split(/[.!?\n]+/);
  // Keep the entity and predicate in one human-language unit. The direct
  // sentence-subject branch catches novel behaviour verbs, while the existing
  // entity-plus-predicate branch retains coverage for statements that phrase
  // the product as an object or otherwise invert the sentence.
  return units.some((unit) => {
    // Comment-only snippets are still human-facing language even when they do
    // not otherwise look like a complete source file.
    const sentence = unit.replace(/^\s*(?:\/\/|#|\*+)\s*/, "");
    return DIRECT_BEHAVIOUR.test(sentence)
    || (PRODUCT_ENTITY.test(sentence) && ASSERTION.test(sentence)
      && (!codeShaped || /\b(?:every|all|only|never|always|browser|human|operator|user)\b/i.test(unit)));
  });
}
function readText(path) {
  const bytes = readFileSync(resolve(ROOT, path));
  if (bytes.includes(0)) return null;
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  return text;
}
function parseReference(reference) {
  if (typeof reference !== "string") return null;
  const hash = reference.indexOf("#");
  if (hash !== -1 && hash !== reference.lastIndexOf("#")) return { invalid: "marker must not contain a second #" };
  const marker = /^(.*)#([A-Za-z][A-Za-z0-9_-]*)$/.exec(reference);
  if (marker && marker[1]) return { path: marker[1], marker: marker[2] };
  const line = /^(.*):(\d+)$/.exec(reference);
  if (!line || !line[1] || Number(line[2]) < 1) return null;
  return { path: line[1], line: Number(line[2]) };
}
function coverageMarkers(proof, proofPath) {
  const markers = [];
  for (const match of proof.matchAll(/CLAIM-COVERAGE:\s+([^\s;]+#[A-Za-z][A-Za-z0-9_-]*)/g)) {
    markers.push(match[1]);
  }
  const duplicates = markers.filter((marker, index) => markers.indexOf(marker) !== index);
  if (duplicates.length) return `marker ${duplicates[0]} is not unique in ${proofPath}`;
  return null;
}
function markerCount(proof, binding) {
  const escaped = binding.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return [...proof.matchAll(new RegExp(`${escaped}(?=;|\\r?$)`, "gm"))].length;
}
function referenceProvesFile(reference, claimFile, tracked) {
  const parsed = parseReference(reference);
  if (parsed?.invalid) return parsed.invalid;
  if (!parsed) return "must be path:line or path#marker";
  if (!tracked.has(parsed.path)) return `references untracked proof file ${parsed.path}`;
  let proof;
  try { proof = readText(parsed.path); }
  catch (error) { return `cannot read proof file ${parsed.path}: ${error.message}`; }
  if (proof === null) return `proof file ${parsed.path} is binary`;
  const markerProblem = coverageMarkers(proof, parsed.path);
  if (markerProblem) return markerProblem;
  if (parsed.marker) {
    const binding = `CLAIM-COVERAGE: ${claimFile}#${parsed.marker}`;
    const occurrences = markerCount(proof, binding);
    if (occurrences === 0) return `marker ${parsed.marker} in ${parsed.path} does not bind CLAIM-COVERAGE: ${claimFile}`;
    if (occurrences > 1) return `marker ${parsed.marker} is not unique in ${parsed.path}`;
    return null;
  }
  const line = proof.split(/\r?\n/)[parsed.line - 1];
  if (line === undefined) return `references missing line ${parsed.line} in ${parsed.path}`;
  // Legacy path:line citations remain valid during the marker migration.
  if (!line.includes(`CLAIM-COVERAGE: ${claimFile}`)) {
    return `line ${parsed.line} in ${parsed.path} does not bind CLAIM-COVERAGE: ${claimFile}`;
  }
  return null;
}

function mandatoryClaimUnits(file) {
  const text = readText(file);
  if (text === null) return [];
  return text.split(/\r?\n/).flatMap((line) => line.split(/(?<=[.!?])\s+/))
    .map((unit) => unit.replace(/^\s*(?:[-*]\s+)?(?:\*\*)?/, "").replace(/(?:\*\*)?\s*$/, "").trim())
    .filter((unit) => Object.values(REQUIRED_MANDATORY_CLAIMS).includes(unit)
      || /\bSeal\s+proves?\b/i.test(unit)
      || /\bSeal\s+guarantees?\b/i.test(unit)
      || /\bSeal\s+has\s+made\s+every\b/i.test(unit));
}

function normalizedProse(text) {
  return text.replace(/\s+/g, " ").trim();
}

function checkMandatoryBindings() {
  if (!MANDATORY_DOC_FILES.some((file) => tracked.has(file))) return;
  let bindings;
  try { bindings = JSON.parse(readFileSync(resolve(ROOT, MANDATORY_BINDINGS), "utf8")); }
  catch (error) { fail(`mandatory binding file unreadable: ${error.message}`); return; }
  if (!bindings || typeof bindings !== "object" || !bindings.files || typeof bindings.files !== "object") {
    fail(`${MANDATORY_BINDINGS}: files must be an object`); return;
  }
  for (const file of MANDATORY_DOC_FILES) {
    const entry = manifest.files[file];
    if (!entry?.coveredBy?.length || entry.allowlistReason) fail(`${file}: mandatory document cannot use allowlist/debt coverage`);
    const fileBindings = bindings.files[file];
    if (!Array.isArray(fileBindings) || fileBindings.length === 0) { fail(`${file}: mandatory claim binding list is empty`); continue; }
    const fileText = normalizedProse(readText(file) ?? "");
    const bySentence = new Map(fileBindings.map((binding) => [binding.sentence, binding.proof]));
    if (!bySentence.has(REQUIRED_MANDATORY_CLAIMS[file])) fail(`${file}: required binding missing: ${REQUIRED_MANDATORY_CLAIMS[file]}`);
    for (const binding of fileBindings) {
      if (typeof binding?.sentence !== "string" || typeof binding?.proof !== "string") {
        fail(`${file}: binding must contain sentence and proof`);
        continue;
      }
      if (!fileText.includes(normalizedProse(binding.sentence))) fail(`${file}: bound claim sentence is absent from the document: ${binding.sentence}`);
      const problem = referenceProvesFile(binding.proof, file, tracked);
      if (problem) fail(`${file}: binding for sentence ${JSON.stringify(binding.sentence)} ${JSON.stringify(binding.proof)} ${problem}`);
    }
    for (const sentence of mandatoryClaimUnits(file)) {
      const proof = bySentence.get(sentence);
      if (!proof) { fail(`${file}: unbound claim sentence: ${sentence}`); continue; }
      const problem = referenceProvesFile(proof, file, tracked);
      if (problem) fail(`${file}: binding for sentence ${JSON.stringify(sentence)} ${JSON.stringify(proof)} ${problem}`);
    }
  }
}
let manifest;
try { manifest = JSON.parse(readFileSync(resolve(ROOT, MANIFEST), "utf8")); }
catch (error) { fail(`cannot read ${MANIFEST}: ${error.message}`); manifest = { files: {} }; }
if (!manifest.files || typeof manifest.files !== "object" || Array.isArray(manifest.files)) {
  fail(`${MANIFEST}: files must be an object`);
  manifest.files = {};
}

const tracked = new Set(trackedFiles());
const inventory = [];
for (const path of tracked) {
  // The inventory implementation's own sentence fixtures are not a second
  // published claim surface. Its distinct registry is handled explicitly.
  if (path === "scripts/claim-bearing-file-inventory.mjs") continue;
  if (path === MANDATORY_BINDINGS) { inventory.push(path); continue; }
  const excluded = excludedBinaryReason(path);
  if (excluded) continue;
  let text;
  try { text = readText(path); }
  catch (error) { fail(`${path}: cannot read text: ${error.message}`); continue; }
  if (text === null) { fail(`${path}: text kind is unclassified (contains NUL bytes; add a bounded binary exclusion with a reason if appropriate)`); continue; }
  if (carriesClaim(text, path)) inventory.push(path);
}
// governanceRecord only ever adds its tracked file to the claim surface.
// It cannot exclude a file or bypass any coverage validation below.
for (const [path, entry] of Object.entries(manifest.files)) {
  if (typeof entry?.governanceRecord === "string" && entry.governanceRecord.trim() !== ""
    && tracked.has(path) && !inventory.includes(path)) inventory.push(path);
}
for (const [path, entry] of Object.entries(manifest.files)) {
  if (!inventory.includes(path)) fail(`${path}: manifest entry is not a current claim-bearing file`);
  if (!entry || typeof entry !== "object") { fail(`${path}: manifest entry must be an object`); continue; }
  const covered = Array.isArray(entry.coveredBy) && entry.coveredBy.length > 0;
  if (Array.isArray(entry.coveredBy)) for (const reference of entry.coveredBy) {
    const problem = referenceProvesFile(reference, path, tracked);
    if (problem) fail(`${path}: coveredBy ${JSON.stringify(reference)} ${problem}`);
  }
  const reason = entry.allowlistReason;
  const governanceRecord = typeof entry.governanceRecord === "string" && entry.governanceRecord.trim() !== "";
  if (governanceRecord && !covered) fail(`${path}: governanceRecord requires coveredBy`);
  if (!covered && (typeof reason !== "string" || reason.trim() === "")) {
    fail(`${path}: no covering check and allowlistReason is empty`);
  }
  if (covered && typeof reason === "string" && reason.trim() !== "") {
    fail(`${path}: choose coveredBy or allowlistReason, not both`);
  }
}
for (const path of inventory) if (!(path in manifest.files)) fail(`${path}: new claim-bearing file is neither covered nor allowlisted`);

console.log(`claim-bearing inventory: ${inventory.length} files`);
for (const path of inventory) {
  const entry = manifest.files[path];
  const status = entry?.coveredBy?.length ? `COVERED by ${entry.coveredBy.join(", ")}` : `ALLOWLISTED: ${entry?.allowlistReason ?? "<missing>"}`;
  console.log(`${path}\t${status}`);
}
checkMandatoryBindings();
process.exit(bad ? 1 : 0);
