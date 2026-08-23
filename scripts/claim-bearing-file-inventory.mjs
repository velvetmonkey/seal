#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Fail-closed inventory for human-facing statements about Seal.
// Run: node scripts/claim-bearing-file-inventory.mjs // CLAIM-COVERAGE: scripts/claim-bearing-file-inventory.mjs
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MANIFEST = "scripts/claim-bearing-files.json";
// Ben's first narrow slice. Add a path here to widen the mandatory prose gate.
const MANDATORY_DOC_FILES = ["README.md", "docs/guide/knowing-it-worked.md"];
const MANDATORY_BINDINGS = "scripts/mandatory-doc-claim-bindings.json";
const REQUIRED_MANDATORY_CLAIMS = {
  "README.md": "Seal is a proxy that intercepts one MCP tool call, asks you to approve it, and refuses to replay it without a new approval.",
  "docs/guide/knowing-it-worked.md": "Seal makes the approved call and the executed call the same call: same tool,",
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
function carriesClaim(text) {
  // A code-shaped text file contributes only its human-language comments and
  // sentence-like string literals.  This is syntax-shaped rather than
  // extension-shaped: a .js claim is seen, while identifiers such as
  // sealReceipt() do not turn executable implementation into prose inventory.
  const codeShaped = /^\s*(?:#!|import\s|export\s|(?:const|let|var|function|class)\s|["'](?:files|name)["']\s*:)/m.test(text);
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
  const match = /^(.*):(\d+)$/.exec(reference);
  if (!match || !match[1] || Number(match[2]) < 1) return null;
  return { path: match[1], line: Number(match[2]) };
}
function referenceProvesFile(reference, claimFile, tracked) {
  const parsed = parseReference(reference);
  if (!parsed) return "must be path:line";
  if (!tracked.has(parsed.path)) return `references untracked proof file ${parsed.path}`;
  let proof;
  try { proof = readText(parsed.path); }
  catch (error) { return `cannot read proof file ${parsed.path}: ${error.message}`; }
  if (proof === null) return `proof file ${parsed.path} is binary`;
  const line = proof.split(/\r?\n/)[parsed.line - 1];
  if (line === undefined) return `references missing line ${parsed.line} in ${parsed.path}`;
  // A citation is evidence only when the cited executable assertion explicitly
  // binds itself to the claimed file.  Shape-only path:line references are not
  // coverage; this marker is checked at the cited line, not merely elsewhere.
  if (!line.includes(`CLAIM-COVERAGE: ${claimFile}`)) {
    return `line ${parsed.line} in ${parsed.path} does not bind CLAIM-COVERAGE: ${claimFile}`;
  }
  return null;
}

function mandatoryClaimUnits(file) {
  const text = readText(file);
  if (text === null) return [];
  // The mandatory slice is deliberately sentence-shaped: only reader-facing
  // sentences beginning with Seal (or its command) are claims here. Fenced
  // transcripts, URLs, headings and incidental references are not silently
  // promoted into the mandatory population.
  return text.split(/\r?\n/).flatMap((line) => line.split(/(?<=[.!?])\s+/))
    .map((unit) => unit.replace(/^\s*(?:[-*]\s+)?(?:\*\*)?/, "").replace(/(?:\*\*)?\s*$/, "").trim())
    .filter((unit) => Object.values(REQUIRED_MANDATORY_CLAIMS).includes(unit)
      || /\bSeal\s+proves?\b/i.test(unit)
      || /\bSeal\s+guarantees?\b/i.test(unit)
      || /\bSeal\s+has\s+made\s+every\b/i.test(unit));
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
    if (!tracked.has(file)) continue;
    const entry = manifest.files[file];
    if (!entry?.coveredBy?.length || entry.allowlistReason) fail(`${file}: mandatory document cannot use allowlist/debt coverage`);
    const fileBindings = bindings.files[file];
    if (!Array.isArray(fileBindings) || fileBindings.length === 0) { fail(`${file}: mandatory claim binding list is empty`); continue; }
    const bySentence = new Map(fileBindings.map((binding) => [binding.sentence, binding.proof]));
    if (!bySentence.has(REQUIRED_MANDATORY_CLAIMS[file])) fail(`${file}: required binding missing: ${REQUIRED_MANDATORY_CLAIMS[file]}`);
    for (const sentence of mandatoryClaimUnits(file)) {
      const proof = bySentence.get(sentence);
      if (!proof) { fail(`${file}: unbound claim sentence: ${sentence}`); continue; }
      const problem = referenceProvesFile(proof, file, tracked);
      if (problem) fail(`${file}: binding for sentence ${JSON.stringify(sentence)} ${JSON.stringify(proof)} ${problem}`);
    }
    for (const binding of fileBindings) if (typeof binding?.sentence !== "string" || typeof binding?.proof !== "string") fail(`${file}: binding must contain sentence and proof`);
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
  if (path === "scripts/claim-bearing-file-inventory.mjs") continue;
  const excluded = excludedBinaryReason(path);
  if (excluded) continue;
  let text;
  try { text = readText(path); }
  catch (error) { fail(`${path}: cannot read text: ${error.message}`); continue; }
  if (text === null) { fail(`${path}: text kind is unclassified (contains NUL bytes; add a bounded binary exclusion with a reason if appropriate)`); continue; }
  if (carriesClaim(text)) inventory.push(path);
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
