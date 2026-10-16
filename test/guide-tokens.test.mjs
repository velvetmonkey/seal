// SPDX-License-Identifier: Apache-2.0
// The original operating-guide gate checks its configured refusal sources and
// level-three headings. The row-4 contract below checks further runtime keys.
//
// For this original population, both directions are enforced against source.
// The original guide entries use headings of the form `### `token``.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";

const ROOT = resolve(import.meta.dirname, "..");
const GUIDE = process.env.SEAL_GUIDE_PATH ?? "docs/guide/when-something-looks-wrong.md";
const require = createRequire(import.meta.url);
const protection = require("../spine/protection.cjs");
const store = require("../spine/store.cjs");

// Where refusal tokens live and the shapes they are minted in. A new refusal
// site that follows any of these shapes is picked up automatically; a new
// shape must be added here (and the sentinel check below fails loudly if a
// whole file stops matching).
const SOURCES = [
  { file: "contract/contract.cjs", patterns: [/^\s+[A-Z_]+: "([a-z_]+)",/gm], sentinel: "already_consumed" },
  {
    file: "spine/protection.cjs",
    patterns: [
      /new ProtectionError\(\s*"([a-z_]+)"/g, /\bownershipRefusal\(\s*"([a-z_]+)"/g,
      /\bfail\("([a-z_]+)"/g,
      /\brefusal: "([a-z_]+)"/g,
      /\bcode: "([a-z_]+)"/g,
    ],
    sentinel: "drifted",
  },
  { file: "spine/uninstall.cjs", patterns: [/new ProtectionError\(\s*'([a-z_]+)'/g, /\brefuse\('([a-z_]+)'/g], sentinel: "installation_lock_active" },
  { file: "spine/proxy.cjs", patterns: [/"(protected_server_missing|protected_server_failed|forward_refused|method_not_allowed|key_case_fold_collision|case_variant_name|number_not_representable)"/g], sentinel: "forward_refused" },
  { file: "spine/platform.cjs", patterns: [/REFUSE ([a-z_]+):/g], sentinel: "unsupported_platform" },
  { file: "spine/integrity.cjs", patterns: [/\.code = "([a-z_]+)"/g, /\bcode: "([a-z_]+)"/g], sentinel: "artifact_truncated" },
  { file: "spine/version.cjs", patterns: [/error\.code = "([a-z_]+)"/g], sentinel: "version_mismatch" },
  { file: "scripts/install.cjs", patterns: [/refuse\("([a-z_]+)"/g, /REFUSE ([a-z_]+):/g], sentinel: "pin_missing" },
  { file: "scripts/seal-launch.cjs", patterns: [/refuse\("([a-z_]+)"/g, /REFUSE ([a-z_]+):/g], sentinel: "install_record_missing" },
  { file: "scripts/build-dist.cjs", patterns: [/REFUSE ([a-z_]+):/g], sentinel: "node_missing" },
  { file: "scripts/macos-helper.cjs", patterns: [/REFUSE ([a-z_]+):/g], sentinel: "macos_helper_architecture" },
  { file: "checker/seal-receipt-v2.mjs", patterns: [/fail\([^,]+, "([a-z_]+)"\)/g, /REFUSE ([a-z_]+):/g], sentinel: "signature_mismatch" },
];

function sourceTokens() {
  const tokens = new Set();
  for (const { file, patterns, sentinel } of SOURCES) {
    const text = readFileSync(resolve(ROOT, file), "utf8");
    const found = new Set();
    for (const pattern of patterns) {
      for (const match of text.matchAll(pattern)) found.add(match[1]);
    }
    assert.ok(
      found.has(sentinel),
      `${file}: expected to extract "${sentinel}" but got [${[...found].join(", ")}] — ` +
        "either the refusal site moved (update SOURCES) or the token was removed (update the guide)",
    );
    for (const token of found) tokens.add(token);
  }
  return tokens;
}

function guideTokens() {
  const text = readFileSync(resolve(ROOT, GUIDE), "utf8");
  const occurrences = new Map();
  for (const match of text.matchAll(/^### `([a-z_]+)`/gm)) {
    const line = text.slice(0, match.index).split("\n").length;
    const locations = occurrences.get(match[1]) || [];
    locations.push(`line ${line}`);
    occurrences.set(match[1], locations);
  }
  const duplicates = [...occurrences]
    .filter(([, locations]) => locations.length > 1)
    .map(([token, locations]) => `### \`${token}\` (${locations.join(", ")})`);
  assert.deepEqual(
    duplicates,
    [],
    `${GUIDE}: refusal headings appear more than once:\n${duplicates.join("\n")}`,
  );
  return new Set(occurrences.keys());
}

function processWitnessUnavailableBlock() {
  const text = readFileSync(resolve(ROOT, GUIDE), "utf8");
  const heading = "### `process_witness_unavailable`";
  const start = text.indexOf(heading);
  assert.notEqual(start, -1, `${GUIDE}: process_witness_unavailable heading is absent`);
  const end = text.indexOf("\n### ", start + heading.length);
  return text.slice(start, end === -1 ? text.length : end);
}

test("each process witness situation has a distinct message", () => {
  const previousPlatform = process.env.SEAL_SPINE_PLATFORM;
  const previousArch = process.env.SEAL_SPINE_ARCH;
  process.env.SEAL_SPINE_PLATFORM = "unsupported";
  process.env.SEAL_SPINE_ARCH = "x64";
  const probes = [
    ["stored lease owner", () => protection.lockOwnerIsLive({ pid: process.pid, startWitness: "unavailable" }, "stored lease owner")],
    ["project-lock owner", () => protection.lockOwnerIsLive({ pid: process.pid, startWitness: "unavailable" }, "project-lock owner")],
    ["approval-journal-lock owner", () => {
      const journal = `${process.cwd()}/.guide-message-test-journal`;
      store.createJournal(journal);
      try { return store.openJournal(journal).withLock(() => undefined); }
      finally { try { require("node:fs").unlinkSync(journal); } catch {} }
    }],
    ["Seal's own witness at project-lock acquire", () => protection.acquireProjectLock(process.cwd(), { XDG_DATA_HOME: process.cwd() })],
  ];
  try {
    const messages = [];
    for (const [situation, probe] of probes) {
      try {
        probe();
        assert.fail(`${situation}: probe returned instead of refusing`);
      } catch (error) {
        assert.equal(error.code, "process_witness_unavailable", error.stack || error.message);
        messages.push(error.message);
      }
    }
    assert.equal(new Set(messages).size, probes.length, messages.join("\n"));
  } finally {
    if (previousPlatform === undefined) delete process.env.SEAL_SPINE_PLATFORM;
    else process.env.SEAL_SPINE_PLATFORM = previousPlatform;
    if (previousArch === undefined) delete process.env.SEAL_SPINE_ARCH;
    else process.env.SEAL_SPINE_ARCH = previousArch;
  }
});

test("every refusal token in the source is documented in the guide", () => {
  const inSource = sourceTokens();
  const inGuide = guideTokens();
  const undocumented = [...inSource].filter((token) => !inGuide.has(token)).sort();
  assert.deepEqual(
    undocumented,
    [],
    `refusal tokens the product can emit but ${GUIDE} does not document:\n${undocumented.join("\n")}`,
  );
});

test("every refusal token the guide documents exists in the source", () => {
  const inSource = sourceTokens();
  const inGuide = guideTokens();
  const phantom = [...inGuide].filter((token) => !inSource.has(token)).sort();
  assert.deepEqual(
    phantom,
    [],
    `refusal tokens ${GUIDE} documents that no source file mints:\n${phantom.join("\n")}`,
  );
});

// The claim check requires a nonempty inventory for each guide and each listed
// claim exactly once after whitespace normalization.
// For what-is-protected-right-now.md, the whole-file digest binds first: any
// byte change fails, including whitespace-only edits and added sentences, before
// claim whitespace normalization can run on the changed file.
// when-something-looks-wrong.md has no digest: a new sentence beside a reviewed
// claim is not checked here; its refusal-token inventory is checked above.
// Neither claim retention nor byte identity certifies that either guide is true.
const REVIEWED_GUIDES = [
  {
    file: "docs/guide/when-something-looks-wrong.md", // CLAIM-COVERAGE: docs/guide/when-something-looks-wrong.md#looks-wrong
    claims: [
      "Receipt refusals use the same tokens whether you invoke the installed `seal verify` command or the standalone v2 checker.",
      "The producer, command, and checker all use `seal.receipt/v2`; there is no second receipt format to select.",
    ],
  },
  {
    file: "docs/guide/what-is-protected-right-now.md", // CLAIM-COVERAGE: docs/guide/what-is-protected-right-now.md#protected-now
    sha256: "82650a471e10cccf4aadd6a6ea0fe70519cb4c7efd4dcb042968ceb6e5ba9210",
    claims: [
      "Producer output and the kernel replay path now share the one `seal.receipt/v2` envelope.",
      "`seal status` reads its `action`, kernel `verdict`, and exact kernel `now`; `seal verify` validates and replays that same file.",
    ],
  },
];

function sha256(text) {
  return createHash("sha256").update(text).digest("hex");
}

function occurrences(text, claim) {
  return text.replace(/\s+/g, " ").split(claim).length - 1;
}

function assertPinned(entry, text) {
  assert.ok(entry.claims.length > 0, `${entry.file}: reviewed claim inventory must not be empty`);
  assert.equal(
    sha256(text),
    entry.sha256,
    `${entry.file}: content changed; this pin cannot check truth. Re-pin its sha256 only after a human confirms the new text is TRUE.`,
  );
}

test("reviewed guide files retain each reviewed claim once", () => {
  assert.ok(REVIEWED_GUIDES.length > 0, "REVIEWED_GUIDES must not be empty");
  for (const entry of REVIEWED_GUIDES) {
    const text = readFileSync(resolve(ROOT, entry.file), "utf8");
    if (entry.sha256) assertPinned(entry, text);
    else assert.ok(entry.claims.length > 0, `${entry.file}: reviewed claim inventory must not be empty`);
    for (const claim of entry.claims) {
      assert.equal(occurrences(text, claim), 1, `${entry.file}: reviewed claim must appear exactly once: ${claim}`);
    }
  }
});

// Seal 1.0 row 4: source-derived refusal, exit and receipt-document coverage.
{
// The 1.0 refusal and exit population is derived from runtime source, not a list of expected keys.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = resolve(import.meta.dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const guide = read("docs/guide/when-something-looks-wrong.md");
const cli = read("docs/reference/cli.md");
const runtimeFiles = ["contract/contract.cjs", "bin/seal",
  ...fs.readdirSync(path.join(root, "spine")).filter((name) => name.endsWith(".cjs")).map((name) => `spine/${name}`),
  "checker/seal-receipt-v2.mjs", ...["install.cjs", "seal-launch.cjs", "build-dist.cjs", "macos-helper.cjs", "bootstrap-install.cjs"].map((name) => `scripts/${name}`)];

// These assignments take a parameter or a computed value. Their literal callers
// and fallback keys are covered by the existing source patterns below.
const variableCodeRoster = Object.freeze({
  "checker/seal-receipt-v2.mjs:fail:code": "fail parameter; fail calls with literal keys are scanned",
  "spine/protection.cjs:ProtectionError:code": "ProtectionError constructor parameter; new ProtectionError literal calls are scanned",
  "spine/proxy.cjs:finishGuarded:refusal": "two refusal bindings and a decision.refusal property arm; contract refusal constants are scanned",
  "spine/receipt-v2.cjs:ReceiptRefusal:code": "ReceiptRefusal constructor parameter; new ReceiptRefusal literal calls are scanned",
  "spine/verify-server.cjs:verifyReceipt:result": "result.ok property ternary; its literal refusal arm is scanned",
  "spine/demo-grant.cjs:fail:code": "fail parameter; fail calls with literal keys are scanned",
});

const identifierPattern = "[A-Za-z_$][\\w$]*";
const codeProperty = String.raw`(?:\.code|\[\s*["']code["']\s*\])`;
const assignmentOperator = String.raw`(?:\?\?=|\|\|=|=(?!=|>))`;
const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function literalArms(value) {
  const leaves = [];
  const visit = (expression) => {
    const text = expression.trim();
    const literal = text.match(/^["']([a-z][a-z0-9_]*)["']$/);
    if (literal) { leaves.push(literal[1]); return true; }
    let depth = 0;
    let quote = "";
    let question = -1;
    let colon = -1;
    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      if (quote) { if (char === "\\") i++; else if (char === quote) quote = ""; continue; }
      if (char === '"' || char === "'") { quote = char; continue; }
      if (char === "?") { if (text[i + 1] === "?" || text[i - 1] === "?" || text[i + 1] === ".") continue; depth++; if (question < 0) question = i; }
      if (char === ":" && depth) { depth--; if (depth === 0 && colon < 0) colon = i; }
    }
    if (question < 0 || colon < 0) return false;
    return visit(text.slice(question + 1, colon)) & visit(text.slice(colon + 1)) ? true : false;
  };
  return { keys: leaves, complete: visit(value) };
}

function enclosingName(source, offset) {
  const before = source.slice(0, offset);
  const names = [
    ...before.matchAll(/\bclass\s+([A-Za-z_$][\w$]*)/g),
    ...before.matchAll(/\bfunction\s+([A-Za-z_$][\w$]*)\s*\(/g),
    ...before.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/g),
  ];
  return names.sort((a, b) => a.index - b.index).at(-1)?.[1] ?? "<top-level>";
}

function bindingCount(source, identifier) {
  const name = escapeRegExp(identifier);
  const declarations = [...source.matchAll(new RegExp(`\\b(?:const|let|var)\\s+${name}(?=\\s*[=,;])`, "g"))].length;
  const parameters = [...source.matchAll(/\b(?:function\s+[\w$]+|constructor|catch)\s*\(([^)]*)\)|\b(?:const|let|var)\s+[\w$]+\s*=\s*(?:\(([^)]*)\)|([\w$]+))\s*=>/g)]
    .filter((match) => new RegExp(`(?:^|[,\\s{])${name}(?=\\s*(?:[,}=]|$))`).test(match[1] ?? match[2] ?? match[3])).length;
  const destructured = [...source.matchAll(/\b(?:const|let|var)\s*[{[]([^}\]]+)[}\]]\s*=/g)]
    .filter((match) => new RegExp(`(?:^|[,\\s])${name}(?=\\s*(?:[,}:=]|$))`).test(match[1])).length;
  return declarations + parameters + destructured;
}

function variableCodeSites(file, source) {
  const sites = [];
  const matches = [...source.matchAll(new RegExp(`${codeProperty}\\s*${assignmentOperator}\\s*(${identifierPattern})(?![\\w$])`, "g"))]
    .map((match) => ({ identifier: match[1], offset: match.index }));
  for (const match of source.matchAll(/Object\.assign\([^;\n]*?\{([^}\n]*)\}/g)) {
    for (const property of match[1].matchAll(/(?:^|,)\s*code\s*(?::\s*([A-Za-z_$][\w$]*)\b|(?=\s*(?:,|$)))/g)) {
      matches.push({ identifier: property[1] ?? "code", offset: match.index + match[0].indexOf("{") + 1 + property.index });
    }
  }
  for (const { identifier, offset } of matches.sort((a, b) => a.offset - b.offset)) {
    const escaped = escapeRegExp(identifier);
    const values = [...source.matchAll(new RegExp(`\\b(?:const|let|var)\\s+${escaped}\\s*=\\s*([^;]+)`, "g"))].map((match) => match[1]);
    for (const assignment of source.matchAll(new RegExp(`(?<![\\w$.])${escaped}\\s*${assignmentOperator}\\s*([^;]+)`, "g"))) values.push(assignment[1]);
    const parsed = values.map(literalArms);
    const keys = [...new Set(parsed.flatMap((value) => value.keys))];
    const resolved = bindingCount(source, identifier) === 1 && parsed.length > 0 && parsed.every((value) => value.complete);
    sites.push({ file, identifier, enclosing: enclosingName(source, offset), line: source.slice(0, offset).split("\n").length, offset,
      keys, resolved });
  }
  return sites;
}

function censusUnrostered(sources) {
  const sites = sources.flatMap(({ file, source }) => variableCodeSites(file, source));
  const unresolved = sites.filter((site) => !site.resolved);
  const siteName = (site) => `${site.file}:${site.enclosing}:${site.identifier}`;
  const counts = new Map();
  for (const site of unresolved) counts.set(siteName(site), (counts.get(siteName(site)) ?? 0) + 1);
  return unresolved.filter((site) => !Object.hasOwn(variableCodeRoster, siteName(site)) || counts.get(siteName(site)) !== 1);
}

function refusalKeys(sources = runtimeFiles.map((file) => ({ file, source: read(file) }))) {
  const found = new Map();
  const add = (key, file, source, offset) => {
    if (!/^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/.test(key)) return;
    const line = source.slice(0, offset).split("\n").length;
    if (!found.has(key)) found.set(key, `${file}:${line}`);
  };
  for (const { file, source } of sources) {
    for (const site of variableCodeSites(file, source)) {
      for (const key of site.keys) add(key, file, source, site.offset);
    }
    const patterns = [
      /\b(?:new\s+(?:ProtectionError|ReceiptRefusal)|ownershipRefusal|fail|refuse)\(\s*["']([a-z][a-z0-9_]*)["']/g,
      /\b(?:refusal|code)\s*:\s*["']([a-z][a-z0-9_]*)["']/g,
      new RegExp(`${codeProperty}\\s*${assignmentOperator}\\s*["']([a-z][a-z0-9_]*)["']`, "g"),
      /REFUSE\s+([a-z][a-z0-9_]*):/g,
      /\b(?:readinessFailure|v\.fail|blockForward)\(\s*["']([a-z][a-z0-9_]*)["']/g,
    ];
    for (const pattern of patterns) for (const match of source.matchAll(pattern)) add(match[1], file, source, match.index);
    for (const assignment of source.matchAll(new RegExp(`${codeProperty}\\s*${assignmentOperator}\\s*([^;\\n]*\\?[^;\\n]+)`, "g"))) {
      for (const arm of assignment[1].matchAll(/[?:]\s*["']([a-z][a-z0-9_]*)["']/g)) {
        add(arm[1], file, source, assignment.index + arm.index);
      }
    }
    // Named refusal constants feed constructors, returned codes and proxy errors.
    if (["contract/contract.cjs", "spine/protection.cjs"].includes(file)) {
      for (const block of source.matchAll(/const\s+(?:REFUSALS|RECEIPT_KEY_CODES)\s*=\s*Object\.freeze\(\{([\s\S]*?)\}\)/g)) {
        for (const match of block[1].matchAll(/:\s*["']([a-z][a-z0-9_]*)["']/g)) add(match[1], file, source, block.index + match.index);
      }
    }
    if (file === "spine/proxy.cjs") {
      for (const match of source.matchAll(/const\s+[A-Z][A-Z_]+\s*=\s*"([a-z][a-z0-9_]*)"/g)) add(match[1], file, source, match.index);
    }
    if (file === "spine/demo-grant-server.cjs" || file === "spine/demo-grant.cjs") {
      for (const match of source.matchAll(/\bpoison\s*=\s*'([a-z][a-z0-9_]*)'/g)) add(match[1], file, source, match.index);
      for (const match of source.matchAll(/\bv\.fail\([^\n]*?\?\s*'([a-z][a-z0-9_]*)'\s*:\s*'([a-z][a-z0-9_]*)'/g)) {
        add(match[1], file, source, match.index); add(match[2], file, source, match.index);
      }
      for (const match of source.matchAll(/\b(?:v\.)?parse\([^\n]*?,\s*'([a-z][a-z0-9_]*)'\)/g)) add(match[1], file, source, match.index);
    }
    if (file === "spine/verify-server.cjs") {
      for (const fallback of source.matchAll(/code:\s*error\.code\s*\|\|\s*\(([^\n]+)\)/g)) {
        for (const match of fallback[1].matchAll(/[?:]\s*"([a-z][a-z0-9_]*)"/g)) add(match[1], file, source, fallback.index + match.index);
      }
    }
    if (file === "checker/seal-receipt-v2.mjs") {
      for (const match of source.matchAll(/\bfail\([^,]+,\s*"([a-z][a-z0-9_]*)"\)/g)) add(match[1], file, source, match.index);
    }
    if (file === "spine/proxy.cjs") {
      for (const expression of source.matchAll(/(?:childSpawnError\s*=|blockForward\(frame,\s*check\.refusal\s*\|\|)([^\n]+?);/g)) {
        for (const match of expression[1].matchAll(/"([a-z][a-z0-9_]*)"/g)) add(match[1], file, source, expression.index + match.index);
      }
    }
  }
  return found;
}

function documentedKeys() {
  const found = new Set();
  for (const match of guide.matchAll(/^#{3,4} (.+)$/gm)) {
    for (const token of match[1].matchAll(/`([a-z][a-z0-9_]*)`/g)) found.add(token[1]);
  }
  return found;
}

function exitCodes(source = read("bin/seal")) {
  const files = [source, read("checker/seal-receipt-v2.mjs"), read("spine/verify-server.cjs"), read("spine/platform.cjs")];
  const found = new Set();
  for (const text of files) {
    for (const match of text.matchAll(/\b(?:process\.exitCode\s*=|process\.exit\(|\bexitCode\s*[:=]|\bemit\()\s*(\d+)\b/g)) found.add(Number(match[1]));
    for (const match of text.matchAll(/\b(?:emit\(|exitCode\s*=)[^\n]*?\?\s*(\d+)\s*:\s*(\d+)\b/g)) {
      found.add(Number(match[1])); found.add(Number(match[2]));
    }
  }
  assert.ok(found.size, "no exit codes extracted from entrypoints");
  return found;
}

test("runtime refusal keys all have operating guide entries", () => {
  const source = refusalKeys();
  assert.ok(source.size, "no refusal keys extracted from runtime source");
  const documented = documentedKeys();
  const missing = [...source].filter(([key]) => !documented.has(key)).map(([key, place]) => `${key} (${place})`).sort();
  assert.deepEqual(missing, [], `${source.size} source refusal keys; missing guide entries:\n${missing.join("\n")}`);
  const stale = [...documented].filter((key) => !source.has(key)).sort();
  assert.deepEqual(stale, [], `guide refusal entries absent from runtime source:\n${stale.join("\n")}`);
});

test("a renamed literal refusal becomes undocumented", () => {
  const file = "spine/protection.cjs";
  const source = read(file).replace('new ProtectionError("project_server_absent"', 'new ProtectionError("renamed_row4_refusal"');
  assert.ok(source.includes('new ProtectionError("renamed_row4_refusal"'), "rename probe missed its source site");
  const renamed = refusalKeys([{ file, source }]);
  assert.ok(renamed.has("renamed_row4_refusal"));
  assert.ok(!documentedKeys().has("renamed_row4_refusal"));
});

test("every variable code assignment resolves or is on the roster", () => {
  const sites = runtimeFiles.flatMap((file) => variableCodeSites(file, read(file)));
  const unresolved = sites.filter((site) => !site.resolved);
  const siteName = (site) => `${site.file}:${site.enclosing}:${site.identifier}`;
  const unrostered = censusUnrostered(runtimeFiles.map((file) => ({ file, source: read(file) })));
  assert.deepEqual(unrostered.map((site) => `${site.file}:${site.line} (${site.enclosing}:${site.identifier})`), [],
    "variable .code sites without literal keys or roster reasons");
  const current = new Set(unresolved.map(siteName));
  const stale = Object.keys(variableCodeRoster).filter((entry) => !current.has(entry));
  assert.deepEqual(stale, [], "roster entries without unresolved .code sites");
  assert.ok(Object.values(variableCodeRoster).every((reason) => reason.trim()), "every roster entry needs a reason");
  assert.ok(sites.find((site) => site.file === "spine/proxy.cjs" && site.identifier === "refusal")?.keys.includes("already_consumed"),
    "multi-line refusal ternary must retain its literal arm");
  const callers = new Set(["ProtectionError", "ReceiptRefusal", "ownershipRefusal", "fail", "refuse"]);
  const parameterSites = unresolved.filter((site) => new RegExp(`(?:constructor|function\\s+${escapeRegExp(site.enclosing)})\\s*\\([^)]*\\b${escapeRegExp(site.identifier)}\\b|\\b${escapeRegExp(site.enclosing)}\\s*=\\s*(?:\\([^)]*\\b${escapeRegExp(site.identifier)}\\b|${escapeRegExp(site.identifier)}\\s*=>)`).test(read(site.file)));
  assert.deepEqual(parameterSites.filter((site) => !callers.has(site.enclosing)).map(siteName), [], "parameter sites need a scanned literal caller");
});

test("a variable-held refusal becomes undocumented", () => {
  const file = "spine/proxy.cjs";
  const source = read(file).replace("error.code = refusal;",
    'const heldKey = "variable_held_probe"; error.code = heldKey; '
    + 'let heldPair = true ? "variable_held_left" : "variable_held_right"; '
    + 'error.code = heldPair; error.code = refusal;');
  assert.ok(source.includes('error.code = heldKey;'), "variable probe missed its source site");
  const held = refusalKeys([{ file, source }]);
  assert.ok(held.has("variable_held_probe"));
  assert.ok(held.has("variable_held_left"));
  assert.ok(held.has("variable_held_right"));
  assert.ok(!documentedKeys().has("variable_held_probe"));
  assert.ok(!documentedKeys().has("variable_held_left"));
  assert.ok(!documentedKeys().has("variable_held_right"));
});

function plantedProxy(replacement) {
  const file = "spine/proxy.cjs";
  const source = read(file).replace("error.code = refusal;", `${replacement} error.code = refusal;`);
  assert.ok(source.includes(replacement), "variable form probe missed its source site");
  return { file, source };
}

function assertPlantedKey(replacement, key) {
  const planted = plantedProxy(replacement);
  const found = refusalKeys([planted]);
  assert.ok(found.has(key), `${key} was absent from refusalKeys`);
  assert.ok(!documentedKeys().has(key), `${key} has an unexpected guide entry`);
}

test("a reassigned variable refusal becomes undocumented", () => {
  assertPlantedKey('let heldMut = "cancelled"; heldMut = "variable_held_mut"; error.code = heldMut;', "variable_held_mut");
});

test("a nested ternary variable refusal becomes undocumented", () => {
  assertPlantedKey('const heldNest = a ? "variable_held_nest" : b ? "cancelled" : "expired"; error.code = heldNest;', "variable_held_nest");
});

test("a second code site in a rostered file is not covered by its roster entry", () => {
  const file = "spine/receipt-v2.cjs";
  const source = read(file) + '\nclass OtherRefusal extends Error { constructor(code) { super(code); this.code = code; } }\nvoid new OtherRefusal("variable_held_class");\n';
  const second = censusUnrostered([{ file, source }]).find((site) => site.enclosing === "OtherRefusal" && site.identifier === "code");
  assert.ok(second, "second class site was not found");
  assert.ok(!second.resolved, "second class parameter must remain unresolved");
  assert.ok(!Object.hasOwn(variableCodeRoster, `${second.file}:${second.enclosing}:${second.identifier}`), "first class roster entry covered the second class");
});

test("an out-of-scope declaration does not resolve a parameter", () => {
  const planted = plantedProxy('function heldA() { const heldScope = "cancelled"; } function heldB(heldScope) { const error = new Error("x"); error.code = heldScope; } heldB("variable_held_scope");');
  const site = censusUnrostered([planted]).find((entry) => entry.identifier === "heldScope");
  assert.ok(site, "parameter site was not found");
  assert.ok(!site.resolved, "two bindings must not resolve as one");
  assert.ok(!Object.hasOwn(variableCodeRoster, `${site.file}:${site.enclosing}:${site.identifier}`), "parameter site must require its own roster entry");
});

test("a nullish code assignment refusal becomes undocumented", () => {
  assertPlantedKey('const heldNull = "variable_held_nullish"; error.code ??= heldNull;', "variable_held_nullish");
});

test("a bracket code assignment refusal becomes undocumented", () => {
  assertPlantedKey('const heldBracket = "variable_held_bracket"; error["code"] = heldBracket;', "variable_held_bracket");
});

test("an Object.assign code refusal becomes undocumented", () => {
  assertPlantedKey('const heldAssign = "variable_held_assign"; Object.assign(error, { code: heldAssign });', "variable_held_assign");
});

test("entrypoint exit codes all have CLI reference entries", () => {
  const documented = new Set();
  for (const line of cli.split("\n")) {
    if (!line.startsWith("| `seal")) continue;
    const column = line.split("|").at(-2);
    for (const match of column.matchAll(/\b\d+\b/g)) documented.add(Number(match[0]));
  }
  const missing = [...exitCodes()].filter((code) => !documented.has(code)).sort((a, b) => a - b);
  assert.deepEqual(missing, [], `source exit codes absent from CLI reference: ${missing.join(", ")}`);
  const stale = [...documented].filter((code) => !exitCodes().has(code)).sort((a, b) => a - b);
  assert.deepEqual(stale, [], `CLI reference exit codes absent from entrypoints: ${stale.join(", ")}`);
});

test("the receipt operations vector's fields appear in the normative receipt schema", () => {
  const vector = JSON.parse(read("docs/reference/receipt-operations-v1/receipt-block.json"));
  const schema = read("docs/SEAL-RECEIPT-V2.md");
  const envelope = schema.match(/```json\n([\s\S]*?)\n```/);
  assert.ok(envelope, "normative receipt schema JSON block is absent");
  const documented = JSON.parse(envelope[1]);
  function checkFields(value, schema, prefix = "") {
    for (const field of Object.keys(value)) {
      assert.ok(Object.hasOwn(schema, field), `receipt field ${prefix}${field} is absent from normative schema`);
      if (value[field] && typeof value[field] === "object" && !Array.isArray(value[field]) &&
          schema[field] && typeof schema[field] === "object" && !Array.isArray(schema[field])) {
        checkFields(value[field], schema[field], `${prefix}${field}.`);
      }
    }
  }
  checkFields(vector, documented);
});

}
