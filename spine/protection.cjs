// SPDX-License-Identifier: Apache-2.0
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const readline = require("node:readline");

const STATE_SCHEMA = "seal.protect/v1";
const STATES = Object.freeze({
  UNPROTECTED: "UNPROTECTED",
  PENDING_RESTART: "PENDING RESTART",
  ACTIVE: "ACTIVE",
  DRIFTED: "DRIFTED",
  BROKEN: "BROKEN",
});

function sealVersion() {
  return require("./version.cjs").requireMatchingVersion();
}

class ProtectionError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
    this.refusal = true;
  }
}

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function realProjectRoot(projectRoot) {
  const root = path.resolve(projectRoot || process.cwd());
  try { return fs.realpathSync(root); } catch { return root; }
}

function dataHome(env = process.env) {
  return env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share");
}

function projectId(projectRoot) {
  return sha256(realProjectRoot(projectRoot)).slice(0, 32);
}

function projectDirectory(projectRoot, env = process.env) {
  return path.join(dataHome(env), "seal", "projects", projectId(projectRoot));
}

function statePathFor(projectRoot, env = process.env) {
  return path.join(projectDirectory(projectRoot, env), "state.json");
}

function mcpJsonPath(projectRoot) {
  return path.join(realProjectRoot(projectRoot), ".mcp.json");
}

