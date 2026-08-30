#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
//
// The Claude Code acceptance harness.
//
// The supported product is interactive, so this run needs a human. The human
// supplies exactly three irreducible things — issue the instruction, inspect
// the dialog, accept or decline. Every effect-level fact is established by a
// machine: the artifact identity, the installed tree, the client identity,
// the process ancestry the protected server was launched under, the
// append-only child-call log, the proxy's own receipts and approval journal,
// the project file's bytes before and after, and the terminal recording.
//
// The harness never asks the human what happened. It reads what happened out
// of files that were written while it happened, and it records the reading.
//
// Nothing here proves a future Claude Code version works, and nothing here is
// automated in CI. It records that ONE named client version, on ONE pinned
// artifact, on Linux x86-64, was exercised — and it makes that record
// checkable by `scripts/check-cc-evidence.mjs`.
//
// Usage:
//   cc-harness init --artifact FILE --sha256 HEX --bytes N --run-dir DIR [--client PATH]
//   cc-harness plan
//   cc-harness show                 show the current step without running it
//   cc-harness next                 attempt the current step
//   cc-harness finish [--out DIR]
//
// `show` is read-only with respect to progress. `next` attempts one step and
// advances only after the machine can certify that step's required evidence.
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const HARNESS_SCHEMA = "seal.cc-harness/v1";
const MANIFEST_SCHEMA = "seal.claude-code-evidence/v1";
const SERVER_NAME = "notes";
const GUARDED_TOOL = "append_note";
const OPEN_TOOL = "read_notes";
const SYNTHETIC_MARKER_FILE = "SYNTHETIC-NOT-A-REAL-RUN.txt";
const SYNTHETIC_BANNER = "SEAL-SYNTHETIC-FIXTURE — NOT A REAL CLAUDE CODE RUN";
const MIN_COLUMNS = 80;
const CURRENT_STEP_FILE = "CURRENT-STEP.txt";
const ENTER_RETRY_WAIT_MS = 25;
const ENTER_RETRY_SIGNAL = new Int32Array(new SharedArrayBuffer(4));

// The three note values the human is instructed to use. They are fixed so the
// expected effect digest can be computed before the run, and so the declined
// note becoming visible in the effect file would be a loud failure.
const NOTES = Object.freeze({
  accept: "seal-accepted-note",
  decline: "seal-declined-note",
  fallback: "seal-fallback-note",
});

const CASES = Object.freeze([
  { id: "activation", required: "After restart, Claude Code selects the local Seal override" },
  { id: "negotiation", required: "The proxy records the retry-model interaction" },
  { id: "approval_shown", required: "The terminal recording shows the exact-call dialog, and receipts and child-call records show that elicitation occurred and was answered for that exact call" },
  { id: "before_approval", required: "Child call count remains 0" },
  { id: "accept", required: "Child call count becomes exactly 1; expected effect hash matches" },
  { id: "decline", required: "Child call count remains 0" },
  { id: "missing_launcher", required: "While the launcher is absent, no protected-server record is added, .mcp.json is unchanged, and the installed tree is restored" },
  { id: "unprotect", required: "The local override disappears and .mcp.json remains byte-identical" },
]);

