#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
//
// A SCRIPTED STAND-IN FOR CLAUDE CODE. NOT CLAUDE CODE.
//
// This file exists to exercise the harness and the checker end to end without
// a human and without the real client. It can prove the instrument works. It
// can NEVER discharge the Claude Code integration row, because it is not the
// thing under test: it does not select the local override the way Claude Code
// does, it does not render Claude Code's dialog, and its refusal to fall back
// to `.mcp.json` is this file's own decision rather than an observation of
// Claude Code's.
//
// Every pack produced with this stand-in is marked synthetic in four
// independent places, and `scripts/check-cc-evidence.mjs --release` refuses it.
//
// It plays two roles, chosen by argv, exactly as `seal protect` expects of the
// real client:
//   `claude mcp add|get|remove ...`  — the local-override registry
//   `claude`                          — an MCP client session
const fs = require("node:fs");
const path = require("node:path");
const readline = require("node:readline");
const { spawn } = require("node:child_process");

const SYNTHETIC_BANNER = "SEAL-SYNTHETIC-FIXTURE — NOT A REAL CLAUDE CODE RUN";
const SERVER_NAME = "notes";
const GUARDED_TOOL = "append_note";
const home = process.env.HOME || process.cwd();
const project = fs.realpathSync(process.cwd());
const configPath = path.join(process.env.CLAUDE_CONFIG_DIR || home, ".claude.json");

function readConfig() {
  try { return JSON.parse(fs.readFileSync(configPath, "utf8")); } catch { return {}; }
}

function writeConfig(config) {
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
}

function localOverride(name) {
  return readConfig().projects?.[project]?.mcpServers?.[name] || null;
}

function projectServer(name) {
  try { return JSON.parse(fs.readFileSync(path.join(project, ".mcp.json"), "utf8")).mcpServers[name] || null; }
  catch { return null; }
}

// Validate the negotiated base result shape before reading extension fields.
function validateCallToolResult(result) {
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    throw new Error("MCP tools/call result failed CallToolResult schema validation: result must be an object");
  }
  if (!Object.hasOwn(result, "content")) {
    throw new Error("MCP tools/call result failed CallToolResult schema validation: content is required");
  }
  if (!Array.isArray(result.content)) {
    throw new Error("MCP tools/call result failed CallToolResult schema validation: content must be an array");
  }
  for (const [index, block] of result.content.entries()) {
    if (!block || typeof block !== "object" || Array.isArray(block)
        || block.type !== "text" || typeof block.text !== "string") {
      throw new Error(`MCP tools/call result failed CallToolResult schema validation: content[${index}] must be a text content block`);
    }
  }
}

// ------------------------------------------------------ the registry role

function registry(args) {
  if (args[1] === "get") {
    const name = args[2];
    if (localOverride(name)) {
      process.stdout.write(`${name}:\n  Scope: Local config (private to you in this project)\n  Type: stdio\n`);
      process.exit(0);
    }
    if (projectServer(name)) {
      process.stdout.write(`${name}:\n  Scope: Project config (shared via .mcp.json)\n  Type: stdio\n`);
      process.exit(0);
    }
    process.stderr.write(`No MCP server named "${name}".\n`);
    process.exit(1);
  }
  if (args[1] === "add") {
    const name = args[4];
    const split = args.indexOf("--");
    const config = readConfig();
    config.projects ||= {};
    config.projects[project] ||= {};
    config.projects[project].mcpServers ||= {};
    config.projects[project].mcpServers[name] = {
      type: "stdio",
      command: args[split + 1],
      args: args.slice(split + 2),
      env: {},
    };
    writeConfig(config);
    process.stdout.write(`Added stdio MCP server ${name} to local config\n`);
    process.exit(0);
  }
  if (args[1] === "remove") {
    const name = args[4];
    const config = readConfig();
    if (!config.projects?.[project]?.mcpServers?.[name]) {
      process.stderr.write(`No MCP server named "${name}" in local scope`);
      process.exit(1);
    }
    delete config.projects[project].mcpServers[name];
    writeConfig(config);
    process.stdout.write(`Removed MCP server ${name} from local config\n`);
    process.exit(0);
  }
  process.exit(2);
}

// -------------------------------------------------------- the client role

