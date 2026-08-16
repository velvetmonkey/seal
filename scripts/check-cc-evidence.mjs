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
const REQUIRED_FILES = ["terminal.cast", "proxy.jsonl", "child.jsonl", "before-after.json"];

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

function checkSynthetic(packDir, manifest, report, { release, allowSynthetic }) {
  const markerPresent = existsSync(join(packDir, SYNTHETIC_MARKER_FILE));
  const bannerInManifest = JSON.stringify(manifest).includes(SYNTHETIC_BANNER);
  const versionLooksSynthetic = /synthetic|stand-in/i.test(String(manifest.client?.version ?? ""));
  const declared = manifest.synthetic === true;
  const synthetic = declared || markerPresent || bannerInManifest || versionLooksSynthetic;
  if (synthetic && !declared) {
    report.refuse("synthetic_marker_conflict", `this pack carries synthetic markers (marker file: ${markerPresent}, banner: ${bannerInManifest}, client version: ${manifest.client?.version}) but its manifest declares synthetic ${JSON.stringify(manifest.synthetic)}`);
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
    return; // already refused as an absent or unreadable evidence file
  }
  const records = [];
  for (const line of raw.split("\n")) {
    if (line.trim() === "") continue;
    try { records.push(JSON.parse(line)); } catch { records.push({ kind: "unparseable" }); }
  }
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
}

function checkFixtureRevision(manifest, report, { release, repoRoot }) {
  const declared = manifest.fixture?.path;
  const digest = manifest.fixture?.sha256;
  if (typeof declared !== "string" || typeof digest !== "string") {
    report.refuse("fixture_revision_absent", "the manifest does not name the fixture that did the counting");
    return;
  }
  const inTree = join(repoRoot, declared);
  if (!existsSync(inTree)) {
    report.ok(`fixture ${declared} sha256 ${digest} (not present in this tree to compare)`);
    return;
  }
  const got = sha256(readFileSync(inTree));
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
  checkSynthetic(packDir, manifest, report, options);
  checkArtifact(manifest, report, options);
  checkFiles(packDir, manifest, report);
  const observed = checkCases(manifest, report);
  checkChildLog(packDir, manifest, report);
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
    if (entries.some((entry) => entry.isFile() && entry.name === "manifest.json")) {
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
  process.stderr.write("                             [--artifact-sha256 HEX] [--artifact-bytes N] [--repo-root DIR]\n");
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
    if (flag === "--repo-root") { options.repoRoot = resolve(argv[++index]); continue; }
    if (flag === "--label-out") { options.labelOut = argv[++index]; continue; }
    if (flag.startsWith("--")) usage(`unknown flag ${flag}`);
    positional.push(flag);
  }
  if (positional.length !== 1) usage("name exactly one evidence pack directory or evidence root");
  if (options.release && options.allowSynthetic) usage("--release and --allow-synthetic contradict each other");
  if (options.release && !options.artifactSha256) usage("--release needs --artifact-sha256 <hex>: the release artifact the evidence must name");
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