class HarnessError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function refuse(code, message) {
  throw new HarnessError(code, message);
}

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function digestOf(filePath) {
  try {
    const bytes = fs.readFileSync(filePath);
    return { present: true, sha256: sha256(bytes), bytes: bytes.length };
  } catch (error) {
    return { present: false, sha256: null, bytes: null, reason: error.code || error.message };
  }
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function say(line = "") {
  process.stdout.write(`${line}\n`);
}

// ---------------------------------------------------------------- run state

function statePath(runDir) {
  return path.join(runDir, "harness-state.json");
}

function loadState(runDir) {
  try {
    const state = readJson(statePath(runDir));
    if (state.schema !== HARNESS_SCHEMA) refuse("run_state_incompatible", `run state has schema ${JSON.stringify(state.schema)}, not ${HARNESS_SCHEMA}`);
    return state;
  } catch (error) {
    if (error instanceof HarnessError) throw error;
    if (error.code === "ENOENT") refuse("run_absent", `no harness run at ${runDir}; run \`cc-harness init\` first`);
    refuse("run_state_unreadable", `harness run state is unreadable: ${error.message}`);
  }
}

function saveState(state) {
  writeJson(statePath(state.paths.run), state);
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'"'"'`)}'`;
}

function recoveryGuidance(runDir) {
  const quoted = shellQuote(runDir);
  return `Recover this run directory with: chmod -R u+w -- ${quoted} && rm -rf -- ${quoted}`;
}

function runEnv(state) {
  const env = { ...process.env };
  // A clean HOME, data home and project are pinned run conditions. Anything
  // that would point the client or the product at the operator's real
  // configuration is removed rather than trusted to be absent.
  delete env.CLAUDE_CONFIG_DIR;
  env.HOME = state.paths.home;
  env.XDG_DATA_HOME = state.paths.data;
  env.XDG_CONFIG_HOME = state.paths.config;
  env.XDG_CACHE_HOME = state.paths.cache;
  env.SEAL_CC_RUN_DIR = state.paths.run;
  env.PATH = [state.paths.stubBin, path.join(state.paths.prefix, "bin"), process.env.PATH || ""].filter(Boolean).join(path.delimiter);
  return env;
}

function run(state, file, args, options = {}) {
  const result = spawnSync(file, args, {
    encoding: "utf8",
    env: runEnv(state),
    cwd: options.cwd || state.paths.project,
    stdio: options.stdio || ["ignore", "pipe", "pipe"],
  });
  return {
    argv: [file, ...args],
    code: result.status === null ? null : result.status,
    signal: result.signal || null,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
    error: result.error ? result.error.message : null,
  };
}

// ------------------------------------------------------------------ reading

function readChildLog(state) {
  const raw = (() => {
    try { return fs.readFileSync(state.paths.childLog, "utf8"); } catch { return ""; }
  })();
  const records = [];
  for (const [index, line] of raw.split("\n").entries()) {
    if (line.trim() === "") continue;
    try {
      // The verbatim frame stays in child.jsonl, which the pack carries and
      // the checker re-reads; a snapshot keeps the shape, not the bytes.
      const { raw: _frame, ...record } = JSON.parse(line);
      records.push(record);
    } catch { records.push({ kind: "unparseable-log-line", line: index + 1 }); }
  }
  return {
    ...digestOf(state.paths.childLog),
    lines: records.length,
    records,
    // Counted out of the file. Nothing reports this number; records are counted.
    guarded_calls: records.filter((record) => record.kind === "child-call").length,
  };
}

function readReceipts(state) {
  let names = [];
  try { names = fs.readdirSync(state.paths.receiptsDir).filter((name) => name.endsWith(".json")).sort(); } catch { names = []; }
  return names.map((name) => {
    const target = path.join(state.paths.receiptsDir, name);
    const digest = digestOf(target);
    let body = null;
    try { body = readJson(target); } catch { body = null; }
    return {
      name,
      ...digest,
      decision: body?.action ?? body?.verdict ?? null,
      tool: body?.tool ?? null,
      arguments: body?.arguments ?? null,
      refusal: null,
      detail: body?.reason ?? null,
      correlation: null,
      at: body?.now ?? null,
    };
  });
}

function readApprovalJournal(state) {
  const raw = (() => {
    try { return fs.readFileSync(state.paths.storePath, "utf8"); } catch { return ""; }
  })();
  const events = [];
  for (const line of raw.split("\n")) {
    if (line.trim() === "") continue;
    try { events.push(JSON.parse(line)); } catch { events.push({ type: "unparseable" }); }
  }
  return { ...digestOf(state.paths.storePath), events };
}

function readLocalOverride(state) {
  const configPath = path.join(state.paths.home, ".claude.json");
  let config = null;
  try { config = readJson(configPath); } catch { config = null; }
  const entry = config?.projects?.[state.paths.project]?.mcpServers?.[SERVER_NAME] ?? null;
  return { config_path: configPath, ...digestOf(configPath), entry };
}

function readProtectionState(state) {
  let body = null;
  try { body = readJson(state.paths.protectState); } catch { body = null; }
  return {
    ...digestOf(state.paths.protectState),
    state: body?.state ?? null,
    lease: body?.lease ?? null,
    guard_tool: body?.guardTool ?? null,
    server_name: body?.serverName ?? null,
  };
}

function snapshot(state, label) {
  const sealVersion = run(state, path.join(state.paths.prefix, "bin", "seal"), ["--version"]);
  const sealStatus = run(state, path.join(state.paths.prefix, "bin", "seal"), ["status"]);
  const mcpGet = run(state, "claude", ["mcp", "get", SERVER_NAME]);
  return {
    label,
    at: new Date().toISOString(),
    child_log: readChildLog(state),
    receipts: readReceipts(state),
    approvals_journal: readApprovalJournal(state),
    protection_state: readProtectionState(state),
    local_override: readLocalOverride(state),
    mcp_json: digestOf(path.join(state.paths.project, ".mcp.json")),
    effect: digestOf(state.paths.effect),
    effect_text: (() => { try { return fs.readFileSync(state.paths.effect, "utf8"); } catch { return null; } })(),
    // `seal --version` re-verifies every installed file against the install
    // record before it prints anything, so this line doubles as a live
    // installed-tree check at each case boundary.
    seal_version: { code: sealVersion.code, stdout: sealVersion.stdout.trim(), stderr: sealVersion.stderr.trim() },
    seal_status: { code: sealStatus.code, stdout: sealStatus.stdout, stderr: sealStatus.stderr },
    claude_mcp_get: { code: mcpGet.code, stdout: mcpGet.stdout, stderr: mcpGet.stderr },
  };
}

function snapshotPath(state, caseId, edge) {
  return path.join(state.paths.run, "snapshots", `${caseId}.${edge}.json`);
}

function takeSnapshot(state, caseId, edge) {
  const taken = snapshot(state, `${caseId}.${edge}`);
  writeJson(snapshotPath(state, caseId, edge), taken);
  say(`  snapshot ${caseId}.${edge}: child-call records ${taken.child_log.guarded_calls}, receipts ${taken.receipts.length}`);
  return taken;
}

function loadSnapshot(state, caseId, edge) {
  try { return readJson(snapshotPath(state, caseId, edge)); }
  catch { return null; }
}

// -------------------------------------------------------- terminal recorder

const ANSI = /\u001B\[[0-9;?]*[ -/]*[@-~]|\u001B\][\s\S]*?(?:\u0007|\u001B\\)|\u001B[()][A-Za-z0-9]|\u001B[=>]|[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g;

function stripTerminalControl(text) {
  return text.replace(ANSI, " ").replace(/\r/g, "\n");
}

// The screen text of a cast: the payload of every output event, in order, with
// the terminal's own control sequences removed. This is what a human read.
function castScreenText(castPath) {
  const raw = fs.readFileSync(castPath, "utf8");
  let text = "";
  for (const [index, line] of raw.split("\n").entries()) {
    if (index === 0 || line.trim() === "") continue; // line 0 is the cast header
    let event;
    try { event = JSON.parse(line); } catch { continue; }
    if (Array.isArray(event) && event[1] === "o") text += String(event[2]);
  }
  return stripTerminalControl(text);
}

// util-linux `script` is the recorder because it is present on a stock Linux
// box; the cast is written in asciinema v2 so the recording is replayable by a
// standard tool. The conversion is mechanical: one cast event per timing
// record, reading exactly that record's byte count out of the output log.
function castFromScript(outPath, timingPath, { columns, rows, startedAt, banner }) {
  const out = fs.readFileSync(outPath);
  const timing = fs.readFileSync(timingPath, "utf8").split("\n").filter((line) => line.trim() !== "");
  const header = {
    version: 2,
    width: columns,
    height: rows,
    timestamp: Math.floor(new Date(startedAt).getTime() / 1000),
    env: { TERM: process.env.TERM || "xterm-256color", SHELL: process.env.SHELL || "/bin/bash" },
  };
  if (banner) header.title = banner;
  const lines = [JSON.stringify(header)];
  // `script` writes a "Script started on ..." banner line into the output log
  // that no timing record accounts for. Skip exactly that line, and only if it
  // is there: dropping a line of real output would be a silent edit.
  let offset = 0;
  if (out.subarray(0, 14).toString("utf8") === "Script started") offset = out.indexOf(0x0a) + 1;
  let elapsed = 0;
  for (const record of timing) {
    const match = /^([A-Z])\s+([0-9.]+)\s+(\d+)$/.exec(record);
    if (!match) continue;
    const [, kind, delta, count] = match;
    elapsed += Number(delta);
    if (kind !== "O") continue;
    const end = offset + Number(count);
    if (end > out.length) break;
    lines.push(JSON.stringify([Number(elapsed.toFixed(6)), "o", out.subarray(offset, end).toString("utf8")]));
    offset = end;
  }
  return `${lines.join("\n")}\n`;
}

function recordingCorrespondence(state, caseId, castPath) {
  const recorded = state.recordings?.[caseId];
  if (!recorded) return { observed: false, reason: "recorder-written provenance is absent" };
  const outPath = path.join(state.paths.logs, `${caseId}.typescript`);
  const timingPath = path.join(state.paths.logs, `${caseId}.timing`);
  const castDigest = digestOf(castPath);
  const outDigest = digestOf(outPath);
  const timingDigest = digestOf(timingPath);
  if (!castDigest.present) return { observed: false, reason: `cast is unreadable (${castDigest.reason})` };
  if (!outDigest.present) return { observed: false, reason: `recorder output is unreadable (${outDigest.reason})` };
  if (!timingDigest.present) return { observed: false, reason: `recorder timing is unreadable (${timingDigest.reason})` };
  if (outDigest.sha256 !== recorded.typescript.sha256 || outDigest.bytes !== recorded.typescript.bytes) {
    return { observed: false, reason: "recorder output no longer matches its write-time digest" };
  }
  if (timingDigest.sha256 !== recorded.timing.sha256 || timingDigest.bytes !== recorded.timing.bytes) {
    return { observed: false, reason: "recorder timing no longer matches its write-time digest" };
  }
  if (castDigest.sha256 !== recorded.cast.sha256 || castDigest.bytes !== recorded.cast.bytes) {
    return { observed: false, reason: "cast no longer matches its recorder-written digest" };
  }
  let derived;
  try {
    derived = Buffer.from(castFromScript(outPath, timingPath, recorded.conversion), "utf8");
  } catch (error) {
    return { observed: false, reason: `recorder sources cannot be converted (${error.code || error.message})` };
  }
  const derivedDigest = { present: true, sha256: sha256(derived), bytes: derived.length };
  if (derivedDigest.sha256 !== castDigest.sha256 || derivedDigest.bytes !== castDigest.bytes) {
    return { observed: false, reason: "cast bytes are not the deterministic conversion of recorder output and timing" };
  }
  return {
    observed: true,
    reason: null,
    write_time_cast: recorded.cast,
    current_cast: castDigest,
    recorder_output: outDigest,
    recorder_timing: timingDigest,
  };
}

function waitForEnter(state) {
  if (state.synthetic) return;
  if (!process.stdin.isTTY) {
    refuse("operator_input_not_tty", "the acceptance client cannot launch because ENTER must come from a human at a terminal");
  }
  say("  Press Enter to start the recorded session.");
  const byte = Buffer.alloc(1);
  for (;;) {
    let count;
    try { count = fs.readSync(0, byte, 0, 1, null); }
    catch (error) {
      if (error.code === "EAGAIN" || error.code === "EWOULDBLOCK") {
        Atomics.wait(ENTER_RETRY_SIGNAL, 0, 0, ENTER_RETRY_WAIT_MS);
        continue;
      }
      refuse("operator_enter_unreadable", `the harness could not read ENTER: ${error.message}`);
    }
    if (count === 0) refuse("operator_enter_absent", "stdin closed before the human pressed ENTER; the client was not launched");
    if (byte[0] === 0x0a || byte[0] === 0x0d) return;
  }
}

function recordSession(state, caseId, instructions) {
  const columns = process.stdout.columns || Number(process.env.COLUMNS) || 0;
  const rows = process.stdout.rows || Number(process.env.LINES) || 24;
  if (columns && columns < MIN_COLUMNS) {
    refuse("terminal_too_narrow", `this terminal is ${columns} columns; the approval dialog is measured at ${MIN_COLUMNS} and a narrower terminal would wrap the effect out of the recording`);
  }
  const outPath = path.join(state.paths.logs, `${caseId}.typescript`);
  const timingPath = path.join(state.paths.logs, `${caseId}.timing`);
  const castPath = path.join(state.paths.logs, `${caseId}.cast`);
  for (const target of [outPath, timingPath, castPath]) {
    if (fs.existsSync(target)) refuse("recording_exists", `a recording for ${caseId} already exists at ${target}; a case is recorded once`);
  }
  say("");
  for (const line of instructions) say(`  ${line}`);
  say("");
  waitForEnter(state);
  const startedAt = new Date().toISOString();
  const result = spawnSync("script", [
    "--quiet",
    "--log-out", outPath,
    "--log-timing", timingPath,
    "--logging-format", "advanced",
    "--command", state.claude.command,
  ], { stdio: "inherit", env: runEnv(state), cwd: state.paths.project });
  if (result.error) refuse("recorder_failed", `terminal recorder could not start: ${result.error.message}`);
  const conversion = {
    columns: columns || MIN_COLUMNS,
    rows,
    startedAt,
    banner: state.synthetic ? SYNTHETIC_BANNER : undefined,
  };
  fs.writeFileSync(castPath, castFromScript(outPath, timingPath, conversion));
  state.recordings ||= {};
  state.recordings[caseId] = {
    format: "util-linux script output+advanced-timing → asciinema/v2",
    conversion,
    typescript: digestOf(outPath),
    timing: digestOf(timingPath),
    cast: digestOf(castPath),
  };
  saveState(state);
  say(`  recorded ${castPath}`);
  return castPath;
}

// ------------------------------------------------------------ case observers

function newRecords(begin, end) {
  return end.child_log.records.slice(begin.child_log.lines);
}

function newReceipts(begin, end) {
  const seen = new Set(begin.receipts.map((receipt) => receipt.name));
  return end.receipts.filter((receipt) => !seen.has(receipt.name));
}

function argvHasSealProxyShape(argv, protectStatePath) {
  if (!Array.isArray(argv)) return false;
  // Exact argv words stop one argument from impersonating several proxy flags.
  return argv.includes("__proxy") && argv.includes("--protect-state") && argv.includes(protectStatePath);
}

function installedSealProxyDigest(store) {
  // The installed tree is the pin that the harness runs. Do not use a source
  // checkout path here. A repin changes this digest without changing code.
  return digestOf(path.join(store, "bin", "seal"));
}

function proxyEvidenceForStart(record, protectStatePath, expectedDigest) {
  const ancestors = Array.isArray(record.ancestry) ? record.ancestry : [];
  const candidates = ancestors.filter((step) => argvHasSealProxyShape(step?.argv, protectStatePath));
  if (candidates.length === 0) return { mediated: false, reason: "no proxy ancestor" };

  // Refuse a proxy-shaped ancestor with an absent or unreadable digest. Silence
  // cannot establish Seal mediation. Only the installed bin/seal SHA256 counts.
  if (!expectedDigest?.present || !expectedDigest.sha256) {
    return { mediated: false, reason: "digest absent" };
  }
  let hasDigest = false;
  for (const step of candidates) {
    const identities = Array.isArray(step.argv_files) ? step.argv_files : [];
    for (const identity of identities) {
      if (typeof identity?.sha256 !== "string" || identity.sha256.length === 0) continue;
      hasDigest = true;
      if (identity.sha256 === expectedDigest.sha256) return { mediated: true, reason: null };
    }
  }
  return { mediated: false, reason: hasDigest ? "digest mismatch" : "digest absent" };
}

function nonProxyStarts(records, protectStatePath, expectedDigest) {
  return records.filter((record) => record.kind === "start" &&
    !proxyEvidenceForStart(record, protectStatePath, expectedDigest).mediated);
}

function argvIsClient(argv, clientExecutable) {
  if (!Array.isArray(argv)) return false;
  return argv.some((word) => word === clientExecutable || path.basename(word) === path.basename(clientExecutable));
}

function observeActivation(state, begin, end) {
  const starts = newRecords(begin, end).filter((record) => record.kind === "start");
  const leasePid = end.protection_state.lease?.pid ?? null;
  const proxyDigest = installedSealProxyDigest(state.paths.store);
  const mediated = starts.filter((record) => proxyEvidenceForStart(record, state.paths.protectState, proxyDigest).mediated);
  const leaseMatched = mediated.filter((record) => (record.ancestry || [])
    .some((step) => argvHasSealProxyShape(step.argv, state.paths.protectState) && step.pid === leasePid));
  const clientAbove = mediated.filter((record) => (record.ancestry || []).some((step) => argvIsClient(step.argv, state.claude.executable)));
  const direct = starts.filter((record) => !proxyEvidenceForStart(record, state.paths.protectState, proxyDigest).mediated);
  const localScopeSelected = /^ {2}Scope: Local config \(private to you in this project\)$/m.test(end.claude_mcp_get.stdout || "");
  const localEntryIsProxy = argvHasSealProxyShape([
    end.local_override.entry?.command,
    ...(Array.isArray(end.local_override.entry?.args) ? end.local_override.entry.args : []),
  ], state.paths.protectState);
  return {
    observed: end.protection_state.state === "ACTIVE" && end.claude_mcp_get.code === 0 && localScopeSelected && localEntryIsProxy &&
      leaseMatched.length > 0 && clientAbove.length > 0 && direct.length === 0,
    facts: {
      protection_state_after: end.protection_state.state,
      lease_pid: leasePid,
      protected_server_starts: starts.length,
      starts_launched_by_seal_proxy: mediated.length,
      starts_whose_proxy_pid_is_the_recorded_lease: leaseMatched.length,
      starts_with_the_client_above_the_proxy: clientAbove.length,
      starts_not_launched_by_seal: direct.length,
      claude_mcp_get_exit: end.claude_mcp_get.code,
      claude_mcp_get_local_scope_selected: localScopeSelected,
      local_override_is_recorded_seal_proxy: localEntryIsProxy,
      ancestry: starts.map((record) => (record.ancestry || []).map((step) => ({ pid: step.pid, argv: step.argv }))),
    },
  };
}

function observeNegotiation(state, begin, end) {
  const receipts = newReceipts(begin, end);
  const offers = receipts.filter((receipt) => receipt.decision === "INPUT_REQUIRED");
  const pairs = [];
  for (const offer of offers) {
    const answer = receipts.find((receipt) => receipt.name > offer.name && receipt.decision !== "INPUT_REQUIRED" && receipt.tool === offer.tool && JSON.stringify(receipt.arguments) === JSON.stringify(offer.arguments));
    if (answer) pairs.push({ offer: offer.name, answer: answer.name, answer_decision: answer.decision });
  }
  const journalEvents = end.approvals_journal.events.slice(begin.approvals_journal.events.length);
  return {
    observed: pairs.length > 0,
    facts: {
      retry_round_trips: pairs.length,
      pairs,
      receipts: receipts.map((receipt) => ({ name: receipt.name, decision: receipt.decision, refusal: receipt.refusal })),
      approval_journal_events: journalEvents.map((event) => ({ type: event.type, status: event.status ?? null })),
    },
  };
}

// The dialog Seal asks the client to render is computed from the PINNED
// artifact's own renderer and contract, not from this checkout, and then
// looked for in the terminal recording. Claude Code shows the first three
// message lines before its fold and shows the schema-carried title and
// description after the fold. A line the recording does not carry is reported
// absent rather than assumed present.
function expectedDialogLines(state, note) {
  const rendererPath = path.join(state.paths.store, "contract", "renderer.cjs");
  const { renderApprovalMessage } = require(rendererPath);
  const rendered = renderApprovalMessage(GUARDED_TOOL, { note }, { terminalWidth: MIN_COLUMNS, ttlMs: 120000 });
  if (!rendered.ok) refuse("dialog_unrenderable", `the pinned artifact refuses to render this approval: ${rendered.reason}`);
  const contractPath = path.join(state.paths.store, "contract", "contract.cjs");
  const { createApprovalContract } = require(contractPath);
  const contract = createApprovalContract({
    terminalWidth: MIN_COLUMNS,
    ttlMs: 120000,
    kernelAdapter: { authorize() { throw new Error("dialog rendering does not authorize"); } },
  });
  const begun = contract.begin({ tool: GUARDED_TOOL, args: { note } });
  if (begun.kind !== "input_required") refuse("dialog_unrenderable", `the pinned artifact refuses to create this approval: ${begun.refusal || begun.kind}`);
  const approve = begun.elicitationParams?.requestedSchema?.properties?.approve;
  if (typeof approve?.title !== "string" || typeof approve?.description !== "string") {
    refuse("dialog_unrenderable", "the pinned artifact approval schema has no title or description");
  }
  return [...rendered.lines.slice(1, 3), approve.title, approve.description];
}

function observeApprovalShown(state, begin, end, castPath, note = NOTES.accept, requireElicitation = true) {
  const lines = expectedDialogLines(state, note);
  let text = "";
  let readError = null;
  try { text = castScreenText(castPath); } catch (error) { readError = error.code || error.message; }
  const recordingDigest = digestOf(castPath);
  const correspondence = recordingCorrespondence(state, path.basename(castPath, ".cast"), castPath);
  // Compare on collapsed whitespace, with box rules and the borders a TUI
  // paints around a dialog removed, so a boxed or re-wrapped dialog still
  // matches its words. A line the recording does not carry is reported absent
  // — this check never softens into "something like it appeared".
  const haystack = text.replace(/[\u2500-\u257F|\u00A0]/g, " ").replace(/\s+/g, " ");
  const found = lines.map((line) => ({ line, found: haystack.includes(line.trim().replace(/\s+/g, " ")) }));
  const anchor = haystack.indexOf("Approval required");
  const receipts = newReceipts(begin, end);
  const offers = receipts.filter((receipt) => receipt.decision === "INPUT_REQUIRED" &&
    receipt.tool === GUARDED_TOOL && receipt.arguments?.note === note);
  const answeredReceiptPairs = offers.flatMap((offer) => receipts
    .filter((receipt) => receipt.name > offer.name && receipt.decision === "ALLOW" &&
      receipt.tool === GUARDED_TOOL && receipt.arguments?.note === note)
    .map((receipt) => ({ offer: offer.name, answer: receipt.name, answer_decision: receipt.decision })));
  const childCalls = newRecords(begin, end).filter((record) => record.kind === "child-call");
  const exactChildCalls = childCalls.filter((record) => record.tool === GUARDED_TOOL && record.arguments?.note === note);
  return {
    observed: correspondence.observed && found.length > 0 && found.every((entry) => entry.found) &&
      (!requireElicitation || (answeredReceiptPairs.length > 0 && childCalls.length === 1 && exactChildCalls.length === 1)),
    facts: {
      recording: path.basename(castPath),
      recording_digest: recordingDigest,
      recording_read_error: readError,
      recorder_correspondence: correspondence,
      expected_dialog_lines: found,
      exact_call_elicitation_receipt_pairs: answeredReceiptPairs,
      child_call_records_added: childCalls.length,
      exact_call_child_records_added: exactChildCalls.length,
      receipts: receipts.map((receipt) => ({ name: receipt.name, decision: receipt.decision, refusal: receipt.refusal })),
      dialog_rendered_by: "contract/renderer.cjs and contract/contract.cjs, read out of the installed pinned artifact",
      screen_text_characters: haystack.length,
      // Enough of the screen to see WHY a line was not matched, when one was not.
      screen_excerpt: found.every((entry) => entry.found)
        ? null
        : haystack.slice(Math.max(0, anchor < 0 ? 0 : anchor - 100), (anchor < 0 ? 0 : anchor) + 700),
    },
  };
}

function observeBeforeApproval(state, begin, end) {
  const records = newRecords(begin, end);
  return {
    observed: end.child_log.guarded_calls === 0 && records.filter((record) => record.kind === "child-call").length === 0,
    facts: {
      child_call_records_at_start_of_window: begin.child_log.guarded_calls,
      child_call_records_at_end_of_window: end.child_log.guarded_calls,
      child_call_records_added: records.filter((record) => record.kind === "child-call").length,
      effect_file_present: end.effect.present,
    },
  };
}

function observeAccept(state, begin, end) {
  const added = newRecords(begin, end).filter((record) => record.kind === "child-call");
  const delta = end.child_log.guarded_calls - begin.child_log.guarded_calls;
  // Computed here, before the run, from the note the human was told to use:
  // the fixture appends exactly `${note}\n` and nothing else.
  const expectedEffect = sha256(Buffer.from(`${NOTES.accept}\n`, "utf8"));
  return {
    observed: delta === 1 && end.child_log.guarded_calls === 1 && added.length === 1 &&
      added[0]?.arguments?.note === NOTES.accept && end.effect.sha256 === expectedEffect,
    facts: {
      child_call_records_added: delta,
      child_call_records_total: end.child_log.guarded_calls,
      call_arguments: added.map((record) => record.arguments),
      expected_effect_sha256: expectedEffect,
      observed_effect_sha256: end.effect.sha256,
      effect_bytes: end.effect.bytes,
      receipts: newReceipts(begin, end).map((receipt) => ({ name: receipt.name, decision: receipt.decision, refusal: receipt.refusal })),
    },
  };
}

function observeDecline(state, begin, end) {
  const added = newRecords(begin, end).filter((record) => record.kind === "child-call");
  const declinedNoteInEffect = typeof end.effect_text === "string" && end.effect_text.includes(NOTES.decline);
  const receipts = newReceipts(begin, end);
  const offers = receipts.filter((receipt) => receipt.decision === "INPUT_REQUIRED" &&
    receipt.tool === GUARDED_TOOL && receipt.arguments?.note === NOTES.decline);
  const declinedPairs = offers.flatMap((offer) => receipts
    .filter((receipt) => receipt.name > offer.name &&
      receipt.decision === "BLOCK" &&
      receipt.tool === GUARDED_TOOL && receipt.arguments?.note === NOTES.decline)
    .map((receipt) => ({ offer: offer.name, decline: receipt.name })));
  const dialog = observeApprovalShown(state, begin, end, path.join(state.paths.logs, "decline.cast"), NOTES.decline, false);
  return {
    observed: declinedPairs.length > 0 && dialog.observed && added.length === 0 &&
      end.child_log.guarded_calls === begin.child_log.guarded_calls && !declinedNoteInEffect,
    facts: {
      child_call_records_added: added.length,
      child_call_records_total: end.child_log.guarded_calls,
      declined_note: NOTES.decline,
      declined_note_present_in_effect_file: declinedNoteInEffect,
      exact_call_decline_receipt_pairs: declinedPairs,
      exact_call_dialog: dialog.facts,
      receipts: receipts.map((receipt) => ({ name: receipt.name, decision: receipt.decision, refusal: receipt.refusal })),
    },
  };
}

function observeMissingLauncher(state, begin, end) {
  const records = newRecords(begin, end);
  const childCalls = records.filter((record) => record.kind === "child-call");
  const lifecycleRecords = records.filter((record) => record.kind !== "child-call");
  const proxyDigest = installedSealProxyDigest(state.paths.store);
  const fallbackStarts = nonProxyStarts(records, state.paths.protectState, proxyDigest);
  const window = state.steps.missing_launcher || {};
  const castPath = path.join(state.paths.logs, "missing_launcher.cast");
  const correspondence = recordingCorrespondence(state, "missing_launcher", castPath);
  // NON-CLAIM — NO FALLBACK OCCURRED means this instrumented run added no
  // protected-server record while the launcher was absent. It does not prove
  // that the human saw a failure report. A real client emits model prose that
  // differs on every run. The old required strings came only from our stand-in.
  return {
    observed: childCalls.length === 0 && fallbackStarts.length === 0 &&
      begin.mcp_json.sha256 === end.mcp_json.sha256 &&
      window.launcher_absent_during_window === true && window.installed_tree_restored === true &&
      correspondence.observed,
    facts: {
      protected_server_records_added: childCalls.length,
      child_call_records_added: childCalls.length,
      non_proxy_start_records_added: fallbackStarts.length,
      lifecycle_records_added: lifecycleRecords.length,
      records_added_total: records.length,
      records_added: records.map((record) => ({ kind: record.kind, argv: record.argv ?? null })),
      offending_child_call_records: childCalls,
      offending_non_proxy_start_records: fallbackStarts.map((record) => ({
        argv: record.argv ?? null,
        ancestry: Array.isArray(record.ancestry) ? record.ancestry : null,
        proxy_rejection: proxyEvidenceForStart(record, state.paths.protectState, proxyDigest).reason,
      })),
      launcher_path: window.launcher_path ?? null,
      launcher_absent_during_window: window.launcher_absent_during_window ?? null,
      seal_version_while_absent: window.seal_version_while_absent ?? null,
      installed_tree_restored: window.installed_tree_restored ?? null,
      seal_version_after_restore: window.seal_version_after_restore ?? null,
      mcp_json_sha256_before: begin.mcp_json.sha256,
      mcp_json_sha256_after: end.mcp_json.sha256,
      recorder_correspondence: correspondence,
    },
  };
}

function observeUnprotect(state, begin, end) {
  const original = state.project.mcp_json_before_protect;
  const window = state.steps.unprotect || {};
  return {
    observed: window.code === 0 && /Sealed MCP route(?::| [^:]+:) - outside Seal/m.test(window.output || "") &&
      end.local_override.entry === null &&
      end.mcp_json.sha256 === original.sha256 && end.mcp_json.bytes === original.bytes &&
      !/^ {2}Scope: Local config /m.test(end.claude_mcp_get.stdout),
    facts: {
      local_override_before: begin.local_override.entry,
      local_override_after: end.local_override.entry,
      claude_mcp_get_after: end.claude_mcp_get.stdout.trim(),
      mcp_json_sha256_before_protect: original.sha256,
      mcp_json_bytes_before_protect: original.bytes,
      mcp_json_sha256_after_unprotect: end.mcp_json.sha256,
      mcp_json_bytes_after_unprotect: end.mcp_json.bytes,
      unprotect_output: (state.steps.unprotect || {}).output ?? null,
      unprotect_exit: window.code ?? null,
    },
  };
}

const OBSERVERS = {
  activation: observeActivation,
  negotiation: observeNegotiation,
  approval_shown: (state, begin, end) => observeApprovalShown(state, begin, end, path.join(state.paths.logs, "accept.cast")),
  before_approval: observeBeforeApproval,
  accept: observeAccept,
  decline: observeDecline,
  missing_launcher: observeMissingLauncher,
  unprotect: observeUnprotect,
};

// ---------------------------------------------------------------- the steps

const STEPS = [
  {
    name: "activation",
    machine: (state) => {
      takeSnapshot(state, "before_approval", "begin");
      takeSnapshot(state, "activation", "begin");
    },
    record: {
      caseId: "activation",
      instructions: (state) => [
        "STEP 1 of 6 — activation.",
        "",
        "Claude Code starts in the pinned temporary HOME, so it may ask you to",
        "sign in. Sign in BEFORE anything else: the session is recorded verbatim",
        "and a login code typed later would be recorded with it.",
        "",
        "In the session:",
        "  1. accept the project's .mcp.json server if Claude Code asks,",
        `  2. run /mcp and confirm "${SERVER_NAME}" is connected,`,
        "  3. leave with /exit.",
        "",
        "Issue NO tool instruction in this session.",
      ],
    },
    after: (state) => { takeSnapshot(state, "activation", "end"); },
  },
  {
    name: "decline",
    machine: (state) => {
      takeSnapshot(state, "negotiation", "begin");
      takeSnapshot(state, "decline", "begin");
    },
    record: {
      caseId: "decline",
      instructions: (state) => [
        "STEP 2 of 6 — the dialog, and declining it.",
        "",
        "In the session, type exactly this instruction:",
        "",
        `    Use the ${SERVER_NAME} tool ${GUARDED_TOOL} to append the note ${NOTES.decline}`,
        "",
        "When Seal's approval dialog appears: READ IT, then DECLINE.",
        "Then leave with /exit.",
      ],
    },
    after: (state) => {
      takeSnapshot(state, "decline", "end");
      takeSnapshot(state, "before_approval", "end");
    },
  },
  {
    name: "accept",
    machine: (state) => {
      takeSnapshot(state, "accept", "begin");
      takeSnapshot(state, "approval_shown", "begin");
    },
    record: {
      caseId: "accept",
      instructions: (state) => [
        "STEP 3 of 6 — the dialog, and accepting it.",
        "",
        "In the session, type exactly this instruction:",
        "",
        `    Use the ${SERVER_NAME} tool ${GUARDED_TOOL} to append the note ${NOTES.accept}`,
        "",
        "When Seal's approval dialog appears: READ IT — every line of the exact",
        "call must be visible — then ACCEPT.",
        "Then leave with /exit.",
      ],
    },
    after: (state) => {
      takeSnapshot(state, "accept", "end");
      takeSnapshot(state, "approval_shown", "end");
      takeSnapshot(state, "negotiation", "end");
    },
  },
  {
    name: "missing_launcher",
    machine: (state) => {
      takeSnapshot(state, "missing_launcher", "begin");
      const launcher = path.join(state.paths.store, "bin", "seal");
      const parked = `${launcher}.parked-by-harness`;
      const storeBin = path.dirname(launcher);
      fs.chmodSync(storeBin, 0o755);
      fs.renameSync(launcher, parked);
      fs.chmodSync(storeBin, 0o555);
      const while_absent = run(state, path.join(state.paths.prefix, "bin", "seal"), ["--version"]);
      state.steps.missing_launcher = {
        launcher_path: launcher,
        parked_path: parked,
        launcher_absent_during_window: !fs.existsSync(launcher),
        seal_version_while_absent: { code: while_absent.code, stderr: while_absent.stderr.trim() },
      };
      saveState(state);
      say(`  parked the Seal launcher the local override points at: ${launcher}`);
    },
    record: {
      caseId: "missing_launcher",
      instructions: (state) => [
        "STEP 4 of 6 — the Seal launcher is missing.",
        "",
        "The command the local override points at has been moved aside. The",
        `original ${SERVER_NAME} server in .mcp.json is untouched and still runnable.`,
        "",
        "In the session, type exactly this instruction:",
        "",
        `    Use the ${SERVER_NAME} tool ${GUARDED_TOOL} to append the note ${NOTES.fallback}`,
        "",
        "Expect it to fail. Do NOT repair anything. Then leave with /exit.",
      ],
    },
    after: (state) => {
      const window = state.steps.missing_launcher;
      const storeBin = path.dirname(window.launcher_path);
      fs.chmodSync(storeBin, 0o755);
      fs.renameSync(window.parked_path, window.launcher_path);
      fs.chmodSync(storeBin, 0o555);
      const after = run(state, path.join(state.paths.prefix, "bin", "seal"), ["--version"]);
      window.installed_tree_restored = after.code === 0 && after.stdout.trim() === state.artifact.version;
      window.seal_version_after_restore = { code: after.code, stdout: after.stdout.trim(), stderr: after.stderr.trim() };
      saveState(state);
      say(`  restored the launcher; the installed tree re-verified: ${window.installed_tree_restored}`);
      takeSnapshot(state, "missing_launcher", "end");
    },
  },
  {
    name: "unprotect",
    machine: (state) => {
      takeSnapshot(state, "unprotect", "begin");
      const result = run(state, path.join(state.paths.prefix, "bin", "seal"), ["unprotect", SERVER_NAME]);
      state.steps.unprotect = { output: `${result.stdout}${result.stderr}`.trim(), code: result.code };
      saveState(state);
      say(`  seal unprotect ${SERVER_NAME} exited ${result.code}`);
      takeSnapshot(state, "unprotect", "end");
    },
    after: () => {},
  },
  {
    name: "finish",
    machine: (state) => { finish(state, {}); },
    after: () => {},
  },
];

// ------------------------------------------------------------------ commands

function requireLinuxX64() {
  if (process.platform !== "linux" || process.arch !== "x64") {
    refuse("unsupported_platform", `this acceptance run is pinned to Linux x86-64; this host is ${process.platform}-${process.arch}`);
  }
}

function gitRevision(root) {
  const result = spawnSync("git", ["-C", root, "rev-parse", "HEAD"], { encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : null;
}

function clientExecutableFormat(executable) {
  const header = Buffer.alloc(20);
  let descriptor;
  let count = 0;
  try {
    descriptor = fs.openSync(executable, "r");
    count = fs.readSync(descriptor, header, 0, header.length, 0);
  } catch (error) {
    refuse("client_unreadable", `client executable ${JSON.stringify(executable)} has observed header bytes <unreadable: ${error.code || error.message}>; expected 20 readable header bytes`);
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
  const observed = Array.from(header.subarray(0, count), (byte) => byte.toString(16).padStart(2, "0").toUpperCase()).join(" ") || "<empty>";
  if (count < header.length) {
    refuse("client_unreadable", `client executable ${JSON.stringify(executable)} has observed header bytes ${observed}; expected 20 readable header bytes`);
  }
  const isElf = count >= 20 && header.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]));
  const is64Bit = header[4] === 0x02;
  const isX64 = header.readUInt16LE(18) === 0x3e;
  if (!isElf || !is64Bit || !isX64) {
    refuse("client_not_linux_x64", `client executable ${JSON.stringify(executable)} has observed header bytes ${observed}; expected ELF magic 7F 45 4C 46, EI_CLASS 02, and little-endian e_machine 3E 00`);
  }
  return "elf64-x86-64";
}

function clientCandidates(env) {
  const candidates = new Map();
  for (const directory of String(env.PATH || "").split(path.delimiter)) {
    const command = path.resolve(directory || ".", "claude");
    try {
      fs.accessSync(command, fs.constants.X_OK);
      const executable = fs.realpathSync(command);
      if (!candidates.has(executable)) candidates.set(executable, { executable, ...digestOf(executable) });
    } catch {
      // A PATH entry without an executable claude is not a client candidate.
    }
  }
  return [...candidates.values()].sort((left, right) => left.executable.localeCompare(right.executable));
}

function candidateDescription(candidate) {
  const digest = candidate.present ? candidate.sha256 : `<unreadable: ${candidate.reason}>`;
  return `  ${candidate.executable} sha256 ${digest}`;
}

function clientIdentity(env, explicitClient) {
  let executable;
  let selectionMethod;
  let candidates;
  if (explicitClient) {
    try {
      executable = fs.realpathSync(explicitClient);
    } catch (error) {
      refuse("client_unreadable", `client executable ${JSON.stringify(explicitClient)} cannot be resolved: ${error.code || "<unknown>"}`);
    }
    selectionMethod = "explicit";
  } else {
    candidates = clientCandidates(env);
    if (candidates.length === 0) {
      // Keep these bytes stable. Operators and tests depend on this refusal.
      refuse("client_absent", "no `claude` command is on PATH; the acceptance run needs the real client");
    }
    if (candidates.length > 1) {
      refuse("client_ambiguous", `more than one executable \`claude\` command is on PATH:\n${candidates.map(candidateDescription).join("\n")}\nPass --client PATH to select one client.`);
    }
    executable = candidates[0].executable;
    selectionMethod = "auto";
  }
  const executableFormat = clientExecutableFormat(executable);
  const digest = digestOf(executable);
  if (!digest.present || digest.bytes === 0) {
    refuse("client_unreadable", `client executable ${JSON.stringify(executable)} cannot supply readable bytes for its sha256: ${digest.reason || "<empty>"}`);
  }
  const version = spawnSync(executable, ["--version"], { encoding: "utf8", env });
  if (version.error) {
    const cause = version.error.code
      ? `error code ${JSON.stringify(version.error.code)}`
      : `error ${JSON.stringify(version.error.message || "<unknown>")}`;
    refuse("client_unreadable", `client executable ${JSON.stringify(executable)} could not be executed: ${cause}`);
  }
  if (version.status !== 0) refuse("client_version_unavailable", `\`claude --version\` exited ${version.status}`);
  const output = version.stdout.trim();
  const match = /^(\d+\.\d+\.\d+[^\s(]*)/.exec(output);
  if (!match) refuse("client_version_unreadable", `\`claude --version\` printed ${JSON.stringify(output)}, which names no version`);
  return {
    name: "claude-code",
    version: match[1],
    version_output: output,
    command: executable,
    executable,
    executable_format: executableFormat,
    selection_method: selectionMethod,
    ...(candidates ? { candidates } : {}),
    ...digest,
  };
}

function init(argv) {
  requireLinuxX64();
  const options = parseFlags(argv, ["artifact", "sha256", "bytes", "run-dir", "client", "client-command", "synthetic-client", "stub-bin"]);
  if (options.client === true) refuse("usage", "cc-harness init needs a path after --client");
  for (const required of ["artifact", "sha256", "bytes", "run-dir"]) {
    if (!options[required]) refuse("usage", `cc-harness init needs --${required}`);
  }
  const runDir = path.resolve(options["run-dir"]);
  if (fs.existsSync(runDir) && fs.readdirSync(runDir).length > 0) {
    refuse("run_dir_not_clean", `${runDir} is not empty; an acceptance run starts from a clean temporary tree. ${recoveryGuidance(runDir)}`);
  }
  const artifactPath = path.resolve(options.artifact);
  const artifact = digestOf(artifactPath);
  if (!artifact.present) refuse("artifact_missing", `the pinned artifact is not readable: ${artifactPath}`);
  if (artifact.sha256 !== options.sha256) {
    refuse("artifact_digest_mismatch", `${artifactPath} is sha256 ${artifact.sha256}, not the pinned ${options.sha256}`);
  }
  if (artifact.bytes !== Number(options.bytes)) {
    refuse("artifact_bytes_mismatch", `${artifactPath} is ${artifact.bytes} bytes, not the pinned ${options.bytes}`);
  }
  try { fs.accessSync(artifactPath, fs.constants.X_OK); }
  catch {
    refuse("artifact_not_executable", `${artifactPath} is not executable; the harness runs the artifact as its installer. Run: chmod u+x -- ${shellQuote(artifactPath)}`);
  }

  const paths = {
    run: runDir,
    home: path.join(runDir, "home"),
    data: path.join(runDir, "data"),
    config: path.join(runDir, "config"),
    cache: path.join(runDir, "cache"),
    project: path.join(runDir, "project"),
    logs: path.join(runDir, "logs"),
    stubBin: options["stub-bin"] ? path.resolve(options["stub-bin"]) : path.join(runDir, "stub-bin"),
    childLog: path.join(runDir, "child.jsonl"),
    effect: path.join(runDir, "effect.txt"),
  };
  paths.prefix = path.join(paths.home, ".local");
  for (const directory of [paths.home, paths.data, paths.config, paths.cache, paths.project, paths.logs, paths.stubBin, path.join(runDir, "snapshots")]) {
    fs.mkdirSync(directory, { recursive: true });
  }
  // The project root must be the resolved path: Seal keys its state on the
  // real path, and a symlinked temporary directory would silently disagree.
  paths.project = fs.realpathSync(paths.project);

  const harnessRoot = __dirname;
  const fixturePath = path.join(harnessRoot, "fixture-server.cjs");
  const state = {
    schema: HARNESS_SCHEMA,
    synthetic: Boolean(options["synthetic-client"]),
    created_at: new Date().toISOString(),
    paths,
    steps: {},
    step_index: 0,
    harness: {
      revision: gitRevision(path.join(harnessRoot, "..", "..")),
      files: [
        { path: "harness/claude-code/fixture-server.cjs", ...digestOf(fixturePath) },
        { path: "harness/claude-code/cc-harness.cjs", ...digestOf(path.join(harnessRoot, "cc-harness.cjs")) },
      ],
    },
    artifact: { path: artifactPath, name: path.basename(artifactPath), sha256: artifact.sha256, bytes: artifact.bytes },
    fixture: { path: fixturePath, ...digestOf(fixturePath) },
  };

  const env = { ...process.env, HOME: paths.home, XDG_DATA_HOME: paths.data, PATH: [paths.stubBin, process.env.PATH || ""].filter(Boolean).join(path.delimiter) };
  delete env.CLAUDE_CONFIG_DIR;
  // A stand-in client is only ever accepted together with --synthetic-client,
  // and it names itself as a stand-in in the version string that becomes the
  // pack's directory name. A synthetic pack cannot be filed under a real
  // client version even by accident.
  if (options["client-command"] && !state.synthetic) {
    refuse("stand_in_client_without_synthetic", "--client-command replaces the real client, so it requires --synthetic-client");
  }
  if (state.synthetic && !options["client-command"]) {
    refuse("synthetic_without_stand_in_client", "--synthetic-client needs the --client-command stand-in it stands in for");
  }
  if (options["client-command"]) {
    const typed = options["client-command"];
    let executable;
    try {
      executable = fs.realpathSync(typed);
    } catch (error) {
      refuse("client_unreadable", `client executable ${JSON.stringify(typed)} cannot be resolved: ${error.code || "<unknown>"}`);
    }
    const digest = digestOf(executable);
    if (!digest.present) {
      refuse("client_unreadable", `client executable ${JSON.stringify(executable)} cannot supply readable bytes for its sha256: ${digest.reason || "<unknown>"}`);
    }
    state.claude = {
      name: "claude-code-stand-in",
      version: "0.0.0-synthetic-stand-in",
      version_output: SYNTHETIC_BANNER,
      command: path.resolve(typed),
      executable,
      ...digest,
    };
  } else {
    state.claude = clientIdentity(env, options.client || null);
  }

  // Install the pinned artifact into the clean prefix and read its identity
  // back out of the install record the installer wrote.
  // Run the artifact the way the published command runs it: the artifact is
  // its own installer, and it verifies its own bytes against the pin first.
  const install = run(state, artifactPath, ["--sha256", artifact.sha256, "--bytes", String(artifact.bytes), "--prefix", paths.prefix], { cwd: runDir });
  if (install.code !== 0) {
    const diagnostic = [install.error, install.stderr, install.stdout].find((value) => typeof value === "string" && value.trim())?.trim()
      || "no exec error, stderr, or stdout diagnostic was captured";
    refuse("install_failed", `installing the pinned artifact failed: ${diagnostic}`);
  }
  const record = readJson(path.join(paths.prefix, "lib", "seal", "install.json"));
  paths.store = path.join(paths.prefix, record.store);
  state.artifact.installed_tree_sha256 = record.treeSha256;
  state.artifact.version = record.version;
  state.artifact.install_output = install.stdout.trim();

  // An auto-response hook would make human approval origin unknowable, which
  // is the one thing this run exists to exercise. Refuse before recording.
  const doctor = run(state, path.join(paths.prefix, "bin", "seal"), ["doctor"]);
  if (doctor.code !== 0) {
    refuse("elicitation_hook_configured", `\`seal doctor\` refuses in this environment, so the run cannot claim human approval origin:\n${(doctor.stdout || doctor.stderr).trim()}`);
  }
  state.doctor = { code: doctor.code, stdout: doctor.stdout.trim() };

  // The project a real user would already have: one stdio server, untouched
  // by Seal from here on.
  const mcpJson = `${JSON.stringify({
    mcpServers: {
      [SERVER_NAME]: {
        type: "stdio",
        command: process.execPath,
        args: [fixturePath],
        env: { SEAL_CC_FIXTURE_LOG: paths.childLog, SEAL_CC_FIXTURE_EFFECT: paths.effect },
      },
    },
  }, null, 2)}\n`;
  fs.writeFileSync(path.join(paths.project, ".mcp.json"), mcpJson);
  state.project = { path: paths.project, mcp_json_before_protect: digestOf(path.join(paths.project, ".mcp.json")) };

  const protect = run(state, path.join(paths.prefix, "bin", "seal"), ["protect", SERVER_NAME, GUARDED_TOOL]);
  if (protect.code !== 0) refuse("protect_failed", `\`seal protect\` failed: ${(protect.stderr || protect.stdout).trim()}`);
  const stateLine = /^State: (.+)$/m.exec(protect.stdout);
  if (!stateLine) refuse("protect_state_unreported", "`seal protect` did not name the protection state file");
  paths.protectState = stateLine[1];
  const protectionState = readJson(paths.protectState);
  paths.storePath = protectionState.storePath;
  paths.receiptsDir = protectionState.receiptsDir;
  state.protect = { output: protect.stdout.trim(), state_path: paths.protectState };
  state.project.mcp_json_after_protect = digestOf(path.join(paths.project, ".mcp.json"));
  if (state.project.mcp_json_after_protect.sha256 !== state.project.mcp_json_before_protect.sha256) {
    refuse("project_file_changed", "`seal protect` changed .mcp.json; the run is void");
  }
  state.local_override_after_protect = readLocalOverride(state).entry;
  saveState(state);

  say("");
  say(`Acceptance run initialised: ${runDir}`);
  say(`  artifact           ${state.artifact.name} sha256 ${state.artifact.sha256} (${state.artifact.bytes} bytes)`);
  say(`  installed tree     ${state.artifact.installed_tree_sha256}`);
  say(`  client             ${state.claude.version} (${state.claude.executable}, sha256 ${state.claude.sha256})`);
  say(`  fixture            ${state.fixture.sha256}`);
  say(`  protection         ${protectionState.state} ${SERVER_NAME}.${GUARDED_TOOL}`);
  say("");
  say(`Run the whole acceptance now with: cc-harness next --run-dir ${runDir}`);
  return state;
}

function plan(state) {
  say(`Acceptance plan — ${STEPS.length} steps, ${CASES.length} fixed cases.`);
  say("");
  for (const [index, step] of STEPS.entries()) {
    const done = index < state.step_index ? "done" : index === state.step_index ? "next" : "";
    say(`  ${String(index + 1).padStart(2)}. ${step.name.padEnd(18)} ${done}`);
  }
  say("");
  for (const item of CASES) say(`  ${item.id.padEnd(18)} ${item.required}`);
}

function currentStepText(state) {
  const step = STEPS[state.step_index];
  if (!step) return "The run is complete.\n";
  const lines = step.record
    ? step.record.instructions(state)
    : [`STEP ${state.step_index + 1} of ${STEPS.length} — ${step.name}.`, "", "This step is machine-only."];
  return `${lines.join("\n")}\n`;
}

function writeCurrentStep(state) {
  const target = path.join(state.paths.run, CURRENT_STEP_FILE);
  fs.writeFileSync(target, currentStepText(state));
  return target;
}

function show(state) {
  const target = writeCurrentStep(state);
  say(currentStepText(state).trimEnd());
  say("");
  say(`Current step written to ${target}`);
}

const STEP_CASES = Object.freeze({
  activation: ["activation"],
  decline: ["decline", "before_approval"],
  accept: ["accept", "approval_shown", "negotiation"],
  missing_launcher: ["missing_launcher"],
  unprotect: ["unprotect"],
});

function certifyStep(state, step) {
  const failures = [];
  for (const caseId of STEP_CASES[step.name] || []) {
    const begin = loadSnapshot(state, caseId, "begin");
    const end = loadSnapshot(state, caseId, "end");
    if (!begin || !end) {
      failures.push(`${caseId}: begin or end evidence is absent or unreadable`);
      continue;
    }
    const outcome = OBSERVERS[caseId](state, begin, end);
    if (!outcome.observed) {
      if (caseId === "decline") {
        const digest = outcome.facts.exact_call_dialog?.recording_digest;
        if (!digest?.present) failures.push(`${caseId}: decline.cast is absent or unreadable (${digest?.reason || "no readable digest"})`);
        else if (digest.bytes === 0) failures.push(`${caseId}: decline.cast is empty`);
        else if (outcome.facts.exact_call_decline_receipt_pairs.length === 0) failures.push(`${caseId}: the exact-call BLOCK/declined receipt pair is absent`);
        else if (!outcome.facts.exact_call_dialog?.recorder_correspondence?.observed) failures.push(`${caseId}: decline.cast does not correspond to the recorder output (${outcome.facts.exact_call_dialog?.recorder_correspondence?.reason || "correspondence evidence is absent"})`);
        else failures.push(`${caseId}: the complete exact-call dialog is absent from decline.cast`);
      } else if (caseId === "approval_shown" && !outcome.facts.recorder_correspondence?.observed) {
        failures.push(`${caseId}: accept.cast does not correspond to the recorder output (${outcome.facts.recorder_correspondence?.reason || "correspondence evidence is absent"})`);
      } else if (caseId === "approval_shown" && outcome.facts.exact_call_elicitation_receipt_pairs.length === 0) {
        failures.push(`${caseId}: the exact-call INPUT_REQUIRED/ALLOW receipt pair is absent`);
      } else if (caseId === "approval_shown" && outcome.facts.child_call_records_added !== 1) {
        failures.push(`${caseId}: exactly one child-call record is required during the dialog window`);
      } else if (caseId === "approval_shown" && outcome.facts.exact_call_child_records_added !== 1) {
        failures.push(`${caseId}: the exact-call child-call record is absent`);
      } else if (caseId === "activation") {
        if (outcome.facts.claude_mcp_get_exit !== 0) failures.push(`${caseId}: \`claude mcp get notes\` did not succeed`);
        else if (!outcome.facts.claude_mcp_get_local_scope_selected) failures.push(`${caseId}: local-scope selection evidence is absent`);
        else failures.push(`${caseId}: a connected fixture start through the recorded local Seal override is absent`);
      } else if (caseId === "missing_launcher") {
        if (!outcome.facts.recorder_correspondence?.observed) failures.push(`${caseId}: missing_launcher.cast does not correspond to recorder output (${outcome.facts.recorder_correspondence?.reason || "correspondence evidence is absent"})`);
        else if (outcome.facts.child_call_records_added !== 0) failures.push(`${caseId}: child_call_records_added must equal 0 (observed ${outcome.facts.child_call_records_added}); offending child-call records: ${JSON.stringify(outcome.facts.offending_child_call_records)}`);
        else if (outcome.facts.non_proxy_start_records_added !== 0) {
          for (const start of outcome.facts.offending_non_proxy_start_records) {
            if (start.proxy_rejection === "digest mismatch") failures.push(`${caseId}: start ${JSON.stringify(start.argv)} was rejected because its proxy-shaped ancestor has a digest mismatch`);
            else if (start.proxy_rejection === "digest absent") failures.push(`${caseId}: start ${JSON.stringify(start.argv)} was rejected because its proxy-shaped ancestor digest is absent or unreadable`);
            else failures.push(`${caseId}: start ${JSON.stringify(start.argv)} was rejected because it has no proxy ancestor at all`);
          }
        }
        else if (outcome.facts.mcp_json_sha256_before !== outcome.facts.mcp_json_sha256_after) failures.push(`${caseId}: mcp_json_sha256_before must equal mcp_json_sha256_after (observed ${outcome.facts.mcp_json_sha256_before} and ${outcome.facts.mcp_json_sha256_after})`);
        else if (outcome.facts.launcher_absent_during_window !== true) failures.push(`${caseId}: launcher_absent_during_window must equal true (observed ${outcome.facts.launcher_absent_during_window})`);
        else if (outcome.facts.installed_tree_restored !== true) failures.push(`${caseId}: installed_tree_restored must equal true (observed ${outcome.facts.installed_tree_restored})`);
        else failures.push(`${caseId}: observer conditions failed with facts ${JSON.stringify(outcome.facts)}`);
      } else if (caseId === "unprotect") {
        if (outcome.facts.unprotect_exit !== 0) failures.push(`${caseId}: seal unprotect notes did not succeed (exit ${outcome.facts.unprotect_exit ?? "absent"})`);
        else failures.push(`${caseId}: the local override removal and byte-identical project configuration evidence is absent`);
      } else if (caseId === "negotiation") {
        failures.push(`${caseId}: retry_round_trips must be greater than 0 (observed ${outcome.facts.retry_round_trips})`);
      } else if (caseId === "before_approval") {
        failures.push(`${caseId}: child_call_records_at_end_of_window must equal 0 and child_call_records_added must equal 0 (observed ${outcome.facts.child_call_records_at_end_of_window} and ${outcome.facts.child_call_records_added})`);
      } else if (caseId === "accept") {
        failures.push(`${caseId}: child_call_records_added must equal 1, child_call_records_total must equal 1, and observed_effect_sha256 must equal expected_effect_sha256 (observed ${outcome.facts.child_call_records_added}, ${outcome.facts.child_call_records_total}, ${outcome.facts.observed_effect_sha256}, and ${outcome.facts.expected_effect_sha256})`);
      } else {
        failures.push(`${caseId}: observer conditions failed with facts ${JSON.stringify(outcome.facts)}`);
      }
    }
  }
  if (failures.length) {
    refuse("step_cannot_certify", `CANNOT CERTIFY ${step.name}; ${failures.join("; ")}. The run remains on this step.`);
  }
}

function next(state) {
  const step = STEPS[state.step_index];
  if (!step) refuse("run_complete", "every step of this run has already been taken");
  const current = state.steps[step.name] || {};
  if (current.attempted === true) certifyStep(state, step);
  say(`Step ${state.step_index + 1}/${STEPS.length}: ${step.name}`);
  const currentStepPath = writeCurrentStep(state);
  say(`  current instruction: ${currentStepPath}`);
  step.machine(state);
  if (step.record) recordSession(state, step.record.caseId, step.record.instructions(state));
  step.after(state);
  state.steps[step.name] = { ...(state.steps[step.name] || {}), attempted: true };
  saveState(state);
  certifyStep(state, step);
  state.step_index += 1;
  writeCurrentStep(state);
  saveState(state);
  const following = STEPS[state.step_index];
  say("");
  say(following ? `Next: cc-harness next --run-dir ${state.paths.run}   (${following.name})` : "The run is complete.");
}

// --------------------------------------------------------------- the pack

function observeAll(state) {
  return CASES.map((item) => {
    const begin = loadSnapshot(state, item.id, "begin");
    const end = loadSnapshot(state, item.id, "end");
    if (!begin || !end) {
      return { case: item.id, required: item.required, result: "NOT OBSERVED", facts: { reason: "the case window was never closed" } };
    }
    const outcome = OBSERVERS[item.id](state, begin, end);
    return {
      case: item.id,
      required: item.required,
      result: outcome.observed ? "OBSERVED" : "NOT OBSERVED",
      window: { begin: begin.at, end: end.at },
      facts: outcome.facts,
    };
  });
}

// The honest label, and nothing past it. PASS says one named client version
// was exercised once, by hand, against one artifact. It does not say Claude
// Code is independently assured, and it does not say any other version works.
// A synthetic run never earns that sentence: it names itself instead.
function labelFor(state, observations) {
  const allObserved = observations.every((entry) => entry.result === "OBSERVED");
  if (state.synthetic) {
    return `${SYNTHETIC_BANNER}\n` +
      `Claude Code integration: NOT EXERCISED — a scripted stand-in drove the harness against artifact sha256 ${state.artifact.sha256}.\n` +
      `No Claude Code process ran. Harness cases all observed: ${allObserved}.\n` +
      "Not automated in CI.";
  }
  return `Claude Code ${state.claude.version} integration:\n` +
    `${allObserved ? "PASS" : "FAIL"} — manually exercised on Linux x86-64 against artifact sha256 ${state.artifact.sha256}\n` +
    "Not automated in CI.";
}

function proxyRecord(state) {
  const end = loadSnapshot(state, "unprotect", "end") || loadSnapshot(state, "accept", "end");
  const lines = [JSON.stringify({
    record: "seal.cc-proxy-record/v1",
    synthetic: state.synthetic,
    note: "An index of what the Seal proxy itself recorded: its durable approval journal, then every receipt it wrote. The originals are copied beside this file under approvals.journal and receipts/.",
    approvals_journal: "approvals.journal",
    receipts_directory: "receipts",
  })];
  if (state.synthetic) lines.push(JSON.stringify({ record: "synthetic-banner", banner: SYNTHETIC_BANNER }));
  for (const [index, event] of (end?.approvals_journal.events || []).entries()) {
    lines.push(JSON.stringify({ source: "approvals.journal", line: index + 1, event }));
  }
  for (const receipt of end?.receipts || []) {
    let body = null;
    try { body = readJson(path.join(state.paths.receiptsDir, receipt.name)); } catch { body = null; }
    lines.push(JSON.stringify({ source: "receipt", file: `receipts/${receipt.name}`, sha256: receipt.sha256, bytes: receipt.bytes, body }));
  }
  return `${lines.join("\n")}\n`;
}

function childRecord(state) {
  const raw = (() => { try { return fs.readFileSync(state.paths.childLog, "utf8"); } catch { return ""; } })();
  // This is the fixture's byte-for-byte log. In particular, finish does not
  // prepend a synthetic label: realness is derived by the checker from the
  // process identities the fixture read from /proc while each session lived.
  return raw;
}

function beforeAfter(state) {
  const first = loadSnapshot(state, "activation", "begin");
  const last = loadSnapshot(state, "unprotect", "end");
  return {
    record: "seal.cc-before-after/v1",
    synthetic: state.synthetic,
    ...(state.synthetic ? { banner: SYNTHETIC_BANNER } : {}),
    project_file: {
      path: path.join(state.paths.project, ".mcp.json"),
      before_protect: state.project.mcp_json_before_protect,
      after_protect: state.project.mcp_json_after_protect,
      after_unprotect: last?.mcp_json ?? null,
      byte_identical_before_protect_and_after_unprotect:
        Boolean(last && last.mcp_json.sha256 === state.project.mcp_json_before_protect.sha256 &&
          last.mcp_json.bytes === state.project.mcp_json_before_protect.bytes),
    },
    local_override: {
      after_protect: state.local_override_after_protect,
      before_unprotect: loadSnapshot(state, "unprotect", "begin")?.local_override.entry ?? null,
      after_unprotect: last?.local_override.entry ?? null,
    },
    installed_tree: {
      sha256: state.artifact.installed_tree_sha256,
      version: state.artifact.version,
      store: state.paths.store,
      seal_version_at_first_snapshot: first?.seal_version ?? null,
      seal_version_at_last_snapshot: last?.seal_version ?? null,
    },
    effect_file: {
      path: state.paths.effect,
      final: last?.effect ?? null,
      final_text: last?.effect_text ?? null,
      expected_after_one_accepted_call: sha256(Buffer.from(`${NOTES.accept}\n`, "utf8")),
    },
    protection_state: {
      path: state.paths.protectState,
      at_last_snapshot: last?.protection_state ?? null,
    },
    seal_doctor_at_init: state.doctor,
    protect_output: state.protect.output,
    unprotect_output: (state.steps.unprotect || {}).output ?? null,
  };
}

function finish(state, options) {
  const observations = observeAll(state);
  const missing = observations.filter((entry) => entry.result !== "OBSERVED").map((entry) => entry.case);
  if (missing.length) {
    refuse("finish_cannot_certify", `CANNOT CERTIFY evidence pack; missing cases: ${missing.join(", ")}. No evidence pack was written.`);
  }
  const outRoot = path.resolve(options.out || path.join(state.paths.run, "pack"));
  const packDir = path.join(outRoot, "evidence", "claude-code", state.claude.version, "linux-x64", state.artifact.sha256);
  fs.mkdirSync(path.join(packDir, "receipts"), { recursive: true });

  // A synthetic pack carries its disclaimer as a FILE beside the manifest, in
  // the manifest's `synthetic` field, in the client version that names the
  // directory, and as a banner line inside every derived record. Removing one
  // marker does not launder the pack; the checker refuses on any of them.
  if (state.synthetic) {
    fs.writeFileSync(path.join(packDir, SYNTHETIC_MARKER_FILE), [
      SYNTHETIC_BANNER,
      "",
      "This pack was produced by harness/claude-code/synthetic-run.cjs against a",
      "scripted stand-in client. No Claude Code process was involved. It exists to",
      "exercise the harness and the checker, and it is refused by",
      "`scripts/check-cc-evidence.mjs` in release mode.",
      "",
    ].join("\n"));
  }

  fs.writeFileSync(path.join(packDir, "proxy.jsonl"), proxyRecord(state));
  fs.writeFileSync(path.join(packDir, "child.jsonl"), childRecord(state));
  writeJson(path.join(packDir, "before-after.json"), beforeAfter(state));
  writeJson(path.join(packDir, "snapshots.json"), {
    record: "seal.cc-snapshots/v1",
    synthetic: state.synthetic,
    ...(state.synthetic ? { banner: SYNTHETIC_BANNER } : {}),
    note: "Per-case boundary readings. Each child_log entry names the line count and digest of child.jsonl at that boundary; the records themselves are in child.jsonl, which this pack carries whole.",
    snapshots: CASES.flatMap((item) => ["begin", "end"]
      .map((edge) => {
        const taken = loadSnapshot(state, item.id, edge);
        if (!taken) return null;
        const { records, ...childLog } = taken.child_log;
        return { case: item.id, edge, snapshot: { ...taken, child_log: childLog } };
      })
      .filter(Boolean)),
  });
  try { fs.copyFileSync(state.paths.storePath, path.join(packDir, "approvals.journal")); } catch { /* named absent in the manifest below */ }
  const receiptNames = (() => { try { return fs.readdirSync(state.paths.receiptsDir).filter((name) => name.endsWith(".json")).sort(); } catch { return []; } })();
  for (const name of receiptNames) fs.copyFileSync(path.join(state.paths.receiptsDir, name), path.join(packDir, "receipts", name));

  const castFiles = [];
  for (const step of STEPS) {
    if (!step.record) continue;
    const source = path.join(state.paths.logs, `${step.record.caseId}.cast`);
    if (!fs.existsSync(source)) continue;
    // The accept session carries the dialog that was approved, so it is the
    // pack's `terminal.cast`; the other sessions sit beside it under their
    // case names.
    const target = step.record.caseId === "accept" ? "terminal.cast" : `terminal-${step.record.caseId.replace(/_/g, "-")}.cast`;
    fs.copyFileSync(source, path.join(packDir, target));
    castFiles.push({ file: target, case: step.record.caseId });
  }

  const files = [];
  for (const entry of fs.readdirSync(packDir, { withFileTypes: true })) {
    if (entry.name === "manifest.json") continue;
    if (entry.isDirectory()) {
      for (const name of fs.readdirSync(path.join(packDir, entry.name)).sort()) {
        files.push({ path: `${entry.name}/${name}`, ...digestOf(path.join(packDir, entry.name, name)) });
      }
      continue;
    }
    files.push({ path: entry.name, ...digestOf(path.join(packDir, entry.name)) });
  }
  files.sort((a, b) => (a.path < b.path ? -1 : 1));

  const manifest = {
    manifest: MANIFEST_SCHEMA,
    synthetic: state.synthetic,
    ...(state.synthetic ? { synthetic_banner: SYNTHETIC_BANNER } : {}),
    recorded_at: new Date().toISOString(),
    artifact: {
      name: state.artifact.name,
      sha256: state.artifact.sha256,
      bytes: state.artifact.bytes,
      installed_tree_sha256: state.artifact.installed_tree_sha256,
      version: state.artifact.version,
    },
    client: {
      name: state.claude.name,
      version: state.claude.version,
      version_output: state.claude.version_output,
      executable: state.claude.executable,
      executable_sha256: state.claude.sha256,
      selection_method: state.claude.selection_method,
      ...(state.claude.candidates ? { candidates: state.claude.candidates } : {}),
      executable_format: state.claude.executable_format,
    },
    environment: {
      platform: "linux-x64",
      os_release: os.release(),
      node: process.version,
      home: state.paths.home,
      xdg_data_home: state.paths.data,
      project: state.paths.project,
      recorder: "util-linux script → asciinema cast v2",
      recordings: castFiles,
    },
    fixture: {
      path: "harness/claude-code/fixture-server.cjs",
      sha256: state.fixture.sha256,
      bytes: state.fixture.bytes,
      server_name: SERVER_NAME,
      guarded_tool: GUARDED_TOOL,
      open_tool: OPEN_TOOL,
      notes: NOTES,
    },
    harness: state.harness,
    limitations: [
      "The harness cannot establish that a human rather than the client originated the decline.",
      "Binding is bookkeeping, not a control: a determined author with local file access can rewrite recorder sources, timing, cast, and harness state consistently. This detects mistakes, not forgery.",
    ],
    expected_cases: CASES,
    observed: observations,
    files,
    label: labelFor(state, observations),
  };
  writeJson(path.join(packDir, "manifest.json"), manifest);

  say("");
  say(`Evidence pack written: ${packDir}`);
  for (const entry of observations) say(`  ${entry.result === "OBSERVED" ? "OBSERVED    " : "NOT OBSERVED"} ${entry.case}`);
  say("");
  for (const line of manifest.label.split("\n")) say(line);
  say("");
  say("Read terminal.cast before you publish this pack: it is a verbatim capture of your terminal.");
  say(`Check it: node scripts/check-cc-evidence.mjs ${packDir}${state.synthetic ? " --allow-synthetic" : ""}`);
  return packDir;
}

// ------------------------------------------------------------------- plumbing

function parseFlags(argv, allowed) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (!flag.startsWith("--")) refuse("usage", `unexpected argument ${flag}`);
    const name = flag.slice(2);
    if (!allowed.includes(name)) refuse("usage", `unknown flag --${name}`);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) {
      options[name] = true;
      continue;
    }
    options[name] = value;
    index += 1;
  }
  return options;
}