function connect(entry, onServerRequest) {
  const child = spawn(entry.command, entry.args || [], {
    cwd: project,
    stdio: ["pipe", "pipe", "inherit"],
    env: { ...process.env, ...(entry.env || {}) },
  });
  const pending = new Map();
  const lines = readline.createInterface({ input: child.stdout, terminal: false });
  lines.on("line", (line) => {
    let frame;
    try { frame = JSON.parse(line); } catch { return; }
    if (frame.method && Object.hasOwn(frame, "id")) {
      onServerRequest(frame, (result) => {
        child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: frame.id, result })}\n`);
      });
      return;
    }
    const request = pending.get(frame.id);
    if (request) {
      pending.delete(frame.id);
      try {
        if (request.method === "tools/call" && frame.result) validateCallToolResult(frame.result);
        request.resolve(frame);
      } catch (error) {
        request.reject(error);
      }
    }
  });
  let nextId = 0;
  return {
    child,
    request(method, params) {
      nextId += 1;
      const id = nextId;
      const waited = new Promise((resolve, reject) => {
        pending.set(id, { method, resolve, reject });
        child.once("exit", (code) => reject(new Error(`the protected server exited ${code} before answering ${method}`)));
        setTimeout(() => reject(new Error(`no answer to ${method} within 20s`)), 20000).unref();
      });
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
      return waited;
    },
    close() {
      try { child.stdin.end(); } catch { /* the child may already be gone */ }
      child.kill("SIGTERM");
    },
  };
}

async function session() {
  const scenario = process.env.SEAL_CC_SYNTHETIC_CASE || "activation";
  const note = process.env.SEAL_CC_SYNTHETIC_NOTE || "seal-accepted-note";
  process.stdout.write(`${SYNTHETIC_BANNER}\n`);
  process.stdout.write(`stand-in client session: ${scenario}\n`);

  const entry = localOverride(SERVER_NAME);
  if (!entry) {
    process.stdout.write(`no local override for "${SERVER_NAME}"; this session starts no server\n`);
    return;
  }
  process.stdout.write(`selected the local override: ${entry.command} ${(entry.args || []).join(" ")}\n`);
  if (!fs.existsSync(entry.command)) {
    // The one behaviour this stand-in cannot evidence for the real client: it
    // declines to fall back to .mcp.json because it was written to decline.
    process.stdout.write(`the local override command is missing: ${entry.command}\n`);
    process.stdout.write(`this stand-in does not fall back to the .mcp.json "${SERVER_NAME}" server\n`);
    return;
  }

  let elicitationMessage = "";
  const link = connect(entry, (frame, respond) => {
    if (frame.method !== "elicitation/create") {
      respond({ action: "cancel" });
      return;
    }
    elicitationMessage = frame.params?.message || "";
    const action = scenario === "accept" ? "accept" : "decline";
    process.stdout.write("\n");
    for (const line of elicitationMessage.split("\n")) process.stdout.write(`  ${line}\n`);
    process.stdout.write("\n");
    process.stdout.write(`the stand-in answers: ${action}\n`);
    respond(action === "accept" ? { action: "accept", content: { approve: true } } : { action: "decline" });
  });
  try {
    await link.request("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: { elicitation: {} },
      clientInfo: { name: "seal-cc-synthetic-stand-in", version: "0.0.0-synthetic-stand-in" },
    });
    const listed = await link.request("tools/list", {});
    process.stdout.write(`tools: ${(listed.result?.tools || []).map((tool) => tool.name).join(", ")}\n`);
    if (scenario === "activation") return;

    const answered = await link.request("tools/call", { name: GUARDED_TOOL, arguments: { note } });
    if (!elicitationMessage) throw new Error("the protected call did not issue elicitation/create");
    process.stdout.write(`result: ${JSON.stringify(answered.result)}\n`);
  } catch (error) {
    process.stdout.write(`session error: ${error.message}\n`);
    throw error;
  } finally {
    link.close();
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

const args = process.argv.slice(2);
if (args[0] === "--version") {
  process.stdout.write(`0.0.0-synthetic-stand-in (${SYNTHETIC_BANNER})\n`);
  process.exit(0);
}
if (args[0] === "mcp") registry(args);
session().then(() => process.exit(0), (error) => {
  process.stderr.write(`stand-in client failed: ${error.stack}\n`);
  process.exit(1);
});
