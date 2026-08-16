#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
//
// The Claude Code evidence checker.
//
// A manual acceptance run is a claim until something can refuse it. This
// checker is that something. It takes an evidence pack written by
// `harness/claude-code/cc-harness.cjs` and either accepts it or names the
// reason it will not.
//
// What it establishes:
//   - the manifest names the EXACT artifact it is offered against;
//   - every file the manifest names is present and hashes to what was
//     recorded, and no unrecorded file has been added beside them;
//   - the eight required cases are all present, with their required
//     observations UNALTERED, and all observed;
//   - the child-call count and the effect digest the manifest reports are
//     RECOMPUTED here from the raw append-only child log, not believed;
//   - the pack's own summary label is the label its observations produce.
//
// What it does not establish: that Claude Code behaves this way in general,
// that any other version behaves this way, or that anything here ran in CI.
//
// The required-case list and the label rule below are this file's OWN copies,
// deliberately not imported from the harness: a checker that asks the thing it
// checks what the rules are is not a checker. A defect in a rule exists in both
// copies and this file cannot detect that — the same honest limit the shipped
// receipt checker carries.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const MANIFEST_SCHEMA = "seal.claude-code-evidence/v1";
const PLATFORM_DIRECTORY = "linux-x64";
const EVIDENCE_ROOT_NAME = "claude-code";
const SYNTHETIC_MARKER_FILE = "SYNTHETIC-NOT-A-REAL-RUN.txt";
const SYNTHETIC_BANNER = "SEAL-SYNTHETIC-FIXTURE";
const UNTESTED_LABEL = "Claude Code integration: UNTESTED — real Claude Code call not observed";
const REQUIRED_FILES = ["terminal.cast", "proxy.jsonl", "child.jsonl", "before-after.json", "snapshots.json"];

const REQUIRED_CASES = [
  { id: "activation", required: "After restart, Claude Code selects the local Seal override" },
  { id: "negotiation", required: "The proxy records the retry-model interaction" },
  { id: "approval_shown", required: "The terminal recording shows the complete exact-call dialog" },
  { id: "before_approval", required: "Child call count remains 0" },
  { id: "accept", required: "Child call count becomes exactly 1; expected effect hash matches" },
  { id: "decline", required: "Child call count remains 0" },
  { id: "missing_launcher", required: "Claude Code does not fall back to the original .mcp.json server" },
  { id: "unprotect", required: "The local override disappears and .mcp.json remains byte-identical" },
];

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

class Report {
  constructor(packDir) {
    this.packDir = packDir;
    this.refusals = [];
    this.checks = [];
  }

  refuse(code, message) {
    this.refusals.push({ code, message });
  }

  ok(message) {
    this.checks.push(message);
  }

  get accepted() {
    return this.refusals.length === 0;
  }
}

function readManifest(packDir, report) {
  const manifestPath = join(packDir, "manifest.json");
  let text;
  try {
    text = readFileSync(manifestPath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") report.refuse("manifest_absent", `${packDir} holds no manifest.json`);
    else report.refuse("manifest_unreadable", `${manifestPath} cannot be read: ${error.message}`);
    return null;
  }
  let manifest;
  try {
    manifest = JSON.parse(text);
  } catch (error) {
    report.refuse("manifest_malformed", `${manifestPath} is not valid JSON: ${error.message}`);
    return null;
  }
  if (!manifest || typeof manifest !== "object" || manifest.manifest !== MANIFEST_SCHEMA) {
    report.refuse("manifest_schema_unknown", `${manifestPath} declares schema ${JSON.stringify(manifest?.manifest)}, not ${MANIFEST_SCHEMA}`);
    return null;
  }
  for (const field of ["artifact", "client", "environment", "fixture", "expected_cases", "observed", "files", "label"]) {
    if (manifest[field] === undefined) {
      report.refuse("manifest_malformed", `${manifestPath} has no ${field}`);
      return null;
    }
  }
  return manifest;
}

function packFiles(packDir) {
  const found = [];
  const walk = (directory, prefix) => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        walk(join(directory, entry.name), relativePath);
        continue;
      }
      if (relativePath === "manifest.json") continue;
      found.push(relativePath);
    }
  };
  walk(packDir, "");
  return found;
}

