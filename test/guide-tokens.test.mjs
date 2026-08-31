// SPDX-License-Identifier: Apache-2.0
// The operating guide's anti-rot gate: docs/guide/when-something-looks-wrong.md
// documents every refusal token the product can emit, and nothing else.
//
// Both directions are enforced against the SOURCE, not against a copy of the
// list: a token added to the code without a guide entry fails, and a token
// documented in the guide without a source of truth fails. The guide marks
// each documented token as a heading of the exact form `### `token``.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";

const ROOT = resolve(import.meta.dirname, "..");
const GUIDE = process.env.SEAL_GUIDE_PATH ?? "docs/guide/when-something-looks-wrong.md";
const GUIDE_SHA256 = "5c12db5aa6540676d2f3d76072b56ce52bde0c94a59c17e98747692fea5e4ac5";
const require = createRequire(import.meta.url);
const protection = require("../spine/protection.cjs");
const store = require("../spine/store.cjs");

// REVIEWED_GUIDE_CANONICALIZED_SLOTS: sync-version.cjs generates the one
// anchored release-version slot. This canonicalizer maps only that slot to a
// stable marker before hashing. GUIDE_SHA256 does not cover the generated
// version slot. The pin covers every other byte in the guide.
const VERSIONED_GUIDE = "docs/guide/when-something-looks-wrong.md";
const EXPECTED_RELEASE_VERSION = `v${readFileSync(resolve(ROOT, "VERSION"), "utf8").trim()}`;
const GENERATED_VERSION_SLOT = new RegExp("(?<=^Printed by the installer, the installed launcher, and the demo alike for Seal\\n)v0\\.2\\.0(?=\\.)", "gm");