function readProjectConfig(projectRoot) {
  const filePath = mcpJsonPath(projectRoot);
  let bytes;
  try {
    bytes = fs.readFileSync(filePath);
  } catch (error) {
    if (error.code === "ENOENT") throw new ProtectionError("project_server_absent", `project .mcp.json is absent: ${filePath}`);
    throw new ProtectionError("project_server_invalid", `project .mcp.json cannot be read: ${error.message}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    throw new ProtectionError("project_server_invalid", `project .mcp.json is not valid JSON: ${error.message}`);
  }
  if (!parsed || typeof parsed !== "object" || !parsed.mcpServers || typeof parsed.mcpServers !== "object") {
    throw new ProtectionError("project_server_absent", "project .mcp.json has no mcpServers object");
  }
  return { filePath, bytes, parsed, hash: sha256(bytes) };
}

function readProjectServer(projectRoot, serverName) {
  const config = readProjectConfig(projectRoot);
  const server = config.parsed.mcpServers[serverName];
  if (!server) throw new ProtectionError("project_server_absent", `project server "${serverName}" is absent from .mcp.json`);
  if (!server || typeof server !== "object" || Array.isArray(server)) {
    throw new ProtectionError("project_server_invalid", `project server "${serverName}" is not an object`);
  }
  const type = server.type || "stdio";
  if (type !== "stdio") throw new ProtectionError("project_server_non_stdio", `project server "${serverName}" is ${type}, not stdio`);
  if (typeof server.command !== "string" || server.command.length === 0) {
    throw new ProtectionError("project_server_invalid", `project server "${serverName}" has no stdio command`);
  }
  if (server.args !== undefined && !Array.isArray(server.args)) {
    throw new ProtectionError("project_server_invalid", `project server "${serverName}" args must be an array`);
  }
  if (server.env !== undefined && (!server.env || typeof server.env !== "object" || Array.isArray(server.env))) {
    throw new ProtectionError("project_server_invalid", `project server "${serverName}" env must be an object`);
  }
  return {
    ...config,
    server,
    serverDigest: sha256(Buffer.from(canonical(server))),
    childArgv: [server.command, ...(server.args || []).map(String)],
    childEnv: Object.fromEntries(Object.entries(server.env || {}).map(([key, value]) => [key, String(value)])),
  };
}

function readState(statePath) {
  let state;
  try {
    state = JSON.parse(fs.readFileSync(statePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw new ProtectionError("state_broken", `stored protection state is unreadable: ${error.message}`);
  }
  if (!state || typeof state !== "object" || state.schema !== STATE_SCHEMA) {
    throw new ProtectionError("incompatible_state", `stored protection state has schema ${JSON.stringify(state && state.schema)}, not ${STATE_SCHEMA}`);
  }
  if (state.sealVersion !== sealVersion()) {
    throw new ProtectionError("incompatible_state", "stored protection state is from another binary version");
  }
  return state;
}

function writeState(statePath, state) {
  fs.mkdirSync(path.dirname(statePath), { recursive: true, mode: 0o700 });
  const temporary = `${statePath}.tmp-${process.pid}`;
  fs.writeFileSync(temporary, JSON.stringify(state, null, 2) + "\n", { mode: 0o600 });
  fs.renameSync(temporary, statePath);
}

function runClaude(args, env = process.env, cwd = process.cwd()) {
  const result = spawnSync("claude", args, { cwd, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  return { code: result.status === null ? 1 : result.status, stdout: result.stdout || "", stderr: result.stderr || "", error: result.error };
}

function localOverrideIsAbsent(result, serverName) {
  // Claude Code reports this exact scoped diagnostic for a failed remove when
  // the requested local override does not exist. Keep this intentionally
  // narrow: a changed or unrelated failure must still refuse loudly.
  const absent = `No MCP server named "${serverName}" in local scope`;
  return !result.error && result.code === 1 && `${result.stdout}\n${result.stderr}`.trim() === absent;
}

function localOverrideExists(serverName, projectRoot = process.cwd(), env = process.env) {
  const result = runClaude(["mcp", "get", serverName], env, projectRoot);
  if (result.error && result.error.code === "ENOENT") return false;
  const output = `${result.stdout}\n${result.stderr}`;
  return result.code === 0 && /^  Scope: Local config /m.test(output);
}

function assertNoLocalOverride(serverName, projectRoot = process.cwd(), env = process.env) {
  const result = runClaude(["mcp", "get", serverName], env, projectRoot);
  if (result.error && result.error.code === "ENOENT") {
    throw new ProtectionError("claude_unavailable", "claude command is not available");
  }
  if (result.code !== 0) return;
  if (/^  Scope: Local config /m.test(`${result.stdout}\n${result.stderr}`)) {
    throw new ProtectionError("local_override_exists", `local Claude Code MCP override already exists for "${serverName}"`);
  }
}

function observedNames(names) {
  return names.length === 0 ? "(none)" : names.join(", ");
}

// Start the configured stdio server with the same argv, working directory and
// environment overlay used by the proxy, then perform the MCP handshake Seal
// relies on before claiming that a named tool is protected.
function listServerTools({ childArgv, childEnv, projectRoot, env = process.env, timeoutMs = 5000 }) {
  return new Promise((resolve, reject) => {
    const child = spawn(childArgv[0], childArgv.slice(1), {
      cwd: projectRoot,
      stdio: ["pipe", "pipe", "pipe"],
      env: childEnv ? { ...env, ...childEnv } : env,
    });
    let phase = "start";
    let settled = false;
    let stderr = "";
    let timer;
    let listId = 2;
    const namesFound = new Set();
    const cursorsSeen = new Set();

    const detail = () => stderr.trim() ? ` (${stderr.trim().slice(0, 500)})` : "";
    const stop = () => {
      clearTimeout(timer);
      try { child.stdin.end(); } catch {}
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
    };
    const fail = (code, message) => {
      if (settled) return;
      settled = true;
      stop();
      reject(new ProtectionError(code, message));
    };
    const arm = (code, message) => {
      clearTimeout(timer);
      timer = setTimeout(() => fail(code, `${message} after ${timeoutMs}ms${detail()}`), timeoutMs);
      timer.unref();
    };
    const send = (frame) => child.stdin.write(JSON.stringify(frame) + "\n");

    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => { if (stderr.length < 2000) stderr += chunk; });
    child.stdin.on("error", (error) => {
      if (settled) return;
      const code = phase === "initialize" ? "protected_server_initialize_failed" : "protected_server_tools_list_failed";
      fail(code, `configured server input failed during ${phase}: ${error.message}${detail()}`);
    });
    child.once("error", (error) => {
      fail("protected_server_start_failed", `configured server could not start: ${error.message}`);
    });
    child.once("spawn", () => {
      phase = "initialize";
      send({
        jsonrpc: "2.0", id: 1, method: "initialize", params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "seal-protect", version: sealVersion() },
        },
      });
      arm("protected_server_initialize_failed", "configured server did not answer initialize");
    });
    child.once("close", (code, signal) => {
      if (settled) return;
      const ending = signal ? `signal ${signal}` : `exit ${code}`;
      if (phase === "start") fail("protected_server_start_failed", `configured server did not start (${ending})${detail()}`);
      else if (phase === "initialize") fail("protected_server_initialize_failed", `configured server closed during initialize (${ending})${detail()}`);
      else fail("protected_server_tools_list_failed", `configured server closed during tools/list (${ending})${detail()}`);
    });

    const lines = readline.createInterface({ input: child.stdout, terminal: false });
    lines.on("line", (line) => {
      if (settled || line.trim() === "") return;
      let frame;
      try { frame = JSON.parse(line); } catch {
        const code = phase === "initialize" ? "protected_server_initialize_failed" : "protected_server_tools_list_failed";
        fail(code, `configured server returned non-JSON during ${phase}${detail()}`);
        return;
      }
      if (phase === "initialize" && frame.id === 1) {
        if (frame.error || !frame.result || typeof frame.result !== "object") {
          fail("protected_server_initialize_failed", `configured server refused or malformed initialize: ${JSON.stringify(frame.error || frame.result)}${detail()}`);
          return;
        }
        phase = "tools/list";
        send({ jsonrpc: "2.0", method: "notifications/initialized", params: {} });
        send({ jsonrpc: "2.0", id: listId, method: "tools/list", params: {} });
        arm("protected_server_tools_list_failed", "configured server did not answer tools/list");
        return;
      }
      if (phase === "tools/list" && frame.id === listId) {
        if (frame.error || !frame.result || !Array.isArray(frame.result.tools)) {
          fail("protected_server_tools_list_failed", `configured server refused or malformed tools/list: ${JSON.stringify(frame.error || frame.result)}${detail()}`);
          return;
        }
        for (const tool of frame.result.tools) {
          if (tool && typeof tool.name === "string" && tool.name.length > 0) namesFound.add(tool.name);
        }
        const cursor = frame.result.nextCursor;
        if (typeof cursor === "string" && cursor.length > 0) {
          if (cursorsSeen.has(cursor)) {
            fail("protected_server_tools_list_failed", `configured server repeated tools/list cursor ${JSON.stringify(cursor)}`);
            return;
          }
          cursorsSeen.add(cursor);
          listId += 1;
          send({ jsonrpc: "2.0", id: listId, method: "tools/list", params: { cursor } });
          arm("protected_server_tools_list_failed", "configured server did not answer paginated tools/list");
          return;
        }
        const names = [...namesFound].sort();
        if (names.length === 0) {
          fail("protected_server_tools_empty", "configured server returned no named tools from tools/list");
          return;
        }
        settled = true;
        stop();
        resolve(names);
      }
    });
  });
}

function livePid(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function stateWithProject(projectRoot, env = process.env) {
  const root = realProjectRoot(projectRoot);
  const filePath = statePathFor(root, env);
  return { root, filePath, state: readState(filePath) };
}

function protectionView(state) {
  if (!state || state.state === STATES.UNPROTECTED) return { state: STATES.UNPROTECTED };
  if (state.state === STATES.ACTIVE && !livePid(state.lease?.pid)) {
    return {
      ...state,
      state: STATES.PENDING_RESTART,
      detail: "previous wrapper lease pid is not live; restart Claude Code to activate the local override",
    };
  }
  return state;
}

async function protect({ serverName, guardTool, projectRoot = process.cwd(), sealBin = process.argv[1], env = process.env }) {
  if (!serverName || !guardTool) throw new ProtectionError("usage", "usage: seal protect SERVER TOOL");
  const root = realProjectRoot(projectRoot);
  const statePath = statePathFor(root, env);
  const existing = readState(statePath);
  if (existing && existing.state !== STATES.UNPROTECTED) {
    if (existing.sealVersion && existing.sealVersion !== sealVersion()) {
      throw new ProtectionError("incompatible_state", "stored protection state is from another binary version");
    }
    throw new ProtectionError("already_protected", `project is already ${existing.state}`);
  }
  const project = readProjectServer(root, serverName);
  assertNoLocalOverride(serverName, root, env);
  const toolNames = await listServerTools({
    childArgv: project.childArgv,
    childEnv: project.childEnv,
    projectRoot: root,
    env,
  });
  if (!toolNames.includes(guardTool)) {
    throw new ProtectionError(
      "protected_tool_absent",
      `requested tool "${guardTool}" was not returned by tools/list; observed tools: ${observedNames(toolNames)}`,
    );
  }

  const directory = path.dirname(statePath);
  const storePath = path.join(directory, "approvals.journal");
  const receiptsDir = path.join(directory, "receipts");
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  if (!fs.existsSync(storePath)) fs.writeFileSync(storePath, "", { mode: 0o600 });
  fs.mkdirSync(receiptsDir, { recursive: true, mode: 0o700 });

  const state = {
    schema: STATE_SCHEMA,
    sealVersion: sealVersion(),
    state: STATES.PENDING_RESTART,
    projectRoot: root,
    projectId: projectId(root),
    serverName,
    guardTool,
    mcpJsonPath: project.filePath,
    mcpJsonHashAtProtect: project.hash,
    projectServerDigest: project.serverDigest,
    projectServer: project.server,
    childArgv: project.childArgv,
    childEnv: project.childEnv,
    storePath,
    receiptsDir,
    protectedAt: new Date().toISOString(),
    lease: null,
  };
  writeState(statePath, state);

  const install = runClaude([
    "mcp", "add", "--scope", "local", serverName,
    "--", sealBin, "__proxy", "--protect-state", statePath,
  ], env, root);
  if (install.error || install.code !== 0) {
    writeState(statePath, { ...state, state: STATES.BROKEN, brokenReason: install.error ? install.error.message : (install.stderr || install.stdout).trim() });
    throw new ProtectionError("claude_install_failed", `Claude Code local override install failed: ${(install.stderr || install.stdout || install.error?.message || "").trim()}`);
  }
  return { statePath, beforeHash: project.hash, state, toolNames };
}

function unprotect({ serverName, projectRoot = process.cwd(), env = process.env }) {
  if (!serverName) throw new ProtectionError("usage", "usage: seal unprotect SERVER");
  const root = realProjectRoot(projectRoot);
  const statePath = statePathFor(root, env);
  const state = readState(statePath);
  if (state && state.sealVersion && state.sealVersion !== sealVersion()) {
    throw new ProtectionError("incompatible_state", "stored protection state is from another binary version");
  }
  if (state?.lease?.pid && livePid(state.lease.pid)) {
    throw new ProtectionError("active_claude_session", `active Claude session is using "${serverName}"; stop it before unprotect`);
  }
  const before = readProjectConfig(root).hash;
  const remove = runClaude(["mcp", "remove", "--scope", "local", serverName], env, root);
  if (remove.error || (remove.code !== 0 && !localOverrideIsAbsent(remove, serverName))) {
    throw new ProtectionError("claude_remove_failed", `Claude Code local override removal failed: ${(remove.stderr || remove.stdout || remove.error?.message || "").trim()}`);
  }
  const after = readProjectConfig(root).hash;
  if (state) writeState(statePath, { ...state, state: STATES.UNPROTECTED, lease: null, unprotectedAt: new Date().toISOString(), mcpJsonHashAtUnprotect: after });
  return { beforeHash: before, afterHash: after, statePath };
}

function markDrifted(statePath, state, gotDigest) {
  const next = { ...state, state: STATES.DRIFTED, drift: { expected: state.projectServerDigest, got: gotDigest, at: new Date().toISOString() } };
  writeState(statePath, next);
  return next;
}

function currentDigestForState(state) {
  try {
    return readProjectServer(state.projectRoot, state.serverName).serverDigest;
  } catch {
    return null;
  }
}

function markBroken(statePath, state, error) {
  const next = { ...state, state: STATES.BROKEN, brokenReason: `${error.code || "activation_failed"}: ${error.message}`, lease: null };
  writeState(statePath, next);
  return next;
}

async function activationLease(statePath, env = process.env) {
  const state = readState(statePath);
  if (!state) throw new ProtectionError("state_broken", "protection state is absent");
  const childCommand = state.childArgv && state.childArgv[0];
  if (childCommand && (childCommand.includes(path.sep) || childCommand.startsWith(".")) && !fs.existsSync(childCommand)) {
    throw new ProtectionError("protected_server_missing", `protected server command is missing: ${childCommand}`);
  }
  const got = currentDigestForState(state);
  if (got !== state.projectServerDigest) {
    markDrifted(statePath, state, got);
    throw new ProtectionError("drifted", "project server drifted before proxy activation");
  }
  let toolNames;
  try {
    toolNames = await listServerTools({
      childArgv: state.childArgv,
      childEnv: state.childEnv,
      projectRoot: state.projectRoot,
      env,
    });
  } catch (error) {
    markBroken(statePath, state, error);
    throw error;
  }
  if (!toolNames.includes(state.guardTool)) {
    const error = new ProtectionError(
      "protected_tool_vanished",
      `protected tool "${state.guardTool}" vanished before activation; observed tools: ${observedNames(toolNames)}`,
    );
    markBroken(statePath, state, error);
    throw error;
  }
  const next = {
    ...state,
    state: STATES.ACTIVE,
    lease: { pid: process.pid, startedAt: new Date().toISOString() },
  };
  writeState(statePath, next);
  return next;
}

function beforeForwardFromState(statePath) {
  return () => {
    const state = readState(statePath);
    if (!state) return { ok: false, refusal: "state_absent", detail: "protection state is absent" };
    const got = currentDigestForState(state);
    if (got !== state.projectServerDigest) {
      markDrifted(statePath, state, got);
      return { ok: false, refusal: "project_server_drifted", detail: "project .mcp.json server changed since protect; run seal status" };
    }
    return { ok: true };
  };
}

function doctor(env = process.env) {
  const hook = env.SEAL_ELICITATION_AUTO_RESPONSE || env.CLAUDE_ELICITATION_AUTO_RESPONSE;
  if (hook) {
    return {
      ok: false,
      code: "elicitation_hook_configured",
      text: "REFUSED\n  Claude Code can automatically answer elicitation requests.\n  Human approval origin cannot be assumed in this configuration.\nREFUSE elicitation_hook_configured: an auto-response hook is set; human approval origin cannot be assumed\n",
    };
  }
  return {
    ok: true,
    text: "ASSUMPTION\n  Claude Code presents approval requests to a human and faithfully returns\n  the response. Seal cannot distinguish a human click from client-generated\n  acceptance.\n",
  };
}

module.exports = {
  ProtectionError,
  STATES,
  activationLease,
  beforeForwardFromState,
  dataHome,
  doctor,
  localOverrideExists,
  listServerTools,
  protect,
  protectionView,
  projectDirectory,
  projectId,
  readProjectServer,
  readState,
  realProjectRoot,
  statePathFor,
  stateWithProject,
  unprotect,
};