function checkFiles(packDir, manifest, report) {
  if (!Array.isArray(manifest.files)) {
    report.refuse("manifest_malformed", "manifest.files is not a list");
    return;
  }
  const onDisk = new Set(packFiles(packDir));
  const named = new Set();
  for (const entry of manifest.files) {
    const name = entry?.path;
    if (typeof name !== "string" || name.length === 0 || name.startsWith("/") || name.split("/").includes("..")) {
      report.refuse("manifest_malformed", `manifest names an unusable evidence path ${JSON.stringify(name)}`);
      continue;
    }
    named.add(name);
    const target = join(packDir, name);
    let bytes;
    try {
      bytes = readFileSync(target);
    } catch (error) {
      if (error.code === "ENOENT") report.refuse("evidence_file_absent", `manifest names ${name}, which is not present in the pack`);
      else report.refuse("evidence_file_unreadable", `${name} cannot be read: ${error.message}`);
      continue;
    }
    const digest = sha256(bytes);
    if (digest !== entry.sha256) {
      report.refuse("evidence_file_digest_mismatch", `${name} is sha256 ${digest}, not the recorded ${entry.sha256}`);
      continue;
    }
    if (bytes.length !== entry.bytes) {
      report.refuse("evidence_file_bytes_mismatch", `${name} is ${bytes.length} bytes, not the recorded ${entry.bytes}`);
      continue;
    }
    report.ok(`${name} matches its recorded sha256 ${digest} (${bytes.length} bytes)`);
  }
  for (const name of onDisk) {
    if (!named.has(name)) {
      report.refuse("evidence_file_unrecorded", `${name} is in the pack but the manifest records no hash for it`);
    }
  }
  for (const required of REQUIRED_FILES) {
    if (!named.has(required)) report.refuse("required_evidence_file_absent", `an evidence pack must carry ${required}`);
  }
}

function checkPackPath(packDir, manifest, report) {
  const parts = resolve(packDir).split(sep);
  const [artifactDirectory, platformDirectory, clientDirectory, rootDirectory] = [parts.at(-1), parts.at(-2), parts.at(-3), parts.at(-4)];
  if (rootDirectory !== EVIDENCE_ROOT_NAME) {
    report.refuse("pack_path_mismatch", `a pack lives under ${EVIDENCE_ROOT_NAME}/<client-version>/${PLATFORM_DIRECTORY}/<artifact-sha256>; this one sits in ${packDir}`);
    return;
  }
  if (clientDirectory !== manifest.client?.version) {
    report.refuse("pack_path_mismatch", `the manifest names client version ${manifest.client?.version} but the pack sits under ${clientDirectory}`);
  }
  if (platformDirectory !== PLATFORM_DIRECTORY) {
    report.refuse("pack_path_mismatch", `the pack sits under ${platformDirectory}, not ${PLATFORM_DIRECTORY}`);
  }
  if (artifactDirectory !== manifest.artifact?.sha256) {
    report.refuse("pack_path_mismatch", `the manifest names artifact sha256 ${manifest.artifact?.sha256} but the pack sits under ${artifactDirectory}`);
  }
}