function canonicalReviewedGuide(file, text) {
  if (file !== VERSIONED_GUIDE) return text;
  const matches = [...text.matchAll(GENERATED_VERSION_SLOT)];
  assert.equal(matches.length, 1, `${file}: expected exactly one generated release-version slot containing ${EXPECTED_RELEASE_VERSION}`);
  return text.replace(GENERATED_VERSION_SLOT, "v<generated-version>");
}

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
  { file: "spine/proxy.cjs", patterns: [/"(protected_server_missing|protected_server_failed|forward_refused)"/g], sentinel: "forward_refused" },
  { file: "spine/platform.cjs", patterns: [/REFUSE ([a-z_]+):/g], sentinel: "unsupported_platform" },
  { file: "spine/integrity.cjs", patterns: [/\.code = "([a-z_]+)"/g, /\bcode: "([a-z_]+)"/g], sentinel: "artifact_truncated" },
  { file: "spine/version.cjs", patterns: [/error\.code = "([a-z_]+)"/g], sentinel: "version_mismatch" },
  { file: "bin/seal", patterns: [/runtimeRefusal\("([a-z_]+)"/g], sentinel: "runtime_cache_unreadable" },
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
  const digest = createHash("sha256").update(canonicalReviewedGuide(GUIDE, text)).digest("hex");
  assert.equal(
    digest,
    GUIDE_SHA256,
    `${GUIDE}: content changed; this pin cannot check truth. Re-pin its sha256 only after a human confirms the new text is TRUE.`,
  );
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

function processWitnessUnavailableThrowSites() {
  const spine = resolve(ROOT, "spine");
  const sites = [];
  for (const entry of readdirSync(spine, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".cjs")) continue;
    const file = `spine/${entry.name}`;
    const source = readFileSync(resolve(ROOT, file), "utf8");
    for (const match of source.matchAll(/new ProtectionError\(\s*"process_witness_unavailable"/g)) {
      const prefix = source.slice(0, match.index);
      const functions = [...prefix.matchAll(/^function ([A-Za-z0-9_]+)\(/gm)];
      assert.ok(functions.length > 0, `${file}: token throw has no enclosing function`);
      sites.push({ file, functionName: functions.at(-1)[1] });
    }
  }
  return sites;
}

function processWitnessUnavailableBlock() {
  const text = readFileSync(resolve(ROOT, GUIDE), "utf8");
  const heading = "### `process_witness_unavailable`";
  const start = text.indexOf(heading);
  assert.notEqual(start, -1, `${GUIDE}: process_witness_unavailable heading is absent`);
  const end = text.indexOf("\n### ", start + heading.length);
  return text.slice(start, end === -1 ? text.length : end);
}

function spineFunctionNames() {
  const names = new Set();
  for (const file of ["spine/protection.cjs", "spine/store.cjs"]) {
    const source = readFileSync(resolve(ROOT, file), "utf8");
    for (const match of source.matchAll(/^function ([A-Za-z0-9_]+)\(/gm)) names.add(match[1]);
  }
  return names;
}

function stackPath(error, functionNames) {
  const frames = [];
  for (const match of String(error.stack || "").matchAll(/^\s+at (?:.*\.)?([A-Za-z0-9_]+) \(/gm)) {
    if (functionNames.has(match[1]) && !frames.includes(match[1])) frames.push(match[1]);
  }
  return frames;
}

async function processWitnessUnavailableCallPaths() {
  const previousPlatform = process.env.SEAL_SPINE_PLATFORM;
  const previousArch = process.env.SEAL_SPINE_ARCH;
  const root = mkdtempSync(join(tmpdir(), "seal-guide-call-paths-"));
  const project = join(root, "project");
  const home = join(root, "home");
  const dataHome = join(root, "data");
  mkdirSync(project);
  mkdirSync(home);
  const env = { HOME: home, XDG_DATA_HOME: dataHome };
  const statePath = join(dataHome, "state.json");
  mkdirSync(join(dataHome), { recursive: true });
  writeFileSync(statePath, JSON.stringify({
    schema: "seal.protect/v1",
    sealVersion: readFileSync(resolve(ROOT, "VERSION"), "utf8").trim(),
    projectRoot: project,
  }));
  process.env.SEAL_SPINE_PLATFORM = "unsupported";
  process.env.SEAL_SPINE_ARCH = "x64";
  const functionNames = spineFunctionNames();
  const throwFunctions = new Set(processWitnessUnavailableThrowSites().map(({ functionName }) => functionName));
  const probes = [
    () => protection.lockOwnerIsLive({ pid: process.pid, startWitness: "unavailable" }),
    () => protection.acquireProjectLock(project, env),
    () => {
      const journal = join(root, "approvals.journal");
      store.createJournal(journal);
      return store.openJournal(journal).withLock(() => undefined);
    },
    () => protection.activationLease(statePath, env),
  ];
  const paths = new Set();
  try {
    for (const probe of probes) {
      try {
        await probe();
        assert.fail("the witness-unavailable probe returned instead of refusing");
      } catch (error) {
        assert.equal(error.code, "process_witness_unavailable", error.stack || error.message);
        const path = stackPath(error, functionNames);
        assert.ok(path.length > 0, error.stack || error.message);
        const entrypoint = probe.toString().match(/protection\.(\w+)/)?.[1];
        if (entrypoint && !path.includes(entrypoint)) path.push(entrypoint);
        const throwIndex = path.findIndex((name) => throwFunctions.has(name));
        paths.add(path.slice(throwIndex + 1).join(" -> "));
      }
    }
    return [...paths];
  } finally {
    if (previousPlatform === undefined) delete process.env.SEAL_SPINE_PLATFORM;
    else process.env.SEAL_SPINE_PLATFORM = previousPlatform;
    if (previousArch === undefined) delete process.env.SEAL_SPINE_ARCH;
    else process.env.SEAL_SPINE_ARCH = previousArch;
    rmSync(root, { recursive: true, force: true });
  }
}

test("process witness guide block covers every source throw path", () => {
  const sites = processWitnessUnavailableThrowSites();
  assert.deepEqual(
    sites,
    [
      { file: "spine/protection.cjs", functionName: "requireProcessStartWitnessBinding" },
      { file: "spine/store.cjs", functionName: "withFileLock" },
    ],
    "process_witness_unavailable throw sites changed; add guide coverage for every source path",
  );

  const block = processWitnessUnavailableBlock();
  const requiredCoverage = new Map([
    ["spine/protection.cjs:requireProcessStartWitnessBinding", [/\bstored lease\b/i, /\bproject lock\b/i]],
    ["spine/store.cjs:withFileLock", [/\bapproval-journal lock\b/i, /\bany platform\b/i, /\bmacOS\b/i]],
  ]);
  for (const { file, functionName } of sites) {
    const path = `${file}:${functionName}`;
    for (const pattern of requiredCoverage.get(path) ?? []) {
      assert.match(block, pattern, `${GUIDE}: missing coverage for ${path}`);
    }
  }
  assert.match(
    block,
    /\bmacOS\s+x64\/arm64\b[\s\S]*?\bstored lease and project-lock path\b[\s\S]*?\bDarwin-specific refusal tokens\b/i,
    `${GUIDE}: Darwin-specific tokens apply to the stored lease and project-lock path`,
  );
  assert.doesNotMatch(
    block,
    /Darwin-specific refusal tokens\s+instead of\s+`process_witness_unavailable`/i,
    `${GUIDE}: Darwin-specific tokens do not replace the approval-journal lock refusal`,
  );
});

// Runtime stack sampling follows the exercised entrypoints and derives the
// path names from the observed frames. LIMIT: a dynamic or indirect call that
// these probes cannot follow is a path this check cannot see.
test("process witness guide block covers every runtime call path", async () => {
  const paths = await processWitnessUnavailableCallPaths();
  assert.equal(paths.length, 4, `expected four runtime call paths, found:\n${paths.join("\n")}`);
  const block = processWitnessUnavailableBlock();
  const anchors = new Set(paths.flatMap((path) => path.split(" -> ")
    .filter((name) => name && !/^requireProcessStartWitness/.test(name))));
  for (const anchor of anchors) {
    assert.match(block, new RegExp(`\\b${anchor}\\b`), `${GUIDE}: missing runtime call-path anchor ${anchor}`);
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

// These reviewed claims move from guide-claims.test.mjs. The token inventory
// alone does not retain their explanatory prose or protect the second guide.
const REVIEWED_GUIDES = [
  {
    file: "docs/guide/when-something-looks-wrong.md", // CLAIM-COVERAGE: docs/guide/when-something-looks-wrong.md#looks-wrong
    sha256: GUIDE_SHA256,
    claims: [
      "Receipt refusals use the same tokens whether you invoke the installed `seal verify` command or the standalone v2 checker.",
      "The producer, command, and checker all use `seal.receipt/v2`; there is no second receipt format to select.",
    ],
  },
  {
    file: "docs/guide/what-is-protected-right-now.md", // CLAIM-COVERAGE: docs/guide/what-is-protected-right-now.md#protected-now
    sha256: "86bf040fc6539dae6c6419a29169a767c29e5e6e5dc2f9118963bb702d0a0bd6",
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
    sha256(canonicalReviewedGuide(entry.file, text)),
    entry.sha256,
    `${entry.file}: content changed; this pin cannot check truth. Re-pin its sha256 only after a human confirms the new text is TRUE.`,
  );
}

test("reviewed guide files are content-addressed and retain each reviewed claim once", () => {
  assert.ok(REVIEWED_GUIDES.length > 0, "REVIEWED_GUIDES must not be empty");
  for (const entry of REVIEWED_GUIDES) {
    const text = readFileSync(resolve(ROOT, entry.file), "utf8");
    assertPinned(entry, text);
    for (const claim of entry.claims) {
      assert.equal(occurrences(text, claim), 1, `${entry.file}: reviewed claim must appear exactly once: ${claim}`);
    }
  }
});

test("whole-file pin rejects locator defeats and earlier claim tampering", () => {
  const entry = REVIEWED_GUIDES[0];
  const text = readFileSync(resolve(ROOT, entry.file), "utf8");
  const heading = "### `read_failed`";
  const falseClaim = "Nothing is wrong with the receipt.";
  const rejects = [
    ["whitespace real heading plus exact decoy", text.replace(heading, `###  \`read_failed\``) + `\n${heading}\n\n${entry.claims.join(" ")}\n${falseClaim}\n`],
    ["case-different heading", text.replace(heading, "### `Read_failed`")],
    ["backtick-different heading", text.replace(heading, "### read_failed")],
    ["deleted reviewed body", text.replace("Receipt refusals use the same tokens", "Receipt refusals use different tokens")],
    ["deleted reviewed sentence", text.replace("there is no second receipt format", "there is another receipt format")],
    ["changed macOS Protect support", text.replace(
      "macOS Protect execution is not exercised in CI.",
      "macOS Protect execution is exercised in CI.",
    )],
    ["novel assertion", `${text}\n${falseClaim}\n`],
    ["deleted heading", text.replace(heading, "")],
    ["renamed heading", text.replace(heading, "### `receipt_read_failed`")],
  ];
  for (const [name, tampered] of rejects) {
    assert.throws(() => assertPinned(entry, tampered), /content changed/, name);
  }
  assert.throws(() => assertPinned({ ...entry, claims: [] }, text), /inventory must not be empty/);
});
