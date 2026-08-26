// SPDX-License-Identifier: Apache-2.0
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { platformSupport } = require("./platform.cjs");
const { spawn, spawnSync } = require("node:child_process");
const readline = require("node:readline");

const STATE_SCHEMA = "seal.protect/v1";
const DEFAULT_TOOL_DISCOVERY_TIMEOUT_MS = 5000;
const STATES = Object.freeze({
  UNPROTECTED: "UNPROTECTED",
  PENDING_RESTART: "PENDING RESTART",
  ACTIVE: "ACTIVE",
  STALE: "STALE",
  DRIFTED: "DRIFTED",
  BROKEN: "BROKEN",
});
const RECEIPT_KEY_CODES = Object.freeze({
  directoryInvalid: "receipt_key_directory_invalid",
  directoryPermissions: "receipt_key_directory_permissions",
  directoryUnreadable: "receipt_key_directory_unreadable",
  empty: "receipt_key_empty",
  generationFailed: "receipt_key_generation_failed",
  incomplete: "receipt_key_incomplete",
  invalid: "receipt_key_invalid",
  mismatch: "receipt_key_mismatch",
  notRegular: "receipt_key_not_regular",
  permissions: "receipt_key_permissions",
  unreadable: "receipt_key_unreadable",
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

function claudeProjectRoot(projectRoot) {
  const root = realProjectRoot(projectRoot);
  const result = spawnSync("git", ["-C", root, "rev-parse", "--show-toplevel"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  if (result.status === 0 && result.stdout.trim()) {
    try { return fs.realpathSync(result.stdout.trim()); } catch { return path.resolve(result.stdout.trim()); }
  }
  return root;
}

function dataHome(env = process.env) {
  return env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share");
}

function receiptKeyPaths(env = process.env) {
  const directory = path.join(dataHome(env), "seal", "keys");
  return {
    directory,
    privateKey: path.join(directory, "receipt-ed25519"),
    publicKey: path.join(directory, "receipt-ed25519.pub"),
  };
}

function receiptKeyStat(filePath, label) {
  let stat;
  try {
    stat = fs.lstatSync(filePath);
  } catch (error) {
    throw new ProtectionError(RECEIPT_KEY_CODES.unreadable, `${label} receipt key cannot be inspected: ${filePath}: ${error.message}`);
  }
  if (!stat.isFile()) {
    throw new ProtectionError(RECEIPT_KEY_CODES.notRegular, `${label} receipt key is not a regular file: ${filePath}`);
  }
  return stat;
}

function receiptKeyExists(filePath, label) {
  try {
    fs.lstatSync(filePath);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw new ProtectionError(RECEIPT_KEY_CODES.unreadable, `${label} receipt key cannot be inspected: ${filePath}: ${error.message}`);
  }
}

function readReceiptKey(filePath, label, expectedMode) {
  const stat = receiptKeyStat(filePath, label);
  const mode = stat.mode & 0o777;
  if ((mode & 0o400) === 0) {
    throw new ProtectionError(RECEIPT_KEY_CODES.unreadable, `${label} receipt key is unreadable: ${filePath}`);
  }
  if (mode !== expectedMode) {
    throw new ProtectionError(
      RECEIPT_KEY_CODES.permissions,
      `${label} receipt key has mode ${mode.toString(8).padStart(4, "0")}; required ${expectedMode.toString(8).padStart(4, "0")}: ${filePath}`,
    );
  }
  let bytes;
  try {
    bytes = fs.readFileSync(filePath);
  } catch (error) {
    throw new ProtectionError(RECEIPT_KEY_CODES.unreadable, `${label} receipt key cannot be read: ${filePath}: ${error.message}`);
  }
  if (bytes.length === 0 || bytes.toString("utf8").trim() === "") {
    throw new ProtectionError(RECEIPT_KEY_CODES.empty, `${label} receipt key is empty: ${filePath}`);
  }
  return bytes;
}

function writeNewReceiptKey(filePath, bytes, mode) {
  let fd;
  try {
    fd = fs.openSync(filePath, "wx", mode);
    fs.fchmodSync(fd, mode);
    fs.writeFileSync(fd, bytes);
    fs.fsyncSync(fd);
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

function loadReceiptSigner(env = process.env, announce = () => {}) {
  const locations = receiptKeyPaths(env);
  let directoryExisted;
  let directory;
  try {
    directoryExisted = fs.existsSync(locations.directory);
    fs.mkdirSync(locations.directory, { recursive: true, mode: 0o700 });
    if (!directoryExisted) fs.chmodSync(locations.directory, 0o700);
    directory = fs.lstatSync(locations.directory);
  } catch (error) {
    throw new ProtectionError(RECEIPT_KEY_CODES.directoryUnreadable, `receipt key directory cannot be used: ${locations.directory}: ${error.message}`);
  }
  if (!directory.isDirectory()) {
    throw new ProtectionError(RECEIPT_KEY_CODES.directoryInvalid, `receipt key directory is not a directory: ${locations.directory}`);
  }
  const directoryMode = directory.mode & 0o777;
  if (directoryMode !== 0o700) {
    throw new ProtectionError(
      RECEIPT_KEY_CODES.directoryPermissions,
      `receipt key directory has mode ${directoryMode.toString(8).padStart(4, "0")}; required 0700: ${locations.directory}`,
    );
  }

  const privateExists = receiptKeyExists(locations.privateKey, "private");
  const publicExists = receiptKeyExists(locations.publicKey, "public");
  if (privateExists !== publicExists) {
    throw new ProtectionError(
      RECEIPT_KEY_CODES.incomplete,
      `receipt signing key is incomplete; both files must exist or both must be absent: ${locations.privateKey}, ${locations.publicKey}`,
    );
  }

  if (!privateExists) {
    const signer = require("./receipt-seal.cjs").generateSigner();
    const privatePem = signer.privateKey.export({ type: "pkcs8", format: "pem" });
    try {
      writeNewReceiptKey(locations.privateKey, privatePem, 0o600);
      writeNewReceiptKey(locations.publicKey, `${signer.publicKeyHex}\n`, 0o644);
      const directoryFd = fs.openSync(locations.directory, "r");
      try { fs.fsyncSync(directoryFd); } finally { fs.closeSync(directoryFd); }
    } catch (error) {
      if (error instanceof ProtectionError) throw error;
      throw new ProtectionError(RECEIPT_KEY_CODES.generationFailed, `receipt signing key could not be created: ${error.message}`);
    }
    announce([
      "SEAL RECEIPT SIGNING KEY CREATED",
      `Public key: ${signer.publicKeyHex}`,
      `Public key file: ${locations.publicKey}`,
      "Record this public key somewhere this machine cannot rewrite.",
      "There is no private-key backup: losing it affects future signatures only. Never copy the private key to another machine.",
    ].join("\n") + "\n");
    return signer;
  }

  const privateBytes = readReceiptKey(locations.privateKey, "private", 0o600);
  const publicBytes = readReceiptKey(locations.publicKey, "public", 0o644);
  const publicHex = publicBytes.toString("utf8").trim();
  if (!/^[0-9a-f]{64}$/.test(publicHex)) {
    throw new ProtectionError(RECEIPT_KEY_CODES.invalid, `public receipt key is not 32-byte lowercase hex: ${locations.publicKey}`);
  }
  let privateKey;
  let publicKey;
  let derivedHex;
  try {
    privateKey = crypto.createPrivateKey(privateBytes);
    publicKey = crypto.createPublicKey(privateKey);
    derivedHex = require("./receipt-seal.cjs").publicKeyHex(publicKey);
  } catch (error) {
    throw new ProtectionError(RECEIPT_KEY_CODES.invalid, `private receipt key is invalid: ${locations.privateKey}: ${error.message}`);
  }
  if (derivedHex !== publicHex) {
    throw new ProtectionError(RECEIPT_KEY_CODES.mismatch, "public receipt key does not match the private receipt key");
  }
  return { privateKey, publicKey, publicKeyHex: publicHex };
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
  if (state.guardTools === undefined && typeof state.guardTool === "string" && state.guardTool.length > 0) {
    return { ...state, guardTools: [state.guardTool] };
  }
  return state;
}

function protectedToolNames(state) {
  if (!Array.isArray(state?.guardTools) || state.guardTools.length === 0 ||
      state.guardTools.some((name) => typeof name !== "string" || name.length === 0)) {
    throw new ProtectionError("state_broken", "stored protection state has no protected tool list");
  }
  return [...new Set(state.guardTools)];
}

function writeState(statePath, state) {
  fs.mkdirSync(path.dirname(statePath), { recursive: true, mode: 0o700 });
  const temporary = `${statePath}.tmp-${process.pid}`;
  fs.writeFileSync(temporary, JSON.stringify(state, null, 2) + "\n", { mode: 0o600 });
  fs.renameSync(temporary, statePath);
}

function ownershipRefusal(code, message = "") {
  const error = new ProtectionError(code, message);
  error.ownershipRefusal = true;
  return error;
}

function claudeConfigPath(env = process.env) {
  const directory = env.CLAUDE_CONFIG_DIR || env.HOME || os.homedir();
  return path.join(directory, ".claude.json");
}

function currentLocalOverride(projectRoot, serverName, env = process.env) {
  const localRoot = claudeProjectRoot(projectRoot);
  let config;
  try {
    config = JSON.parse(fs.readFileSync(claudeConfigPath(env), "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    const reason = error instanceof SyntaxError
      ? "SyntaxError: configuration is not valid JSON"
      : error.message || error.code || error.name || "unknown read failure";
    throw ownershipRefusal(
      "local_override_unreadable",
      `The local Claude Code configuration could not be read: ${reason}\nNo configuration was changed.`,
    );
  }
  return config?.projects?.[localRoot]?.mcpServers?.[serverName] || null;
}

function installedLocalOverride({ root, serverName, sealBin, statePath }) {
  const localRoot = claudeProjectRoot(root);
  return {
    installed: false,
    scope: "local",
    serverName,
    projectRoot: root,
    claudeProjectRoot: localRoot,
    projectId: projectId(root),
    definition: {
      type: "stdio",
      command: sealBin,
      args: ["__proxy", "--protect-state", statePath],
      env: {},
    },
  };
}

function assertSealOwnedLocalOverride(state, projectRoot, serverName, env = process.env, { allowAbsent = false } = {}) {
  const root = realProjectRoot(projectRoot);
  const owned = state?.localOverride;
  if (!state || state.state === STATES.UNPROTECTED || !owned || owned.installed !== true ||
      owned.scope !== "local" || owned.serverName !== serverName || owned.projectRoot !== root ||
      (owned.claudeProjectRoot !== undefined && owned.claudeProjectRoot !== claudeProjectRoot(root)) ||
      owned.projectId !== projectId(root) || state.serverName !== serverName ||
      state.projectRoot !== root || state.projectId !== projectId(root)) {
    throw ownershipRefusal("no_seal_owned_override");
  }
  const current = currentLocalOverride(root, serverName, env);
  if (current === null && allowAbsent) return { absent: true };
  if (current === null || canonical(current) !== canonical(owned.definition)) {
    throw ownershipRefusal(
      "local_override_drifted",
      "The current local override is not the one Seal installed.\nNo configuration was changed.",
    );
  }
  return { absent: false };
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
function listServerTools({ childArgv, childEnv, projectRoot, env = process.env, timeoutMs = DEFAULT_TOOL_DISCOVERY_TIMEOUT_MS }) {
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
      timer = setTimeout(() => fail(
        code,
        `${message} after ${timeoutMs}ms (default: ${DEFAULT_TOOL_DISCOVERY_TIMEOUT_MS}ms; increase with --timeout-ms <milliseconds>)${detail()}`,
      ), timeoutMs);
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

function processStartWitness(pid) {
  // platformSupport's test-only override lets product-path tests exercise the
  // same unavailable witness that a real non-Linux host would produce.
  if (!Number.isInteger(pid) || pid <= 0 || platformSupport().platform !== "linux") return null;
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, "utf8");
    const close = stat.lastIndexOf(")");
    if (close < 0) return null;
    const fields = stat.slice(close + 2).trim().split(/\s+/);
    // The slice starts at field 3, so field 22 is index 19.
    return fields[19] || null;
  } catch {
    return null;
  }
}

function lockPathFor(projectRoot, env = process.env) {
  return path.join(projectDirectory(projectRoot, env), "proxy.lock");
}

function lockOwnerIsLive(owner) {
  if (!owner || !livePid(owner.pid)) return false;
  const witness = processStartWitness(owner.pid);
  if (witness === null) {
    throw new ProtectionError(
      "process_witness_unavailable",
      `cannot establish process-start witness for live pid ${owner.pid}`,
    );
  }
  return owner.startWitness === witness;
}

function leaseMatches(lease, token) {
  return lease && token && lease.pid === token.pid &&
    lease.startWitness === token.startWitness && lease.generation === token.generation;
}

function acquireProjectLock(projectRoot, env = process.env) {
  const filePath = lockPathFor(projectRoot, env);
  const owner = { pid: process.pid, startWitness: processStartWitness(process.pid) };
  let recovered = false;
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  for (;;) {
    try {
      const fd = fs.openSync(filePath, "wx", 0o600);
      try {
        fs.writeSync(fd, JSON.stringify(owner) + "\n");
        fs.fsyncSync(fd);
      } finally {
        fs.closeSync(fd);
      }
      return {
        filePath,
        recovered,
        release() {
          try {
            const current = JSON.parse(fs.readFileSync(filePath, "utf8"));
            if (current.pid === owner.pid && current.startWitness === owner.startWitness) fs.unlinkSync(filePath);
          } catch (error) {
            if (error.code !== "ENOENT") throw error;
          }
        },
      };
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      let existing;
      try { existing = JSON.parse(fs.readFileSync(filePath, "utf8")); } catch { existing = null; }
      if (lockOwnerIsLive(existing)) {
        const state = readState(statePathFor(projectRoot, env));
        const generation = state?.lease?.generation ?? "unknown";
        throw new ProtectionError(
          "proxy_lease_active",
          `active lease holder pid ${existing.pid}, generation ${generation}; retry after that session exits`,
        );
      }
      try {
        fs.unlinkSync(filePath);
        recovered = true;
      } catch (unlinkError) {
        if (unlinkError.code !== "ENOENT") throw unlinkError;
      }
    }
  }
}

function stateWithProject(projectRoot, env = process.env) {
  const root = realProjectRoot(projectRoot);
  const filePath = statePathFor(root, env);
  return { root, filePath, state: readState(filePath) };
}

function protectionView(state, projectRoot, env = process.env) {
  if (!state || state.state === STATES.UNPROTECTED) return { state: STATES.UNPROTECTED };
  assertSealOwnedLocalOverride(state, projectRoot, state.serverName, env);
  if (state.state === STATES.ACTIVE && !lockOwnerIsLive(state.lease)) {
    return {
      ...state,
      state: STATES.STALE,
      detail: `previous wrapper lease is not live (generation ${state.lease?.generation ?? "unknown"}); restart Claude Code to replace it`,
    };
  }
  return state;
}

async function protect({
  serverName,
  guardTools,
  guardTool,
  projectRoot = process.cwd(),
  sealBin = process.argv[1],
  env = process.env,
  timeoutMs = DEFAULT_TOOL_DISCOVERY_TIMEOUT_MS,
}) {
  const requestedTools = [...new Set(Array.isArray(guardTools) ? guardTools : (guardTool ? [guardTool] : []))];
  if (!serverName || requestedTools.length === 0 || requestedTools.some((name) => typeof name !== "string" || name.length === 0)) {
    throw new ProtectionError("usage", "usage: seal protect SERVER TOOL [TOOL...]");
  }
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
    timeoutMs,
  });
  const missingTools = requestedTools.filter((name) => !toolNames.includes(name));
  if (missingTools.length > 0) {
    const requested = missingTools.length === 1
      ? `requested tool "${missingTools[0]}" was`
      : `requested tools ${missingTools.map((name) => `"${name}"`).join(", ")} were`;
    throw new ProtectionError(
      "protected_tool_absent",
      `${requested} not returned by tools/list; observed tools: ${observedNames(toolNames)}`,
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
    guardTools: requestedTools,
    mcpJsonPath: project.filePath,
    mcpJsonHashAtProtect: project.hash,
    projectServerDigest: project.serverDigest,
    projectServer: project.server,
    childArgv: project.childArgv,
    childEnv: project.childEnv,
    discoveryTimeoutMs: timeoutMs,
    storePath,
    receiptsDir,
    protectedAt: new Date().toISOString(),
    lease: null,
  };
  state.localOverride = installedLocalOverride({ root, serverName, sealBin, statePath });
  writeState(statePath, state);

  const install = runClaude([
    "mcp", "add", "--scope", "local", serverName,
    "--", sealBin, "__proxy", "--protect-state", statePath,
  ], env, root);
  if (install.error || install.code !== 0) {
    writeState(statePath, { ...state, state: STATES.BROKEN, brokenReason: install.error ? install.error.message : (install.stderr || install.stdout).trim() });
    throw new ProtectionError("claude_install_failed", `Claude Code local override install failed: ${(install.stderr || install.stdout || install.error?.message || "").trim()}`);
  }
  const installedState = {
    ...state,
    localOverride: { ...state.localOverride, installed: true, installedAt: new Date().toISOString() },
  };
  writeState(statePath, installedState);
  return { statePath, beforeHash: project.hash, state: installedState, toolNames };
}

function unprotect({ serverName, projectRoot = process.cwd(), env = process.env }) {
  if (!serverName) throw new ProtectionError("usage", "usage: seal unprotect SERVER");
  const root = realProjectRoot(projectRoot);
  const statePath = statePathFor(root, env);
  const state = readState(statePath);
  assertSealOwnedLocalOverride(state, root, serverName, env, { allowAbsent: true });
  if (state && state.sealVersion && state.sealVersion !== sealVersion()) {
    throw new ProtectionError("incompatible_state", "stored protection state is from another binary version");
  }
  if (lockOwnerIsLive(state?.lease)) {
    throw new ProtectionError("active_claude_session", `active Claude session is using "${serverName}"; stop it before unprotect`);
  }
  const before = readProjectConfig(root).hash;
  const remove = runClaude(["mcp", "remove", "--scope", "local", serverName], env, root);
  if (remove.error || (remove.code !== 0 && !localOverrideIsAbsent(remove, serverName))) {
    throw new ProtectionError("claude_remove_failed", `Claude Code local override removal failed: ${(remove.stderr || remove.stdout || remove.error?.message || "").trim()}`);
  }
  const after = readProjectConfig(root).hash;
  if (state) writeState(statePath, { ...state, state: STATES.UNPROTECTED, lease: null, unprotectedAt: new Date().toISOString(), mcpJsonHashAtUnprotect: after });
  return { beforeHash: before, afterHash: after, statePath, previousState: state };
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
  const initial = readState(statePath);
  if (!initial) throw new ProtectionError("state_broken", "protection state is absent");
  const lock = acquireProjectLock(initial.projectRoot, env);
  try {
    const state = readState(statePath);
    if (!state) throw new ProtectionError("state_broken", "protection state is absent");
    if (lockOwnerIsLive(state.lease)) {
      throw new ProtectionError(
        "proxy_lease_active",
        `active lease holder pid ${state.lease.pid}, generation ${state.lease.generation ?? "unknown"}; retry after that session exits`,
      );
    }
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
        timeoutMs: state.discoveryTimeoutMs || DEFAULT_TOOL_DISCOVERY_TIMEOUT_MS,
      });
    } catch (error) {
      markBroken(statePath, state, error);
      throw error;
    }
    const guardedTools = protectedToolNames(state);
    const vanishedTools = guardedTools.filter((name) => !toolNames.includes(name));
    if (vanishedTools.length > 0) {
      const protectedName = vanishedTools.length === 1
        ? `protected tool "${vanishedTools[0]}" vanished`
        : `protected tools ${vanishedTools.map((name) => `"${name}"`).join(", ")} vanished`;
      const error = new ProtectionError(
        "protected_tool_vanished",
        `${protectedName} before activation; observed tools: ${observedNames(toolNames)}`,
      );
      markBroken(statePath, state, error);
      throw error;
    }
    const existingLease = state.lease;
    const generation = Number.isInteger(existingLease?.generation) ? existingLease.generation + 1 : 1;
    const next = {
      ...state,
      state: STATES.ACTIVE,
      lease: {
        pid: process.pid,
        startWitness: processStartWitness(process.pid),
        generation,
        startedAt: new Date().toISOString(),
      },
    };
    writeState(statePath, next);
    lock.release();
    Object.defineProperty(next, "leaseToken", { value: next.lease });
    Object.defineProperty(next, "lockRecovered", { value: lock.recovered });
    return next;
  } catch (error) {
    lock.release();
    throw error;
  }
}

function beforeForwardFromState(statePath, leaseToken) {
  return () => {
    const state = readState(statePath);
    if (!state) return { ok: false, refusal: "state_absent", detail: "protection state is absent" };
    if (leaseToken && !leaseMatches(state.lease, leaseToken)) {
      return { ok: false, refusal: "lease_generation_mismatch", detail: "this proxy no longer owns the active lease generation" };
    }
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
    text: "ASSUMPTION\n  Seal has not established whether this Claude Code configuration can\n  automatically answer elicitation requests.\n",
  };
}

module.exports = {
  DEFAULT_TOOL_DISCOVERY_TIMEOUT_MS,
  ProtectionError,
  STATES,
  acquireProjectLock,
  activationLease,
  beforeForwardFromState,
  dataHome,
  doctor,
  localOverrideExists,
  listServerTools,
  loadReceiptSigner,
  lockPathFor,
  lockOwnerIsLive,
  processStartWitness,
  protectedToolNames,
  protect,
  protectionView,
  projectDirectory,
  projectId,
  readProjectServer,
  readState,
  receiptKeyPaths,
  realProjectRoot,
  statePathFor,
  stateWithProject,
  unprotect,
};