function checkSynthetic(packDir, manifest, report, { release, allowSynthetic }, syntheticSignals) {
  const markerPresent = existsSync(join(packDir, SYNTHETIC_MARKER_FILE));
  const bannerInManifest = JSON.stringify(manifest).includes(SYNTHETIC_BANNER);
  const versionLooksSynthetic = /synthetic|stand-in/i.test(String(manifest.client?.version ?? ""));
  const declared = manifest.synthetic === true;
  const { processSynthetic, castSynthetic } = syntheticSignals;
  const synthetic = declared || markerPresent || bannerInManifest || versionLooksSynthetic || processSynthetic || castSynthetic;
  if (synthetic && !declared) {
    report.refuse("synthetic_marker_conflict", `this pack carries synthetic evidence (fixture-observed stand-in process: ${processSynthetic}, cast banner: ${castSynthetic}, marker file: ${markerPresent}, banner: ${bannerInManifest}, client version: ${manifest.client?.version}) but its manifest declares synthetic ${JSON.stringify(manifest.synthetic)}`);
  }
  if (declared && !markerPresent) {
    report.refuse("synthetic_marker_conflict", `this pack declares itself synthetic but carries no ${SYNTHETIC_MARKER_FILE} beside its manifest`);
  }
  if (declared && typeof manifest.synthetic_banner !== "string") {
    report.refuse("synthetic_marker_conflict", "this pack declares itself synthetic but its manifest carries no synthetic_banner");
  }
  if (synthetic && release) {
    report.refuse("synthetic_pack_in_release_evidence", `${packDir} is a synthetic fixture pack; no Claude Code process produced it, and it can never discharge a release`);
  }
  if (synthetic && !release && !allowSynthetic) {
    report.refuse("synthetic_pack_not_permitted", `${packDir} is a synthetic fixture pack; pass --allow-synthetic to check one deliberately`);
  }
  if (synthetic) report.ok("this pack is a SYNTHETIC fixture pack and is refused by release checking");
  return synthetic;
}

// A recording is evidence only if the checker reads it.  The synthetic banner
// is deliberately written into every fixture cast, so inspect the exact bytes
// that the manifest commits to rather than trusting a manifest summary.
function checkCasts(packDir, manifest, report) {
  const recordings = manifest.environment?.recordings;
  if (!Array.isArray(recordings) || recordings.length === 0) {
    report.refuse("terminal_recordings_absent", "the manifest names no terminal recordings to examine");
    return false;
  }
  let synthetic = false;
  for (const recording of recordings) {
    const name = recording?.file;
    if (typeof name !== "string" || name.length === 0 || name.startsWith("/") || name.split("/").includes("..")) {
      report.refuse("terminal_recording_name_invalid", `the manifest names an unusable terminal recording ${JSON.stringify(name)}`);
      continue;
    }
    let bytes;
    try {
      bytes = readFileSync(join(packDir, name));
    } catch (error) {
      if (error.code === "ENOENT") report.refuse("terminal_recording_absent", `${name} is not present in the pack`);
      else report.refuse("terminal_recording_unreadable", `${name} cannot be read: ${error.message}`);
      continue;
    }
    if (bytes.includes(Buffer.from(SYNTHETIC_BANNER, "utf8"))) {
      synthetic = true;
      report.ok(`${name} carries the synthetic fixture banner`);
    } else {
      report.ok(`${name} was examined for the synthetic fixture banner`);
    }
  }
  return synthetic;
}

function checkArtifact(manifest, report, { artifactSha256, artifactBytes }) {
  const artifact = manifest.artifact || {};
  for (const field of ["sha256", "bytes", "installed_tree_sha256", "version"]) {
    if (artifact[field] === undefined || artifact[field] === null) {
      report.refuse("artifact_identity_incomplete", `the manifest does not name the artifact's ${field}`);
    }
  }
  if (typeof artifact.sha256 === "string" && !/^[0-9a-f]{64}$/.test(artifact.sha256)) {
    report.refuse("artifact_identity_incomplete", `the manifest's artifact sha256 ${JSON.stringify(artifact.sha256)} is not 64 lowercase hex characters`);
  }
  if (artifactSha256 && artifact.sha256 !== artifactSha256) {
    report.refuse("artifact_mismatch", `manifest names artifact sha256 ${artifact.sha256}, not the release artifact ${artifactSha256}`);
  }
  if (artifactBytes !== undefined && artifact.bytes !== artifactBytes) {
    report.refuse("artifact_bytes_mismatch", `manifest names artifact length ${artifact.bytes}, not the release artifact's ${artifactBytes}`);
  }
  if (artifactSha256 && artifact.sha256 === artifactSha256) {
    report.ok(`the manifest names the exact artifact under release: sha256 ${artifactSha256}`);
  }
}

