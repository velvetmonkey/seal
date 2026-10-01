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
    sha256: "eeb456516dde2ae18c5a78a19ff28752958f7c96bd6752917a768a49cb10017a",
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

function refusalKeys(sources = runtimeFiles.map((file) => ({ file, source: read(file) }))) {
  const found = new Map();
  const add = (key, file, source, offset) => {
    if (!/^[a-z]+(?:_[a-z0-9]+)*$/.test(key)) return;
    const line = source.slice(0, offset).split("\n").length;
    if (!found.has(key)) found.set(key, `${file}:${line}`);
  };
  for (const { file, source } of sources) {
    const patterns = [
      /\b(?:new\s+(?:ProtectionError|ReceiptRefusal)|ownershipRefusal|fail|refuse)\(\s*["']([a-z][a-z0-9_]*)["']/g,
      /\b(?:refusal|code)\s*:\s*["']([a-z][a-z0-9_]*)["']/g,
      /\.code\s*=\s*["']([a-z][a-z0-9_]*)["']/g,
      /REFUSE\s+([a-z][a-z0-9_]*):/g,
      /\b(?:readinessFailure|v\.fail|blockForward)\(\s*["']([a-z][a-z0-9_]*)["']/g,
    ];
    for (const pattern of patterns) for (const match of source.matchAll(pattern)) add(match[1], file, source, match.index);
    for (const assignment of source.matchAll(/\.code\s*=(?!=)\s*([^;\n]*\?[^;\n]+)/g)) {
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
});

test("a renamed literal refusal becomes undocumented", () => {
  const file = "spine/protection.cjs";
  const source = read(file).replace('new ProtectionError("project_server_absent"', 'new ProtectionError("renamed_row4_refusal"');
  assert.ok(source.includes('new ProtectionError("renamed_row4_refusal"'), "rename probe missed its source site");
  const renamed = refusalKeys([{ file, source }]);
  assert.ok(renamed.has("renamed_row4_refusal"));
  assert.ok(!documentedKeys().has("renamed_row4_refusal"));
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