function main(argv) {
  const command = argv[0];
  if (!command || command === "--help" || command === "-h") {
    say("cc-harness — the Claude Code acceptance harness\n");
    say("  cc-harness init --artifact FILE --sha256 HEX --bytes N --run-dir DIR [--client PATH]");
    say("  cc-harness plan   --run-dir DIR");
    say("  cc-harness show   --run-dir DIR");
    say("  cc-harness next   --run-dir DIR");
    say("  cc-harness finish --run-dir DIR [--out DIR]");
    return;
  }
  if (command === "init") {
    const initArgs = argv.slice(1);
    try { init(initArgs); }
    catch (error) {
      const runIndex = initArgs.indexOf("--run-dir");
      const supplied = runIndex >= 0 ? initArgs[runIndex + 1] : null;
      if (supplied && error instanceof Error) {
        const runDir = path.resolve(supplied);
        if (fs.existsSync(runDir) && fs.readdirSync(runDir).length > 0 && !error.message.includes("Recover this run directory with:")) {
          error.message = `${error.message}\n${recoveryGuidance(runDir)}`;
        }
      }
      throw error;
    }
    return;
  }
  const options = parseFlags(argv.slice(1), ["run-dir", "out"]);
  const runDir = path.resolve(options["run-dir"] || process.env.SEAL_CC_RUN_DIR || "");
  if (!options["run-dir"] && !process.env.SEAL_CC_RUN_DIR) refuse("usage", `cc-harness ${command} needs --run-dir`);
  const state = loadState(runDir);
  if (command === "plan") return plan(state);
  if (command === "show") return show(state);
  if (command === "next") return next(state);
  if (command === "finish") { finish(state, options); return; }
  refuse("usage", `unknown command ${command}`);
}

if (require.main === module) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    if (error instanceof HarnessError) {
      process.stderr.write(`REFUSE ${error.code}: ${error.message}\n`);
      process.exit(1);
    }
    throw error;
  }
}

module.exports = {
  CASES,
  castFromScript,
  clientExecutableFormat,
  clientCandidates,
  clientIdentity,
  digestOf,
  GUARDED_TOOL,
  HarnessError,
  NOTES,
  SERVER_NAME,
  SYNTHETIC_BANNER,
  SYNTHETIC_MARKER_FILE,
  finish,
  init,
  loadState,
  next,
  observeAll,
  nonProxyStarts,
  proxyEvidenceForStart,
  runEnv,
  saveState,
  show,
  takeSnapshot,
  waitForEnter,
};