function checkCases(manifest, report) {
  const observed = Array.isArray(manifest.observed) ? manifest.observed : [];
  const byId = new Map(observed.map((entry) => [entry?.case, entry]));
  for (const required of REQUIRED_CASES) {
    const entry = byId.get(required.id);
    if (!entry) {
      report.refuse("case_absent", `the manifest records no observation for the required case ${required.id}`);
      continue;
    }
    if (entry.required !== required.required) {
      report.refuse("case_requirement_altered", `${required.id} records the requirement ${JSON.stringify(entry.required)}, not ${JSON.stringify(required.required)}`);
      continue;
    }
    if (entry.result !== "OBSERVED") {
      report.refuse("case_not_observed", `${required.id} is recorded as ${JSON.stringify(entry.result)}, not OBSERVED`);
      continue;
    }
    report.ok(`${required.id}: OBSERVED — ${required.required}`);
  }
  const requiredIds = new Set(REQUIRED_CASES.map((entry) => entry.id));
  for (const entry of observed) {
    if (!requiredIds.has(entry?.case)) {
      report.refuse("case_unexpected", `the manifest records an observation for ${JSON.stringify(entry?.case)}, which is not one of the eight fixed cases`);
    }
  }
  return observed;
}

// The counts the manifest reports are recomputed here out of the raw
// append-only child log the fixture wrote. A manifest that says one call while
// its own child.jsonl says two is refused on the file, not on the summary.
function checkChildLog(packDir, manifest, report) {
  let raw;
  try {
    raw = readFileSync(join(packDir, "child.jsonl"), "utf8");
  } catch {
    return []; // already refused as an absent or unreadable evidence file
  }
  if (!raw.endsWith("\n")) {
    report.refuse("child_log_truncated", "child.jsonl does not end at a newline-delimited record boundary");
  }
  const records = [];
  const recordLines = new Map();
  const lines = raw.split("\n").filter((line) => line !== "");
  for (const [index, line] of lines.entries()) {
    if (line.trim() === "") continue;
    let record;
    try { record = JSON.parse(line); } catch {
      report.refuse("child_log_malformed", `child.jsonl record ${index + 1} is not valid JSON`);
      continue;
    }
    records.push(record);
    recordLines.set(record, line);
    if (record.fixture !== "seal.cc-fixture/v1") {
      report.refuse("child_log_schema_disagrees", `child.jsonl record ${index + 1} is not a seal.cc-fixture/v1 record`);
    }
  }
  const sessions = new Map();
  for (const record of records) {
    if (typeof record.session !== "string" || record.session.length === 0) {
      report.refuse("child_log_session_absent", `child.jsonl record ${record.n ?? "?"} has no fixture session id`);
      continue;
    }
    const state = sessions.get(record.session);
    if (record.kind === "start") {
      if (state) report.refuse("child_log_session_discontinuous", `fixture session ${record.session} starts more than once`);
      if (record.n !== 1 || record.previous_sha256 !== "0".repeat(64)) {
        report.refuse("child_log_chain_broken", `fixture session ${record.session} does not begin at record 1 with the zero digest`);
      }
      sessions.set(record.session, {
        pid: record.pid,
        closed: false,
        n: record.n,
        sha256: sha256(Buffer.from(`${recordLines.get(record)}\n`, "utf8")),
      });
      continue;
    }
    if (!state) {
      report.refuse("child_log_session_discontinuous", `fixture session ${record.session} has ${record.kind} before start`);
      continue;
    }
    if (state.closed) report.refuse("child_log_session_discontinuous", `fixture session ${record.session} has a record after exit`);
    if (record.pid !== state.pid) report.refuse("child_log_session_discontinuous", `fixture session ${record.session} changes pid`);
    if (record.n !== state.n + 1 || record.previous_sha256 !== state.sha256) {
      report.refuse("child_log_chain_broken", `fixture session ${record.session} record ${JSON.stringify(record.n)} does not continue its digest chain after ${state.n}`);
    }
    state.n = record.n;
    state.sha256 = sha256(Buffer.from(`${recordLines.get(record)}\n`, "utf8"));
    if (record.kind === "exit") state.closed = true;
  }
  // A client may tear down an MCP subprocess without closing its stdin, so an
  // individual session need not carry exit. The independent final-boundary
  // commitment below establishes the complete byte length of the whole log.
  if (records.length === 0 || records.at(-1)?.kind !== "exit") {
    report.refuse("child_log_truncated", "child.jsonl does not finish with the fixture's exit record");
  }
  checkChildLogCommitment(packDir, raw, lines.length, report);
  const calls = records.filter((record) => record.kind === "child-call");
  const accept = (manifest.observed || []).find((entry) => entry?.case === "accept");
  const reported = accept?.facts?.child_call_records_total;
  if (reported !== undefined && reported !== calls.length) {
    report.refuse("child_call_count_disagrees", `the manifest reports ${reported} child call(s) but child.jsonl carries ${calls.length} child-call record(s)`);
  }
  if (calls.length !== 1) {
    report.refuse("child_call_count_disagrees", `an accepted acceptance run leaves exactly one child-call record in child.jsonl; this pack carries ${calls.length}`);
  }
  const note = manifest.fixture?.notes?.accept;
  if (typeof note === "string" && calls.length === 1) {
    if (calls[0].arguments?.note !== note) {
      report.refuse("child_call_arguments_disagree", `the single child call carries note ${JSON.stringify(calls[0].arguments?.note)}, not the instructed ${JSON.stringify(note)}`);
    }
    // The fixture appends exactly `${note}\n`; that is the whole effect, so
    // its digest is computable here without trusting either the harness or
    // the fixture's own arithmetic.
    const expected = sha256(Buffer.from(`${note}\n`, "utf8"));
    const observedEffect = calls[0].effect?.sha256;
    if (observedEffect !== expected) {
      report.refuse("effect_digest_disagrees", `the child log records effect sha256 ${observedEffect}, not the ${expected} that appending ${JSON.stringify(note)} produces`);
    } else if (accept?.facts?.observed_effect_sha256 !== expected) {
      report.refuse("effect_digest_disagrees", `the manifest reports effect sha256 ${accept?.facts?.observed_effect_sha256}, not the ${expected} its own child log records`);
    } else {
      report.ok(`the child log carries exactly one child call, note ${JSON.stringify(note)}, effect sha256 ${expected}`);
    }
  }
  return records;
}

