#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
//
// The Claude Code acceptance fixture: a stdio MCP server built to be
// WITNESSED rather than to be useful. Every frame it receives is appended to
// an append-only NDJSON log and fsynced BEFORE it answers, so the child-call
// count is counted out of the file afterwards instead of being taken on this
// process's word. Nothing here reports a count; the file carries one record
// per call and the reader counts records.
//
// Two properties the acceptance run needs and this fixture provides:
//
//   1. Every guarded call leaves a durable `child-call` record carrying the
//      exact arguments and the resulting effect digest. Zero calls therefore
//      look like zero records, not like a silent success.
//   2. Every start leaves the process ancestry it was launched under
//      (/proc, Linux only). That is how the run distinguishes "Claude Code
//      started the Seal proxy, which started me" from "Claude Code started
//      me directly out of .mcp.json" — the fallback the run must rule out.
//
// Silence must fail: with no log path configured this fixture refuses to run
// at all, so a misconfigured run can never be mistaken for an unexercised one.
const crypto = require("node:crypto");
const fs = require("node:fs");
const readline = require("node:readline");

const FIXTURE_SCHEMA = "seal.cc-fixture/v1";
const GUARDED_TOOL = "append_note";
const OPEN_TOOL = "read_notes";
const PROTOCOL_VERSION = "2025-06-18";
const MAX_RECORDED_LINE = 4096;

function refuse(code, reason) {
  process.stderr.write(`REFUSE ${code}: ${reason}\n`);
  process.exit(3);
}

const logPath = process.env.SEAL_CC_FIXTURE_LOG;
const effectPath = process.env.SEAL_CC_FIXTURE_EFFECT;
if (!logPath) refuse("fixture_log_unset", "SEAL_CC_FIXTURE_LOG names the append-only frame log; this fixture never runs unrecorded");
if (!effectPath) refuse("fixture_effect_unset", "SEAL_CC_FIXTURE_EFFECT names the effect file the guarded tool writes");

let recordNumber = 0;

function appendRecord(record) {
  recordNumber += 1;
  const line = JSON.stringify({
    fixture: FIXTURE_SCHEMA,
    n: recordNumber,
    pid: process.pid,
    at: new Date().toISOString(),
    ...record,
  }) + "\n";
  let fd;
  try {
    fd = fs.openSync(logPath, "a", 0o600);
  } catch (error) {
    refuse("fixture_log_unwritable", `append-only frame log cannot be opened: ${logPath}: ${error.message}`);
  }
  try {
    fs.writeSync(fd, line);
    fs.fsyncSync(fd);
  } catch (error) {
    refuse("fixture_log_unwritable", `append-only frame log could not be appended: ${logPath}: ${error.message}`);
  } finally {
    fs.closeSync(fd);
  }
}

function commandLine(pid) {
  try {
    return fs.readFileSync(`/proc/${pid}/cmdline`, "utf8").split("\0").filter(Boolean);
  } catch {
    return null;
  }
}

function parentOf(pid) {
  try {
    const match = /^PPid:\s*(\d+)$/m.exec(fs.readFileSync(`/proc/${pid}/status`, "utf8"));
    return match ? Number(match[1]) : null;
  } catch {
    return null;
  }
}

// The launcher chain, nearest parent first. Recorded as data, never judged
// here: the checker decides what a Seal-mediated chain looks like.
function ancestry(pid, depth = 8) {
  const chain = [];
  let current = parentOf(pid);
  while (current && current > 1 && chain.length < depth) {
    chain.push({ pid: current, argv: commandLine(current) });
    current = parentOf(current);
  }
  return chain;
}

function digestOf(filePath) {
  try {
    const bytes = fs.readFileSync(filePath);
    return { sha256: crypto.createHash("sha256").update(bytes).digest("hex"), bytes: bytes.length };
  } catch {
    return { sha256: null, bytes: null };
  }
}

function writeEffect(text) {
  const fd = fs.openSync(effectPath, "a", 0o600);
  try {
    fs.writeSync(fd, text);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

function send(frame) {
  process.stdout.write(JSON.stringify(frame) + "\n");
}

const TOOLS = [
  {
    name: GUARDED_TOOL,
    description: "Append one note line to the fixture's effect file.",
    inputSchema: { type: "object", properties: { note: { type: "string" } }, required: ["note"] },
  },
  {
    name: OPEN_TOOL,
    description: "Read the fixture's effect file. Deliberately left outside Seal.",
    inputSchema: { type: "object", properties: {} },
  },
];

appendRecord({
  kind: "start",
  argv: process.argv,
  cwd: process.cwd(),
  ppid: process.ppid,
  ancestry: ancestry(process.pid),
  effect: { path: effectPath, ...digestOf(effectPath) },
});

let guardedCalls = 0;

const input = readline.createInterface({ input: process.stdin, terminal: false });
input.on("line", (line) => {
  if (line.trim() === "") return;
  appendRecord({ kind: "frame", raw: line.slice(0, MAX_RECORDED_LINE), truncated: line.length > MAX_RECORDED_LINE });
  let frame;
  try {
    frame = JSON.parse(line);
  } catch {
    appendRecord({ kind: "unparseable" });
    return;
  }
  if (frame.method === "initialize") {
    send({
      jsonrpc: "2.0",
      id: frame.id,
      result: {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: "seal-cc-acceptance-fixture", version: FIXTURE_SCHEMA },
      },
    });
    return;
  }
  if (frame.method === "tools/list") {
    send({ jsonrpc: "2.0", id: frame.id, result: { tools: TOOLS } });
    return;
  }
  if (frame.method === "tools/call") {
    const name = frame.params?.name;
    const args = frame.params?.arguments ?? {};
    if (name === GUARDED_TOOL) {
      // The guarded call reached the child. That is the one fact the whole
      // acceptance run turns on, so it is journaled before the reply.
      guardedCalls += 1;
      const note = typeof args.note === "string" ? args.note : JSON.stringify(args.note ?? null);
      writeEffect(`${note}\n`);
      appendRecord({
        kind: "child-call",
        tool: name,
        call_index: guardedCalls,
        arguments: args,
        effect: { path: effectPath, ...digestOf(effectPath) },
      });
      send({ jsonrpc: "2.0", id: frame.id, result: { content: [{ type: "text", text: `appended: ${note}` }] } });
      return;
    }
    if (name === OPEN_TOOL) {
      let text = "";
      try { text = fs.readFileSync(effectPath, "utf8"); } catch { text = ""; }
      appendRecord({ kind: "open-tool-call", tool: name });
      send({ jsonrpc: "2.0", id: frame.id, result: { content: [{ type: "text", text }] } });
      return;
    }
    appendRecord({ kind: "unknown-tool-call", tool: name });
    send({ jsonrpc: "2.0", id: frame.id, error: { code: -32602, message: `unknown tool: ${name}` } });
    return;
  }
  if (typeof frame.id !== "undefined" && frame.method) {
    send({ jsonrpc: "2.0", id: frame.id, error: { code: -32601, message: `unsupported method: ${frame.method}` } });
  }
});

input.on("close", () => {
  appendRecord({ kind: "exit", guarded_calls_seen: guardedCalls });
});