// snapshots.json is written from a separate boundary read before packing. Its
// final byte count, digest and record count independently commit to the whole
// append-only fixture log; merely rehashing a shortened child.jsonl in the
// manifest therefore cannot make a careful truncation self-consistent.
function checkChildLogCommitment(packDir, raw, lines, report) {
  let snapshots;
  try { snapshots = JSON.parse(readFileSync(join(packDir, "snapshots.json"), "utf8")); } catch { return; }
  const final = (snapshots.snapshots || []).find((entry) => entry?.case === "unprotect" && entry?.edge === "end")?.snapshot?.child_log;
  if (!final) {
    report.refuse("child_log_commitment_absent", "snapshots.json carries no unprotect.end child-log commitment");
    return;
  }
  const digest = sha256(Buffer.from(raw, "utf8"));
  if (final.sha256 !== digest || final.bytes !== Buffer.byteLength(raw) || final.lines !== lines) {
    report.refuse("child_log_commitment_mismatch", `the final boundary commits to sha256 ${final.sha256}, ${final.bytes} bytes and ${final.lines} records; child.jsonl is sha256 ${digest}, ${Buffer.byteLength(raw)} bytes and ${lines} records`);
  } else {
    report.ok(`the final boundary independently commits to all ${lines} child-log records (${final.bytes} bytes)`);
  }
}

function identityDigests(step) {
  return [step?.executable, ...(Array.isArray(step?.argv_files) ? step.argv_files : [])]
    .map((entry) => entry?.sha256)
    .filter((digest) => typeof digest === "string");
}

// Realness comes from what the fixture read from /proc while the launcher
// chain existed. The self-declared client hash must occur above the Seal proxy
// in every start record, and the checked-in stand-in's hash is independently
// recognized from those raw process identities.
function checkProcessProvenance(records, manifest, report, { repoRoot, release, clientExecutableSha256 }) {
  const starts = records.filter((record) => record.kind === "start");
  const declared = manifest.client?.executable_sha256;
  let standInDigest = null;
  const standInPath = join(repoRoot, "harness/claude-code/synthetic-client.cjs");
  try { standInDigest = sha256(readFileSync(standInPath)); } catch (error) {
    if (error.code === "ENOENT") report.refuse("synthetic_client_identity_absent", `${standInPath} is absent; the checker cannot identify the shipped synthetic client`);
    else report.refuse("synthetic_client_identity_unreadable", `${standInPath} cannot be read: ${error.message}`);
  }
  if (release && typeof clientExecutableSha256 !== "string") {
    report.refuse("client_identity_expected_absent", "release checking needs --client-executable-sha256 from the operator's independently verified Claude Code executable");
  }
  let synthetic = false;
  let mediated = 0;
  for (const start of starts) {
    const chain = Array.isArray(start.ancestry) ? start.ancestry : [];
    const proxy = chain.findIndex((step) => Array.isArray(step.argv) && step.argv.includes("__proxy") && step.argv.includes("--protect-state"));
    // The fixture is also started once directly while `seal protect` probes
    // the server. That setup record proves nothing about the client and is
    // deliberately excluded; activation separately requires no direct start
    // inside the exercised client window.
    if (proxy < 0) continue;
    mediated += 1;
    const aboveProxy = proxy < 0 ? [] : chain.slice(proxy + 1);
    const observed = aboveProxy.flatMap(identityDigests);
    if (typeof declared !== "string" || !observed.includes(declared)) {
      report.refuse("client_process_not_observed", `fixture session ${start.session} does not observe client executable sha256 ${declared} above the Seal proxy`);
    }
    if (release && typeof clientExecutableSha256 === "string" && !observed.includes(clientExecutableSha256)) {
      report.refuse("client_executable_identity_mismatch", `fixture session ${start.session} observed no operator-approved client executable sha256 ${clientExecutableSha256} above the Seal proxy`);
    }
    if (manifest.synthetic !== true && aboveProxy.some((step) => Array.isArray(step.argv) && step.argv.some((word) => /(?:^|[/\\])stub-bin(?:[/\\]|$)/.test(word)))) {
      report.refuse("synthetic_client_argv_observed", `fixture session ${start.session} names a stub-bin client in argv above the Seal proxy`);
    }
    if (standInDigest && observed.includes(standInDigest)) synthetic = true;
  }
  if (mediated === 0) report.refuse("client_process_not_observed", "child.jsonl carries no fixture start mediated by the Seal proxy");
  if (mediated > 0 && !report.refusals.some((entry) => entry.code === "client_process_not_observed")) {
    report.ok(`the fixture observed client executable sha256 ${declared} above the Seal proxy in ${mediated} mediated session(s)`);
  }
  return synthetic;
}

function checkFixtureRevision(manifest, report, { release, repoRoot }) {
  const declared = manifest.fixture?.path;
  const digest = manifest.fixture?.sha256;
  if (typeof declared !== "string" || typeof digest !== "string") {
    report.refuse("fixture_revision_absent", "the manifest does not name the fixture that did the counting");
    return;
  }
  const inTree = join(repoRoot, declared);
  let bytes;
  try { bytes = readFileSync(inTree); } catch (error) {
    if (error.code === "ENOENT") report.refuse("fixture_revision_absent", `${declared} is absent from this tree; the checker cannot compare the counting instrument`);
    else report.refuse("fixture_revision_unreadable", `${inTree} cannot be read: ${error.message}`);
    return;
  }
  const got = sha256(bytes);
  if (got === digest) {
    report.ok(`fixture ${declared} is the one in this tree: sha256 ${got}`);
    return;
  }
  const message = `${declared} in this tree is sha256 ${got}; the pack was recorded with ${digest}`;
  if (release) report.refuse("fixture_revision_mismatch", `${message}. The instrument that counted the calls is not the instrument this tree ships, so this pack cannot gate this release.`);
  else report.ok(`NOTE ${message}`);
}

// The label is derived, never read. A pack cannot claim PASS by writing PASS,
// and a synthetic pack cannot claim the sentence a real run earns.
function labelFor(manifest, observed) {
  const allObserved = REQUIRED_CASES.every((required) => observed.find((entry) => entry?.case === required.id)?.result === "OBSERVED");
  if (manifest.synthetic === true) {
    return `${manifest.synthetic_banner}\n` +
      `Claude Code integration: NOT EXERCISED — a scripted stand-in drove the harness against artifact sha256 ${manifest.artifact?.sha256}.\n` +
      `No Claude Code process ran. Harness cases all observed: ${allObserved}.\n` +
      "Not automated in CI.";
  }
  return `Claude Code ${manifest.client?.version} integration:\n` +
    `${allObserved ? "PASS" : "FAIL"} — manually exercised on Linux x86-64 against artifact sha256 ${manifest.artifact?.sha256}\n` +
    "Not automated in CI.";
}

function checkPack(packDir, options) {
  const report = new Report(packDir);
  const manifest = readManifest(packDir, report);
  if (!manifest) return report;
  checkPackPath(packDir, manifest, report);
  checkArtifact(manifest, report, options);
  checkFiles(packDir, manifest, report);
  const observed = checkCases(manifest, report);
  const childRecords = checkChildLog(packDir, manifest, report);
  const castSynthetic = checkCasts(packDir, manifest, report);
  const processSynthetic = checkProcessProvenance(childRecords, manifest, report, options);
  checkSynthetic(packDir, manifest, report, options, { processSynthetic, castSynthetic });
  checkFixtureRevision(manifest, report, options);
  const derived = labelFor(manifest, observed);
  if (manifest.label !== derived) {
    report.refuse("label_mismatch", `the manifest's label is not the label its observations produce:\nrecorded:\n${manifest.label}\nderived:\n${derived}`);
  }
  report.label = derived;
  report.manifest = manifest;
  return report;
}

function findPacks(target) {
  if (existsSync(join(target, "manifest.json"))) return [target];
  const packs = [];
  const walk = (directory, depth) => {
    if (depth > 6) return;
    let entries;
    try { entries = readdirSync(directory, { withFileTypes: true }); } catch { return; }
    if (entries.some((entry) => entry.isFile() && (entry.name === "manifest.json" || REQUIRED_FILES.includes(entry.name)))) {
      packs.push(directory);
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) walk(join(directory, entry.name), depth + 1);
    }
  };
  walk(target, 0);
  return packs.sort();
}

function usage(message) {
  process.stderr.write(`${message}\n`);
  process.stderr.write("usage: check-cc-evidence.mjs <pack-or-root> [--release] [--allow-synthetic]\n");
  process.stderr.write("                             [--artifact-sha256 HEX] [--artifact-bytes N] [--client-executable-sha256 HEX] [--repo-root DIR]\n");
  process.exit(2);
}

// The label the release notes carry, written where the workflow can read it
// without parsing the rest of this output.
function emitLabel(options, label) {
  process.stdout.write(`${label}\n`);
  if (options.labelOut) writeFileSync(options.labelOut, `${label}\n`);
}

function main(argv) {
  const positional = [];
  const options = { repoRoot: resolve(dirname(fileURLToPath(import.meta.url)), "..") };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--release") { options.release = true; continue; }
    if (flag === "--allow-synthetic") { options.allowSynthetic = true; continue; }
    if (flag === "--artifact-sha256") { options.artifactSha256 = argv[++index]; continue; }
    if (flag === "--artifact-bytes") { options.artifactBytes = Number(argv[++index]); continue; }
    if (flag === "--client-executable-sha256") { options.clientExecutableSha256 = argv[++index]; continue; }
    if (flag === "--repo-root") { options.repoRoot = resolve(argv[++index]); continue; }
    if (flag === "--label-out") { options.labelOut = argv[++index]; continue; }
    if (flag.startsWith("--")) usage(`unknown flag ${flag}`);
    positional.push(flag);
  }
  if (positional.length !== 1) usage("name exactly one evidence pack directory or evidence root");
  if (options.release && options.allowSynthetic) usage("--release and --allow-synthetic contradict each other");
  if (options.release && !options.artifactSha256) usage("--release needs --artifact-sha256 <hex>: the release artifact the evidence must name");
  if (options.clientExecutableSha256 !== undefined && !/^[0-9a-f]{64}$/.test(options.clientExecutableSha256)) usage("--client-executable-sha256 must be 64 lowercase hex characters");
  const target = resolve(positional[0]);

  if (!existsSync(target)) {
    if (options.release) {
      // An absent evidence root is not a failure; it is the untested state,
      // and the untested state has a fixed sentence.
      emitLabel(options, UNTESTED_LABEL);
      process.stdout.write(`No evidence pack exists at ${target} for artifact sha256 ${options.artifactSha256}.\n`);
      return 0;
    }
    usage(`no such evidence pack or root: ${target}`);
  }
  if (!statSync(target).isDirectory()) usage(`not a directory: ${target}`);

  const packs = findPacks(target);
  if (packs.length === 0) {
    if (options.release) {
      emitLabel(options, UNTESTED_LABEL);
      process.stdout.write(`No evidence pack exists under ${target} for artifact sha256 ${options.artifactSha256}.\n`);
      return 0;
    }
    usage(`no manifest.json under ${target}`);
  }

  let failed = 0;
  let matched = 0;
  for (const pack of packs) {
    const shown = relative(process.cwd(), pack) || basename(pack);
    // A release is discharged only by evidence naming ITS artifact. A pack
    // recorded against some other artifact is neither a pass nor a failure
    // here; it is evidence about a different build, and it is checked in full
    // by the non-release run over the whole evidence tree.
    if (options.release) {
      let other = null;
      try {
        const peeked = JSON.parse(readFileSync(join(pack, "manifest.json"), "utf8"));
        if (peeked?.artifact?.sha256 && peeked.artifact.sha256 !== options.artifactSha256) other = peeked.artifact.sha256;
      } catch { other = null; }
      if (other) {
        process.stdout.write(`\n== ${shown}\nSKIP    records artifact sha256 ${other}, not the release artifact\n`);
        continue;
      }
    }
    process.stdout.write(`\n== ${shown}\n`);
    const report = checkPack(pack, options);
    for (const line of report.checks) process.stdout.write(`OK      ${line}\n`);
    for (const refusal of report.refusals) process.stdout.write(`REFUSE ${refusal.code}: ${refusal.message}\n`);
    if (report.accepted) {
      matched += 1;
      process.stdout.write("\n");
      emitLabel(options, report.label);
    } else {
      failed += 1;
    }
  }
  if (options.release && matched === 0 && failed === 0) {
    emitLabel(options, UNTESTED_LABEL);
    return 0;
  }
  process.stdout.write(`\ncc-evidence: ${packs.length} pack(s), ${matched} accepted, ${failed} refused\n`);
  return failed ? 1 : 0;
}

process.exit(main(process.argv.slice(2)));
