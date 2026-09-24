// SPDX-License-Identifier: Apache-2.0
const crypto = require("node:crypto");
const fs = require("node:fs");
const { writeCompleteSync } = require("./write.cjs");
const os = require("node:os");
const path = require("node:path");
const { performance } = require("node:perf_hooks");
const { platformSupport } = require("./platform.cjs");
const { helperPlatform } = require("../scripts/macos-helper.cjs");
const { spawn, spawnSync } = require("node:child_process");
const readline = require("node:readline");

const STATE_SCHEMA = "seal.protect/v1";
// Compatibility belongs to the format, not the creating binary's release.
// Keep readers for every schema we can interpret when the writer advances.
const STATE_READERS = Object.freeze({
  "seal.protect/v1": readStateV1,
});
const DEFAULT_TOOL_DISCOVERY_TIMEOUT_MS = 30000;
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
    super(code === "incompatible_state"
      ? `${message}; stop Claude Code, then run \`seal recover --archive\` in this project to archive the incompatible state and remove Seal's owned local override before protecting again`
      : message);
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
    const signer = require("./receipt-v2.cjs").generateSigner();
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
    derivedHex = require("./receipt-v2.cjs").publicKeyHex(publicKey);
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

// Compatibility migration: legacy records remain authoritative at their original
// path so installed overrides and already-running wrappers keep the same file,
// journal and receipts. New servers use independent directories. Never copy a
// live record: two writable copies would split the lease and approval history.
function statePathsFor(projectRoot, env = process.env) {
  const directory = projectDirectory(projectRoot, env);
  const legacy = path.join(directory, "state.json");
  const paths = fs.existsSync(legacy) ? [legacy] : [];
  let servers;
  try { servers = fs.readdirSync(path.join(directory, "servers"), { withFileTypes: true }); }
  catch (error) { if (error.code === "ENOENT") return paths; throw error; }
  for (const server of servers.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!server.isDirectory()) continue;
    const file = path.join(directory, "servers", server.name, "state.json");
    if (fs.existsSync(file)) paths.push(file);
  }
  return paths;
}

function statePathFor(projectRoot, env = process.env, serverName) {
  const directory = projectDirectory(projectRoot, env);
  const legacy = path.join(directory, "state.json");
  if (serverName === undefined) {
    const paths = statePathsFor(projectRoot, env);
    if (paths.length > 1) throw new ProtectionError("server_required", "multiple server records exist; specify the server name");
    return paths[0] || legacy;
  }
  // Encode names as single path components, including dot-only names.
  const component = encodeURIComponent(serverName).replaceAll(".", "%2E");
  const route = path.join(directory, "servers", component, "state.json");
  const old = readState(legacy);
  // A nameless legacy record cannot safely be assigned to a different route.
  // Preserve the existing refusal instead of treating it as absent.
  if (old && (!old.serverName || old.serverName === serverName)) {
    if (fs.existsSync(route)) throw new ProtectionError("duplicate_server_state", `both legacy and server state exist for "${serverName}"; no state was changed`);
    return legacy;
  }
  return route;
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

// Expand once against the launching environment, never against sibling env
// entries. Missing/unsupported references refuse rather than launch literal tokens.
function expandProjectValue(value, env, field) {
  return value.replace(/\$\{([^{}]*)\}|\$\{/g, (reference, body) => {
    const match = body?.match(/^([A-Za-z_][A-Za-z0-9_]*)(?::-([^{}]*))?$/);
    if (!match) throw new ProtectionError("project_environment_unsupported", `${field} has an unsupported environment placeholder; use \${VAR} or \${VAR:-default}`);
    const [, name, fallback] = match;
    if (Object.hasOwn(env, name) && env[name] !== undefined) return String(env[name]);
    if (fallback !== undefined) return fallback;
    throw new ProtectionError("project_environment_missing", `${field} references unset environment variable ${name}; set it or provide a \${VAR:-default} fallback`);
  });
}

function readProjectServer(projectRoot, serverName, env = process.env) {
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
  const resolved = { ...server, command: expandProjectValue(server.command, env, "command") };
  if (server.args !== undefined) resolved.args = server.args.map((value, index) => expandProjectValue(String(value), env, `args[${index}]`));
  if (server.env !== undefined) resolved.env = Object.fromEntries(Object.entries(server.env).map(([key, value]) => [key, expandProjectValue(String(value), env, `env.${key}`)]));
  // Preserve existing digests for literal configurations. For interpolated
  // configurations bind both source and resolution: either kind of drift must
  // refuse activation/forwarding of the stored launch snapshot.
  const digestInput = canonical(resolved) === canonical(server) ? server : { source: server, resolved };
  return {
    ...config,
    server,
    serverDigest: sha256(Buffer.from(canonical(digestInput))),
    childArgv: [resolved.command, ...(resolved.args || [])],
    childEnv: resolved.env || {},
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
  const reader = state && typeof state === "object" && !Array.isArray(state) &&
    typeof state.schema === "string" && Object.hasOwn(STATE_READERS, state.schema) && STATE_READERS[state.schema];
  if (!reader) {
    throw new ProtectionError("incompatible_state", `stored protection state has schema ${JSON.stringify(state?.schema ?? "absent")}, not ${Object.keys(STATE_READERS).join(" or ")}`);
  }
  return reader(state);
}

function readStateV1(state) {
  // Early v1 records used guardTool. Later v1 records use guardTools and
  // optionally guardPredicates. protectedToolSelections treats absent
  // predicates as whole-tool protection; ownership checks accept the older
  // localOverride without claudeProjectRoot. Preserve those interpretations
  // and leave damaged-field diagnostics to the consumers that can report
  // the remaining known route facts. sealVersion is creation provenance only.
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
  const paddedName = state.guardTools.find((name) => name.trim() !== name);
  if (paddedName !== undefined) {
    throw new ProtectionError(
      "state_broken",
      `stored protection state contains protected tool name with surrounding whitespace: ${JSON.stringify(paddedName)}`,
    );
  }
  return [...new Set(state.guardTools)];
}

function protectedToolSelections(state) {
  const names = protectedToolNames(state);
  if (state.guardPredicates === undefined) return names.map((name) => ({ name, predicate: null }));
  if (!Array.isArray(state.guardPredicates) || state.guardPredicates.some((entry) =>
    !entry || typeof entry !== "object" || Array.isArray(entry) ||
    typeof entry.tool !== "string" || !names.includes(entry.tool) || typeof entry.predicate !== "string")) {
    throw new ProtectionError("state_broken", "stored protection state has an invalid guardPredicates list");
  }
  const predicatesByTool = new Map(names.map((name) => [name, []]));
  for (const entry of state.guardPredicates) predicatesByTool.get(entry.tool).push(entry.predicate);
  return names.flatMap((name) => predicatesByTool.get(name).length > 0
    ? predicatesByTool.get(name).map((predicate) => ({ name, predicate }))
    : [{ name, predicate: null }]);
}

function configuredOtherServerNames(state, projectRoot) {
  try {
    const config = readProjectConfig(claudeProjectRoot(projectRoot || state?.projectRoot));
    return Object.keys(config.parsed.mcpServers || {})
      .filter((name) => name !== state?.serverName)
      .sort();
  } catch {
    return [];
  }
}

function notControlledEntries(state, projectRoot) {
  const entries = [
    "Bash and subprocesses outside this MCP route",
    "direct resource access outside this MCP route",
    "other clients",
  ];
  const otherServers = configuredOtherServerNames(state, projectRoot);
  if (otherServers.length > 0) {
    entries.push(`configured MCP servers not routed through this Seal wrapper: ${otherServers.join(", ")}`);
  } else {
    entries.push("other MCP servers not routed through this Seal wrapper");
  }
  entries.push("other uncontrolled routes can also exist");
  return entries;
}

function protectionBoundary(state, projectRoot, statePath) {
  const printedState = state?.state === STATES.ACTIVE ? "LEASE ACTIVE" : state?.state === STATES.UNPROTECTED ? "- outside Seal" : (state?.state || STATES.BROKEN);
  const route = state?.serverName ? `Sealed MCP route ${state.serverName}: ${printedState}` : `Sealed MCP route: ${printedState}`;
  let gated;
  try {
    gated = state?.state === STATES.UNPROTECTED ? ["none"] : protectedToolNames(state);
  } catch (error) {
    gated = [`unknown: ${error.message}`];
  }
  const location = statePath ? `${route} (${statePath})` : route;
  const lines = [state?.state === STATES.ACTIVE ? `${location}; authorization runtime judgment is evaluated for each approval.` : location, "", "Gated through this route:"];
  for (const name of gated) lines.push(`  ${name}`);
  lines.push("", "Not controlled:");
  for (const name of notControlledEntries(state, projectRoot)) lines.push(`  ${name}`);
  return lines;
}

function writeState(statePath, state, { beforeCommit } = {}) {
  fs.mkdirSync(path.dirname(statePath), { recursive: true, mode: 0o700 });
  const temporary = `${statePath}.tmp-${process.pid}`;
  try {
    const fd = fs.openSync(temporary, "w", 0o600);
    try {
      fs.writeFileSync(fd, JSON.stringify(state, null, 2) + "\n");
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    if (beforeCommit) beforeCommit();
    fs.renameSync(temporary, statePath);
    const directoryFd = fs.openSync(path.dirname(statePath), "r");
    try { fs.fsyncSync(directoryFd); } finally { fs.closeSync(directoryFd); }
  } catch (error) {
    try { fs.unlinkSync(temporary); } catch (unlinkError) {
      if (unlinkError.code !== "ENOENT") error.cleanupError = unlinkError;
    }
    throw error;
  }
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

function elicitationHookConfigured(env = process.env) {
  const hook = env.SEAL_ELICITATION_AUTO_RESPONSE || env.CLAUDE_ELICITATION_AUTO_RESPONSE;
  if (hook) return true;
  try {
    const directory = path.dirname(claudeConfigPath(env));
    const settingsPath = env.CLAUDE_CONFIG_DIR
      ? path.join(directory, "settings.json")
      : path.join(directory, ".claude", "settings.json");
    const settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
    return ["Elicitation", "ElicitationResult"].some((event) => Array.isArray(settings.hooks?.[event]) && settings.hooks[event].length > 0);
  } catch {
    return false;
  }
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
  const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
  const project = config?.projects?.[localRoot];
  if (!object(config) || (config.projects !== undefined && !object(config.projects)) ||
      (project !== undefined && !object(project)) ||
      (project?.mcpServers !== undefined && !object(project.mcpServers))) {
    throw ownershipRefusal("local_override_unreadable", "The local Claude Code configuration has an unsupported structure; local override absence cannot be established.");
  }
  return project?.mcpServers?.[serverName] ?? null;
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

function assertSealOwnedLocalOverride(state, projectRoot, serverName, env = process.env, { allowAbsent = false, allowFailedInstall = false } = {}) {
  const root = realProjectRoot(projectRoot);
  const owned = state?.localOverride;
  const failedInstall = allowFailedInstall && state?.state === STATES.BROKEN && owned?.installed === false;
  if (!state || state.state === STATES.UNPROTECTED || !owned || (owned.installed !== true && !failedInstall) ||
      owned.scope !== "local" || owned.serverName !== serverName || owned.projectRoot !== root ||
      (owned.claudeProjectRoot !== undefined && owned.claudeProjectRoot !== claudeProjectRoot(root)) ||
      owned.projectId !== projectId(root) || state.serverName !== serverName ||
      state.projectRoot !== root || state.projectId !== projectId(root)) {
    throw ownershipRefusal("no_seal_owned_override");
  }
  const current = currentLocalOverride(root, serverName, env);
  if (current === null && failedInstall) throw ownershipRefusal("no_seal_owned_override");
  if (current === null && allowAbsent) return { absent: true };
  if (current === null || canonical(current) !== canonical(owned.definition)) {
    throw ownershipRefusal(
      "local_override_drifted",
      "The current local override is not the one Seal installed.\nNo configuration was changed.",
    );
  }
  return { absent: false };
}

// Resolve once per operation and use that same executable for every MCP call.
function identifyClaude(env, cwd) {
  let command;
  for (const directory of (env.PATH ?? "/usr/bin:/bin").split(path.delimiter)) {
    const candidate = path.resolve(cwd, directory, "claude");
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      if (fs.statSync(candidate).isFile()) { command = candidate; break; }
    } catch {} // Continue PATH lookup just as an executable search would.
  }
  const result = command
    ? spawnSync(command, ["--version"], { cwd, env, encoding: "utf8", timeout: 10000, stdio: ["ignore", "pipe", "pipe"] })
    : { status: null, stdout: "", stderr: "", error: new Error("claude not found on PATH") };
  const output = `${result.stdout || ""}\n${result.stderr || ""}`;
  if (result.error || result.status !== 0 || !/^.*\bClaude Code\b.*$/mi.test(output)) {
    throw new ProtectionError("claude_unusable",
      `Claude Code command ${JSON.stringify(command || "claude (not found on PATH)")} failed identification: --version exit ${result.status ?? "unavailable"}; stdout ${JSON.stringify(result.stdout || "")}; stderr ${JSON.stringify(result.stderr || "")}${result.error ? `; ${result.error.message}` : ""}. Fix PATH so claude resolves to a working Claude Code installation (on WSL, use the Linux installation), then retry.`);
  }
  return command;
}

function runClaude(args, env = process.env, cwd = process.cwd(), command = "claude") {
  const result = spawnSync(command, args, { cwd, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
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

function assertNoLocalOverride(serverName, projectRoot = process.cwd(), env = process.env, command = "claude") {
  const result = runClaude(["mcp", "get", serverName], env, projectRoot, command);
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
// Snapshot current ancestry, independent of process groups/sessions. Keep observed
// descendants across scans because TERM can reparent them before the deadline.
// A descendant that fully detaches (double-fork, new session, reparent to init)
// before the first deadline-cleanup scan is unobservable to this ancestry walk
// and cannot be contained by it; later or repeated scans cannot recover that link.
function discoveryTreePids(roots) {
  const found = new Set(roots);
  if (process.platform === "linux") {
    for (const pid of found) {
      try {
        for (const tid of fs.readdirSync(`/proc/${pid}/task`)) {
          try {
            for (const word of fs.readFileSync(`/proc/${pid}/task/${tid}/children`, "utf8").trim().split(/\s+/)) {
              const descendant = Number(word);
              if (Number.isInteger(descendant) && descendant > 0) found.add(descendant);
            }
          } catch {} // A thread may exit while its children are being read.
        }
      } catch {} // Already exited, including a root retained from an earlier scan.
    }
  } else if (process.platform === "darwin") {
    const snapshot = spawnSync("/bin/ps", ["-A", "-o", "pid=,ppid="], {
      encoding: "utf8", timeout: 25, maxBuffer: 4 * 1024 * 1024,
    });
    const children = new Map();
    for (const line of (snapshot.stdout || "").trim().split("\n")) {
      const [pid, parent] = line.trim().split(/\s+/).map(Number);
      if (pid > 0 && parent > 0) {
        if (!children.has(parent)) children.set(parent, []);
        children.get(parent).push(pid);
      }
    }
    for (const pid of found) for (const descendant of children.get(pid) || []) found.add(descendant);
  }
  return found;
}

function killDiscoveryDescendant(pid) {
  // Ben's discoverytermtree round-3 ruling accepts snapshot/kill TOCTOU:
  // an exited PID could be reused for an unrelated process. The window is
  // bounded by the scan-and-kill loop's execution time; this is an explicitly
  // accepted small timing residual, not a claim of atomic OS containment.
  try { process.kill(pid, "SIGKILL"); } catch {}
}

// Shared bounded cleanup for discovery and the active stdio proxy. Observable
// descendants and the private group are killed; an escaped, reparented session
// can survive, but inherited pipes never own the final wait.
function stopStdioServer(child, lines, isClosed) {
  return new Promise((resolve) => {
    const group = process.platform !== "win32" && Number.isInteger(child.pid) ? -child.pid : null;
    function discoveryGroupAlive() {
      if (group === null) return false;
      try { process.kill(group, 0); return true; }
      catch (error) { return error.code !== "ESRCH"; }
    };
    function signalDiscoveryGroup(signal) {
      if (group !== null) { try { process.kill(group, signal); } catch {} }
    };
    const originalPid = child.pid;
    let descendants = new Set();
    const scanTree = () => {
      const roots = new Set(descendants);
      if (Number.isInteger(originalPid)) roots.add(originalPid);
      descendants = discoveryTreePids(roots);
      descendants.delete(originalPid);
    };
    scanTree(); // Before TERM can orphan an observed detached session.
    let done = false;
    let escalated = false;
    let graceTimer;
    let deadline;
    let poll;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(graceTimer);
      clearTimeout(deadline);
      clearInterval(poll);
      child.removeListener("exit", onExit);
      child.removeListener("close", check);
      // Neither inherited pipes nor an unreapable child may own our wait.
      lines.close();
      child.stdin.destroy();
      child.stdout.destroy();
      child.stderr?.destroy();
      child.unref();
      resolve();
    };
    const check = () => {
      if (!escalated) scanTree();
      if (isClosed() && descendants.size === 0 && !discoveryGroupAlive()) finish();
    };
    const onExit = () => {
      // Preserve the direct child's single TERM; once it exits, TERM any
      // remaining group members even if they no longer hold our pipes.
      if (!escalated) signalDiscoveryGroup("SIGTERM");
      check();
    };
    const kill = () => {
      scanTree(); // Walk every depth again at the grace deadline.
      escalated = true;
      // Kill leaves before ancestors so this snapshot retains its ancestry.
      for (const pid of [...descendants].reverse()) killDiscoveryDescendant(pid);
      if (child.exitCode === null && child.signalCode === null) {
        try { child.kill("SIGKILL"); } catch {}
      }
      signalDiscoveryGroup("SIGKILL");
    };
    child.once("exit", onExit);
    child.once("close", check);
    // Reserve the last 50ms of the existing 2000ms budget for reaping.
    // The deadline stays referenced and never depends on close or exit.
    graceTimer = setTimeout(kill, 1950);
    deadline = setTimeout(() => { kill(); finish(); }, 2000);
    poll = setInterval(check, 20);
    try { child.stdin.end(); } catch {}
    if (child.exitCode === null && child.signalCode === null && !isClosed()) {
      try { child.kill("SIGTERM"); } catch {}
    } else {
      onExit();
    }
    check();
  });
}

function listServerTools({ childArgv, childEnv, projectRoot, env = process.env, timeoutMs = DEFAULT_TOOL_DISCOVERY_TIMEOUT_MS }) {
  return new Promise((resolve, reject) => {
    const child = spawn(childArgv[0], childArgv.slice(1), {
      cwd: projectRoot,
      // A private POSIX process group lets cleanup reach inherited-pipe descendants.
      detached: process.platform !== "win32",
      stdio: ["pipe", "pipe", "pipe"],
      env: childEnv ? { ...env, ...childEnv } : env,
    });
    let phase = "start";
    let settled = false;
    let closed = false;
    let stderr = "";
    let timer;
    let listId = 2;
    const namesFound = new Set();
    const cursorsSeen = new Set();

    const detail = () => stderr.trim() ? ` (${stderr.trim().slice(0, 500)})` : "";
    const stop = () => {
      clearTimeout(timer);
      return stopStdioServer(child, lines, () => closed);
    };
    const fail = (code, message) => {
      if (settled) return;
      settled = true;
      const error = new ProtectionError(code, message);
      stop().then(() => reject(error));
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
      closed = true;
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
          fail("protected_server_initialize_failed", `configured server refused or malformed initialize: ${JSON.stringify(frame.error || frame.result || "no response details")}${detail()}`);
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
          fail("protected_server_tools_list_failed", `configured server refused or malformed tools/list: ${JSON.stringify(frame.error || frame.result || "no response details")}${detail()}`);
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
        stop().then(() => resolve(names));
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

const MACOS_PROCESS_START_WITNESS_HELPER = path.join(__dirname, "../runtime/macos-process-start-witness");
// A direct sysctl helper should complete in milliseconds. One second leaves
// ample scheduler headroom while ensuring a stuck witness cannot hold a lock.
const MACOS_PROCESS_START_WITNESS_TIMEOUT_MS = 1000;
const MACOS_PROCESS_START_WITNESS_MAX_SECONDS_DIGITS = 10;
// 2000-01-01T00:00:00Z. macOS did not exist before this epoch and treating an
// implausibly old value as a lower bound would make that bound attacker-movable.
const MACOS_PROCESS_START_WITNESS_MIN_BOOT_SECONDS = 946684800;

function readinessFailure(code, detail) {
  return { ok: false, code, detail };
}

function macosHelperIdentity(stat, bytes) {
  return {
    device: stat.dev.toString(),
    inode: stat.ino.toString(),
    size: stat.size.toString(),
    mtimeNs: stat.mtimeNs.toString(),
    ctimeNs: stat.ctimeNs.toString(),
    sha256: sha256(bytes),
  };
}

function sameMacosHelperIdentity(left, right) {
  return left && right && Object.keys(left).every((key) => left[key] === right[key]);
}

function describeMacosHelperIdentity(identity) {
  if (!identity) return "unavailable";
  return `dev=${identity.device} ino=${identity.inode} size=${identity.size} mtimeNs=${identity.mtimeNs} ctimeNs=${identity.ctimeNs} sha256=${identity.sha256}`;
}

function inspectMacosHelper({ expectedPlatform } = {}) {
  let fd;
  try {
    fd = fs.openSync(MACOS_PROCESS_START_WITNESS_HELPER, "r");
    const stat = fs.fstatSync(fd, { bigint: true });
    if (!stat.isFile()) {
      return readinessFailure("macos_helper_missing", `native helper is not a regular file: ${MACOS_PROCESS_START_WITNESS_HELPER}`);
    }
    try {
      fs.accessSync(MACOS_PROCESS_START_WITNESS_HELPER, fs.constants.X_OK);
    } catch (error) {
      return readinessFailure("macos_helper_not_executable", `native helper is not executable: ${error.message}`);
    }
    const bytes = fs.readFileSync(fd);
    if (expectedPlatform) {
      let actual;
      try {
        actual = helperPlatform(bytes);
      } catch (error) {
        return readinessFailure("macos_helper_architecture", error.message.replace(/^REFUSE macos_helper_architecture:\s*/, ""));
      }
      if (actual !== expectedPlatform) {
        return readinessFailure("macos_helper_architecture", `expected ${expectedPlatform} helper, got ${actual}`);
      }
    }
    return { ok: true, identity: macosHelperIdentity(stat, bytes) };
  } catch (error) {
    const action = error?.code === "ENOENT" ? "is missing" : "cannot be inspected";
    return readinessFailure("macos_helper_missing", `native helper ${action}: ${MACOS_PROCESS_START_WITNESS_HELPER}${error?.code === "ENOENT" ? "" : `: ${error.message}`}`);
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

function helperSubstitutionFailure(expected, observed, phase) {
  return readinessFailure(
    "macos_helper_substituted",
    `native helper identity changed ${phase}; expected ${describeMacosHelperIdentity(expected)}; observed ${describeMacosHelperIdentity(observed)}`,
  );
}

function compareMacosHelperIdentity(expected, phase) {
  const current = inspectMacosHelper();
  if (!current.ok) return helperSubstitutionFailure(expected, null, phase);
  if (!sameMacosHelperIdentity(expected, current.identity)) {
    return helperSubstitutionFailure(expected, current.identity, phase);
  }
  return { ok: true };
}

// This identity fence does not make its comparison and the following act
// atomic. It makes helper substitution detectable at the explicit fence.
function requireMacosHelperIdentity(expected, phase) {
  if (!expected) return;
  const comparison = compareMacosHelperIdentity(expected, phase);
  if (!comparison.ok) throw new ProtectionError(comparison.code, comparison.detail);
}

function parseMacosTimestamp(text) {
  const match = /^([1-9]\d*)\.(\d{6})$/.exec(text || "");
  if (!match || match[1].length > MACOS_PROCESS_START_WITNESS_MAX_SECONDS_DIGITS) return null;
  const seconds = Number(match[1]);
  const microseconds = Number(match[2]);
  if (!Number.isSafeInteger(seconds) || !Number.isSafeInteger(microseconds)) return null;
  return { seconds, microseconds, value: `${match[1]}.${match[2]}` };
}

function parseMacosProcessWitness(result, nowSeconds = Date.now() / 1000) {
  if (result?.status === 2) {
    return readinessFailure("macos_boot_time_unavailable", "native helper could not read the macOS boot time");
  }
  if (!result || result.error || result.status !== 0 || typeof result.stdout !== "string") {
    return readinessFailure("macos_process_witness_failed", "native helper could not establish the process identity");
  }
  const bootLine = /^boot ([^\n]+)\n/.exec(result.stdout);
  const boot = bootLine ? parseMacosTimestamp(bootLine[1]) : null;
  if (!boot || !Number.isFinite(nowSeconds) ||
      boot.seconds < MACOS_PROCESS_START_WITNESS_MIN_BOOT_SECONDS ||
      boot.seconds + boot.microseconds / 1000000 > nowSeconds) {
    return readinessFailure("macos_boot_time_unavailable", "native helper returned an invalid or implausible macOS boot time");
  }
  const match = /^boot ([^\n]+)\nprocess ([^\n]+)\n?$/.exec(result.stdout);
  if (!match) {
    return readinessFailure("macos_process_witness_failed", "native helper returned an invalid process identity record");
  }
  const processStart = parseMacosTimestamp(match[2]);
  const bootValue = boot.seconds + boot.microseconds / 1000000;
  const processValue = processStart && processStart.seconds + processStart.microseconds / 1000000;
  if (!processStart || processValue < bootValue || processValue > nowSeconds) {
    return readinessFailure("macos_process_witness_failed", "native helper returned an invalid or implausible process identity");
  }
  return {
    ok: true,
    bootTime: boot.value,
    bootSeconds: boot.seconds,
    nowSeconds,
    witness: processStart.value,
  };
}

function macosHelperReadiness(platform, arch) {
  return inspectMacosHelper({ expectedPlatform: `${platform}-${arch}` });
}

function macosProcessWitness(pid, platform = "darwin", arch = process.arch, nowSeconds = Date.now() / 1000) {
  const helper = macosHelperReadiness(platform, arch);
  if (!helper.ok) return helper;
  const beforeExecution = compareMacosHelperIdentity(helper.identity, "between architecture gate and execution");
  if (!beforeExecution.ok) return beforeExecution;
  let execution;
  let invocationError;
  try {
    execution = spawnSync(MACOS_PROCESS_START_WITNESS_HELPER, [String(pid)], {
      encoding: "utf8",
      timeout: MACOS_PROCESS_START_WITNESS_TIMEOUT_MS,
    });
  } catch (error) {
    invocationError = error;
  }
  const afterExecution = compareMacosHelperIdentity(helper.identity, "during native witness execution");
  if (!afterExecution.ok) return afterExecution;
  if (invocationError) {
    return readinessFailure("macos_process_witness_failed", `native helper invocation failed: ${invocationError.message}`);
  }
  const parsed = parseMacosProcessWitness(execution, nowSeconds);
  return parsed.ok ? { ...parsed, helperIdentity: helper.identity } : parsed;
}

function protectReadiness(env = process.env) {
  const support = platformSupport(env);
  if (support.platform !== "darwin" || !support.protectSupported) return { ok: true };
  return macosProcessWitness(process.pid, support.platform, support.arch);
}

function requireProtectReadiness(env = process.env) {
  const result = protectReadiness(env);
  if (result.ok) return result;
  throw new ProtectionError(
    result.code,
    `supported platform, but Protect is not ready on this machine: ${result.detail}`,
  );
}

function processStartWitness(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return null;
  const support = platformSupport();
  if (support.platform === "darwin") {
    const result = macosProcessWitness(pid, support.platform, support.arch);
    return result.ok ? result.witness : null;
  }
  // platformSupport's test-only override lets product-path tests exercise the
  // same unavailable witness that a real non-Linux host would produce.
  if (support.platform !== "linux") return null;
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

function processWitnessUnavailableMessage(situation, pid, remedy) {
  return `cannot establish process-start witness for ${situation} pid ${pid}; ${remedy}`;
}

function requireProcessStartWitnessBinding(pid, situation = "live process") {
  const support = platformSupport();
  if (support.platform === "darwin") {
    const result = macosProcessWitness(pid, support.platform, support.arch);
    if (!result.ok) throw new ProtectionError(result.code, result.detail);
    return { witness: result.witness, helperIdentity: result.helperIdentity };
  }
  const witness = processStartWitness(pid);
  if (witness === null) {
    throw new ProtectionError(
      "process_witness_unavailable",
      processWitnessUnavailableMessage(situation, pid, situation.includes("owner")
        ? "stop the recorded owner and retry"
        : "fix the local process-start witness source and retry"),
    );
  }
  return { witness, helperIdentity: null };
}

function requireProcessStartWitness(pid, situation = "live process") {
  return requireProcessStartWitnessBinding(pid, situation).witness;
}

// Deliberately project-wide: activation, recovery and config mutations must not
// race. Held only during those operations, never for a proxy session or call.
function lockPathFor(projectRoot, env = process.env) {
  return path.join(projectDirectory(projectRoot, env), "proxy.lock");
}

function lockOwnerIsLive(owner, situation = "stored lease owner") {
  if (!owner || !livePid(owner.pid)) return false;
  const witness = requireProcessStartWitness(owner.pid, situation);
  return owner.startWitness === witness;
}

function leaseMatches(lease, token) {
  return lease && token && lease.pid === token.pid &&
    lease.startWitness === token.startWitness && lease.generation === token.generation;
}

function acquireProjectLock(projectRoot, env = process.env, operation) {
  const installationLock = require("./uninstall.cjs").installLock(undefined, operation);
  try {
    const projectLock = acquireProjectLockOnly(projectRoot, env);
    return { ...projectLock, release() { try { projectLock.release(); } finally { installationLock.release(); } } };
  } catch (error) { installationLock.release(); throw error; }
}

function acquireProjectLockOnly(projectRoot, env = process.env) {
  const filePath = lockPathFor(projectRoot, env);
  const witness = requireProcessStartWitnessBinding(process.pid, "Seal's own witness at project-lock acquire");
  const owner = { pid: process.pid, startWitness: witness.witness };
  let recovered = false;
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  for (;;) {
    try {
      // Publish complete owner bytes atomically. Creating proxy.lock before
      // writing its owner lets a contender mistake the empty file for a stale
      // lock, unlink it, and enter the same critical section as its creator.
      const temporary = `${filePath}.${process.pid}.${crypto.randomBytes(8).toString("hex")}`;
      const fd = fs.openSync(temporary, "wx", 0o600);
      try {
        try {
          writeCompleteSync(fd, JSON.stringify(owner) + "\n");
          fs.fsyncSync(fd);
        } finally {
          fs.closeSync(fd);
        }
        requireMacosHelperIdentity(witness.helperIdentity, "before project-lock commit");
        fs.linkSync(temporary, filePath);
      } finally {
        fs.unlinkSync(temporary);
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
      if (lockOwnerIsLive(existing, "project-lock owner")) {
        // A live lock owner is a Seal operation in progress, not a lease: it
        // finishes and releases, so the sentence must not tell the user to
        // wait for a session to exit.
        const refusal = new ProtectionError(
          "proxy_lease_active",
          `project lock held by pid ${existing.pid} for another Seal operation on this project; retry after that operation finishes`,
        );
        refusal.lockHolderPid = existing.pid;
        throw refusal;
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

function retryableAbsentInstall(state, root, serverName, env) {
  const owned = state?.localOverride;
  if (state?.state !== STATES.BROKEN || owned?.installed !== false ||
      owned.scope !== "local" || owned.serverName !== serverName || owned.projectRoot !== root ||
      owned.projectId !== projectId(root) || state.projectRoot !== root ||
      state.projectId !== projectId(root) || state.serverName !== serverName ||
      (owned.claudeProjectRoot !== undefined && owned.claudeProjectRoot !== claudeProjectRoot(root))) return false;
  refuseLiveLease(state);
  return currentLocalOverride(root, serverName, env) === null;
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
  const { parseToolSelection } = require("./tool-selection.cjs");
  const requestedSelections = [...new Set(Array.isArray(guardTools) ? guardTools : (guardTool ? [guardTool] : []))]
    .map(parseToolSelection);
  if (!serverName || requestedSelections.length === 0 || requestedSelections.some((selection) => !selection.ok)) {
    const invalid = requestedSelections.find((selection) => !selection.ok);
    throw new ProtectionError("usage", invalid
      ? `invalid tool predicate ${JSON.stringify(invalid.source)}: ${invalid.error}`
      : "usage: seal protect SERVER TOOL[?ARG=SCALAR|?ARG~\"PATTERN\"] [TOOL...]");
  }
  const requestedTools = [...new Set(requestedSelections.map((selection) => selection.name))];
  // A bare selection dominates predicates for that tool. The stored format
  // reconstructs names without predicate entries as whole-tool protection.
  const wholeTools = new Set(requestedSelections
    .filter((selection) => selection.predicate === null)
    .map((selection) => selection.name));
  const paddedName = requestedTools.find((name) => name.trim() !== name);
  if (paddedName !== undefined) {
    throw new ProtectionError("usage", `protected tool name has surrounding whitespace: ${JSON.stringify(paddedName)}`);
  }
  requireHumanApprovalOrigin(env);
  requireProtectReadiness(env);
  const root = claudeProjectRoot(projectRoot);
  const statePath = statePathFor(root, env, serverName);
  const claude = identifyClaude(env, root);
  const existing = readState(statePath);
  if (existing && existing.state !== STATES.UNPROTECTED && !retryableAbsentInstall(existing, root, serverName, env)) {
    throw new ProtectionError("already_protected", `server "${serverName}" is already ${existing.state}`);
  }
  const project = readProjectServer(root, serverName, env);
  assertNoLocalOverride(serverName, root, env, claude);
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

  const lock = acquireProjectLock(root, env);
  try {
    const latest = readState(statePath);
    if (latest && latest.state !== STATES.UNPROTECTED && !retryableAbsentInstall(latest, root, serverName, env)) {
      throw new ProtectionError("already_protected", `server "${serverName}" is already ${latest.state}`);
    }
    assertNoLocalOverride(serverName, root, env, claude);
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
      guardPredicates: requestedSelections
        .filter((selection) => selection.predicate !== null && !wholeTools.has(selection.name))
        .map((selection) => ({ tool: selection.name, predicate: selection.predicate })),
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
    require("./uninstall.cjs").registerRoute(statePath, state, env);

    const install = runClaude([
      "mcp", "add", "--scope", "local", serverName,
      "--", sealBin, "__proxy", "--protect-state", statePath,
    ], env, root, claude);
    if (install.error || install.code !== 0) {
      // The exit status does not establish whether Claude wrote the override.
      // Record failure first, then attest ownership from the actual config.
      const broken = { ...state, state: STATES.BROKEN, brokenReason: install.error ? install.error.message : (install.stderr || install.stdout).trim() };
      writeState(statePath, broken);
      const current = currentLocalOverride(root, serverName, env);
      if (current !== null && canonical(current) === canonical(state.localOverride.definition)) {
        writeState(statePath, { ...broken, localOverride: { ...state.localOverride, installed: true } });
      }
      throw new ProtectionError("claude_install_failed", `Claude Code local override install failed: ${(install.stderr || install.stdout || install.error?.message || "").trim()}. After fixing the cause, retry protect if no local override exists; if the Seal override was installed, stop Claude Code and run seal unprotect first`);
    }
    const installedState = {
      ...state,
      localOverride: { ...state.localOverride, installed: true, installedAt: new Date().toISOString() },
    };
    writeState(statePath, installedState);
    return { statePath, beforeHash: project.hash, state: installedState, toolNames };
  } finally { lock.release(); }
}

// Source observations do not authorize override removal. Ownership and leases
// are checked separately; even invalid JSON has comparable byte hashes.
function observeProjectSource(root) {
  let bytes;
  try { bytes = fs.readFileSync(mcpJsonPath(root)); }
  catch (error) {
    return { status: error.code === "ENOENT" ? "absent" : "unreadable", hash: null };
  }
  try { JSON.parse(bytes.toString("utf8")); }
  catch { return { status: "invalid", hash: sha256(bytes) }; }
  return { status: "present", hash: sha256(bytes) };
}

function unprotect({ serverName, projectRoot = process.cwd(), env = process.env }) {
  if (!serverName) throw new ProtectionError("usage", "usage: seal unprotect SERVER");
  const root = claudeProjectRoot(projectRoot);
  const claude = identifyClaude(env, root);
  const statePath = statePathFor(root, env, serverName);
  const lock = acquireProjectLock(root, env);
  try {
    const state = readState(statePath);
    assertSealOwnedLocalOverride(state, root, serverName, env, { allowAbsent: true, allowFailedInstall: true });
    if (lockOwnerIsLive(state?.lease)) {
      throw new ProtectionError("active_claude_session", `active Claude session is using "${serverName}"; stop it before unprotect`);
    }
    const before = observeProjectSource(root);
    const remove = runClaude(["mcp", "remove", "--scope", "local", serverName], env, root, claude);
    if (remove.error || (remove.code !== 0 && !localOverrideIsAbsent(remove, serverName))) {
      throw new ProtectionError("claude_remove_failed", `Claude Code local override removal failed: ${(remove.stderr || remove.stdout || remove.error?.message || "").trim()}`);
    }
    // Exit zero is not proof of removal (some PATH shims are silent no-ops).
    let remaining;
    try { remaining = currentLocalOverride(root, serverName, env); }
    catch (error) {
      throw new ProtectionError("claude_remove_failed", `Cannot verify local override removal: ${error.message}`);
    }
    if (remaining !== null) {
      throw new ProtectionError("claude_remove_failed", `Claude Code local override ${JSON.stringify(serverName)} remains in ${claudeConfigPath(env)} after removal; protection state was retained.`);
    }
    const after = observeProjectSource(root);
    if (state) writeState(statePath, { ...state, state: STATES.UNPROTECTED, lease: null, unprotectedAt: new Date().toISOString(), mcpJsonHashAtUnprotect: after.hash });
    return { beforeHash: before.hash, afterHash: after.hash, projectSourceBefore: before.status, projectSourceAfter: after.status, statePath, previousState: state };
  } finally { lock.release(); }
}

function recoveryStatePath(root, env, serverName) {
  const legacy = path.join(projectDirectory(root, env), "state.json");
  if (fs.existsSync(legacy)) {
    const old = JSON.parse(fs.readFileSync(legacy, "utf8"));
    if (old?.serverName === serverName) return legacy;
  }
  return path.join(projectDirectory(root, env), "servers", encodeURIComponent(serverName).replaceAll(".", "%2E"), "state.json");
}

function recover({ serverName, projectRoot = process.cwd(), env = process.env }) {
  const root = claudeProjectRoot(projectRoot);
  const claude = identifyClaude(env, root);
  const statePath = serverName === undefined ? statePathFor(root, env) : recoveryStatePath(root, env, serverName);
  // Recovery may inspect incompatible bytes, but must never activate them or
  // rewrite their schema to make them pass readState.
  const requireIncompatible = () => {
    let compatible;
    try { compatible = readState(statePath); } catch (error) {
      if (error.code === "incompatible_state") return;
      throw error;
    }
    if (compatible && currentLocalOverride(root, compatible.serverName, env) !== null) {
      // An old successful unprotect may retain ownership metadata. Use it only
      // to explain manual cleanup, never to authorize deletion or change state.
      assertSealOwnedLocalOverride({ ...compatible, state: compatible.state === STATES.UNPROTECTED ? STATES.PENDING_RESTART : compatible.state }, root, compatible.serverName, env);
      const name = /^[a-zA-Z0-9_.-]+$/.test(compatible.serverName)
        ? compatible.serverName : "'" + compatible.serverName.replaceAll("'", "'\\''") + "'";
      throw new ProtectionError("recovery_not_needed", `Seal-owned local override ${JSON.stringify(compatible.serverName)} survives in compatible state. Stop Claude Code, then run claude mcp remove --scope local ${name}; no state or configuration was changed.`);
    }
    throw new ProtectionError("recovery_not_needed", "state is compatible or absent; seal recover --archive only recovers incompatible state; no state or configuration was changed");
  };
  requireIncompatible();
  const lock = acquireProjectLock(root, env);
  try {
    requireIncompatible();
    const bytes = fs.readFileSync(statePath);
    const state = JSON.parse(bytes.toString("utf8"));
    if (!state || state.projectRoot !== root || state.projectId !== projectId(root) ||
        typeof state.serverName !== "string" || state.serverName.length === 0 ||
        (serverName !== undefined && state.serverName !== serverName)) {
      throw new ProtectionError("recovery_state_invalid", "cannot establish the incompatible state's project and server ownership; no state or configuration was changed");
    }
    if (lockOwnerIsLive(state.lease)) {
      throw new ProtectionError("active_claude_session", "stop the Claude Code session using this project before running seal recover --archive");
    }
    const current = currentLocalOverride(root, state.serverName, env);
    // Reuse the unprotect ownership check verbatim for any existing override.
    // An absent override requires no configuration mutation.
    if (current !== null) assertSealOwnedLocalOverride(state, root, state.serverName, env);
    const assertUnchanged = () => {
      if (!fs.readFileSync(statePath).equals(bytes)) {
        throw new ProtectionError("recovery_state_changed", "stored state changed during recovery; retry after stopping Claude Code");
      }
    };
    const archivePath = `${statePath}.recovered-${crypto.randomUUID()}`;
    // Preserve the exact record durably before attempting removal. On failure
    // both the original and archive remain available for inspection and retry.
    const archiveFd = fs.openSync(archivePath, "wx", 0o600);
    try {
      fs.writeFileSync(archiveFd, bytes);
      fs.fsyncSync(archiveFd);
    } finally {
      fs.closeSync(archiveFd);
    }
    const directoryFd = fs.openSync(path.dirname(statePath), "r");
    try { fs.fsyncSync(directoryFd); } finally { fs.closeSync(directoryFd); }
    assertUnchanged();
    if (current !== null) {
      assertSealOwnedLocalOverride(state, root, state.serverName, env);
      const remove = runClaude(["mcp", "remove", "--scope", "local", state.serverName], env, root, claude);
      if (remove.error || (remove.code !== 0 && !localOverrideIsAbsent(remove, state.serverName))) {
        throw new ProtectionError("claude_remove_failed", `recovery retained state and archive ${archivePath}; Claude Code local override removal failed: ${(remove.stderr || remove.stdout || remove.error?.message || "").trim()}`);
      }
    }
    if (currentLocalOverride(root, state.serverName, env) !== null) {
      throw ownershipRefusal("local_override_drifted", `local override remains; recovery retained state and archive ${archivePath}`);
    }
    assertUnchanged();
    require("./uninstall.cjs").unregisterRoute(statePath);
    fs.unlinkSync(statePath);
    return { archivePath, previousState: state };
  } finally {
    lock.release();
  }
}

function markDrifted(statePath, state, gotDigest) {
  const next = { ...state, state: STATES.DRIFTED, drift: { expected: state.projectServerDigest, got: gotDigest, at: new Date().toISOString() } };
  writeState(statePath, next);
  return next;
}

function currentDigestForState(state, env = process.env) {
  try {
    return readProjectServer(state.projectRoot, state.serverName, env).serverDigest;
  } catch {
    return null;
  }
}

function markBroken(statePath, state, error) {
  const next = { ...state, state: STATES.BROKEN, brokenReason: `${error.code || "activation_failed"}: ${error.message}`, lease: null };
  writeState(statePath, next);
  return next;
}

// Activation waits for project-lock acquisition, not for tool discovery or a
// live lease to end. Ten real Claude mcp add/remove invocations on this host
// measured 578.24–1023.33ms (median 825.57ms). 3200ms is 3.13x that maximum:
// room for protect's in-lock get plus add and scheduling/filesystem overhead.
// This is a retry budget, not a guarantee that the holder finishes within it.
const ACTIVATION_LOCK_WAIT_MS = 3200;
const ACTIVATION_LOCK_POLL_MS = 25;

async function acquireProjectLockWaiting(projectRoot, env, wait = { elapsedMs: 0 }) {
  const started = performance.now();
  try {
    for (;;) {
      try {
        return acquireProjectLock(projectRoot, env, "startup");
      } catch (error) {
        if (!(error instanceof ProtectionError) || !["proxy_lease_active", "installation_lock_active"].includes(error.code)) throw error;
        const elapsedMs = performance.now() - started;
        if (elapsedMs >= ACTIVATION_LOCK_WAIT_MS) {
          if (error.code === "installation_lock_active") {
            throw new ProtectionError("installation_lock_active",
              `startup refused: timed out after waiting ${Math.round(wait.elapsedMs + elapsedMs)}ms to acquire the installation lock held by pid ${error.lockHolderPid}; retry after that Seal operation finishes`);
          }
          throw new ProtectionError(
            "proxy_lease_active",
            `timed out after waiting ${Math.round(wait.elapsedMs + elapsedMs)}ms to acquire the project lock held by pid ${error.lockHolderPid}; its Seal operation has not finished (it may be waiting for a slow subprocess); retry after that operation finishes`,
          );
        }
        await new Promise((resolve) => setTimeout(resolve, ACTIVATION_LOCK_POLL_MS));
      }
    }
  } finally {
    wait.elapsedMs += performance.now() - started;
  }
}

async function withProjectLock(projectRoot, env, body, wait) {
  const lock = await acquireProjectLockWaiting(projectRoot, env, wait);
  try {
    return body(lock);
  } finally {
    lock.release();
  }
}

function refuseLiveLease(state) {
  if (lockOwnerIsLive(state.lease)) {
    throw new ProtectionError(
      "proxy_lease_active",
      `active lease holder pid ${state.lease.pid}, generation ${state.lease.generation ?? "unknown"}; retry after that session exits`,
    );
  }
}

// The record fields tool discovery and the lease commit depend on. Discovery
// runs outside the project lock, so a record whose inputs changed meanwhile is
// not activated on the strength of that discovery.
function activationInputs(state) {
  return JSON.stringify({
    projectRoot: state.projectRoot,
    projectId: state.projectId,
    serverName: state.serverName,
    projectServerDigest: state.projectServerDigest,
    childArgv: state.childArgv,
    childEnv: state.childEnv,
    storePath: state.storePath,
    receiptsDir: state.receiptsDir,
    selections: protectedToolSelections(state),
    discoveryTimeoutMs: state.discoveryTimeoutMs,
  });
}

// Discovery failed outside the lock. The record is marked BROKEN only when it
// is still the record preflight validated and no other session has taken a
// live lease on it meanwhile: a loser's failure must never null a live lease.
// Returns the error the caller should raise.
async function discoveryFailureOutcome(statePath, projectRoot, env, validated, error, wait, validateState) {
  let lock;
  try {
    lock = await acquireProjectLockWaiting(projectRoot, env, wait);
  } catch {
    return error;
  }
  try {
    const state = readState(statePath);
    if (!state) return error;
    validateState(state);
    refuseLiveLease(state);
    if (activationInputs(state) === activationInputs(validated)) markBroken(statePath, state, error);
    return error;
  } catch (outcome) {
    return outcome instanceof ProtectionError && ["proxy_lease_active", "identity_absent"].includes(outcome.code) ? outcome : error;
  } finally {
    lock.release();
  }
}

async function activationLease(statePath, env = process.env, validateState = () => {}) {
  const initial = readState(statePath);
  if (!initial) throw new ProtectionError("state_broken", "protection state is absent");
  // The CLI requires route identity before any activation side effect. Repeat
  // its validation on every reread, including discovery failure cleanup.
  validateState(initial);
  requireHumanApprovalOrigin(env);
  const projectRoot = initial.projectRoot;
  // Sum only acquisition time across preflight and commit (or failure cleanup).
  // Discovery and the locked bodies do not count as waiting for the lock.
  const wait = { elapsedMs: 0 };
  // Preflight under the project lock: a live lease, a missing command or a
  // drifted server refuses before the guarded server is started.
  const preflight = await withProjectLock(projectRoot, env, (lock) => {
    const state = readState(statePath);
    if (!state) throw new ProtectionError("state_broken", "protection state is absent");
    validateState(state);
    refuseLiveLease(state);
    const childCommand = state.childArgv && state.childArgv[0];
    if (childCommand && (childCommand.includes(path.sep) || childCommand.startsWith(".")) && !fs.existsSync(path.resolve(state.projectRoot, childCommand))) {
      throw new ProtectionError("protected_server_missing", `protected server command is missing: ${childCommand}`);
    }
    const got = currentDigestForState(state, env);
    if (got !== state.projectServerDigest) {
      markDrifted(statePath, state, got);
      throw new ProtectionError("drifted", "project server drifted before proxy activation");
    }
    // Validate before discovery starts the guarded server. Load lazily because
    // the journal also uses protection's lock helpers; createProxy checks again.
    require("./store.cjs").openJournal(state.storePath);
    return { state, recovered: lock.recovered };
  }, wait);
  // Tool discovery starts the guarded server and can take up to the discovery
  // timeout. It runs outside the project lock, as protect's own discovery
  // does, so another server activating in the same window is not refused for
  // a lock that is only a startup in progress. The lease is committed under
  // the lock below, after the record is validated again.
  let toolNames;
  try {
    toolNames = await listServerTools({
      childArgv: preflight.state.childArgv,
      childEnv: preflight.state.childEnv,
      projectRoot,
      env,
      timeoutMs: preflight.state.discoveryTimeoutMs || DEFAULT_TOOL_DISCOVERY_TIMEOUT_MS,
    });
  } catch (error) {
    throw await discoveryFailureOutcome(statePath, projectRoot, env, preflight.state, error, wait, validateState);
  }
  return await withProjectLock(projectRoot, env, (lock) => {
    const state = readState(statePath);
    if (!state) throw new ProtectionError("state_broken", "protection state is absent");
    // The loser of a same-server race meets the winner's committed lease here
    // and is refused with the winner's real pid and generation.
    validateState(state);
    refuseLiveLease(state);
    if (state.state === STATES.UNPROTECTED || activationInputs(state) !== activationInputs(preflight.state)) {
      throw new ProtectionError(
        "activation_state_changed",
        `protection state changed during tool discovery (now ${state.state}); no lease was taken; run seal status`,
      );
    }
    const got = currentDigestForState(state, env);
    if (got !== state.projectServerDigest) {
      markDrifted(statePath, state, got);
      throw new ProtectionError("drifted", "project server drifted before proxy activation");
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
    const witness = requireProcessStartWitnessBinding(process.pid);
    const next = {
      ...state,
      state: STATES.ACTIVE,
      lease: {
        pid: process.pid,
        startWitness: witness.witness,
        generation,
        startedAt: new Date().toISOString(),
      },
    };
    delete next.observedClient; // A new session has not observed initialize yet.
    writeState(statePath, next, {
      beforeCommit: () => requireMacosHelperIdentity(witness.helperIdentity, "before ACTIVE lease commit"),
    });
    Object.defineProperty(next, "leaseToken", { value: next.lease });
    Object.defineProperty(next, "lockRecovered", { value: preflight.recovered || lock.recovered });
    return next;
  }, wait);
}

// Informational metadata shares the existing atomic state writer and lease fence.
function recordObservedClient(statePath, leaseToken, observedClient) {
  const initial = readState(statePath);
  if (!initial) return;
  const lock = acquireProjectLock(initial.projectRoot);
  try {
    const state = readState(statePath);
    if (!state || !leaseMatches(state.lease, leaseToken)) return;
    const next = { ...state };
    if (observedClient) {
      const { capClientMetadata } = require("./presentation.cjs");
      next.observedClient = {
        name: capClientMetadata(observedClient.name),
        version: capClientMetadata(observedClient.version),
        elicitationDeclared: observedClient.elicitationDeclared,
      };
    }
    else delete next.observedClient;
    writeState(statePath, next);
  } finally {
    lock.release();
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
  if (elicitationHookConfigured(env)) {
    return {
      ok: false,
      code: "elicitation_hook_configured",
      text: "REFUSED\n  Claude Code can automatically answer elicitation requests.\n  Human approval origin cannot be assumed in this configuration.\nREFUSE elicitation_hook_configured: an auto-response hook is set; human approval origin cannot be assumed\n",
    };
  }
  const readiness = protectReadiness(env);
  if (!readiness.ok) {
    return {
      ok: false,
      code: readiness.code,
      text: `REFUSED\n  Supported platform, but Protect is not ready on this machine.\n  ${readiness.detail}\nREFUSE ${readiness.code}: ${readiness.detail}\n`,
    };
  }
  return {
    ok: true,
    text: "ASSUMPTION\n  Seal has not established whether this Claude Code configuration can\n  automatically answer elicitation requests.\n",
  };
}

function requireHumanApprovalOrigin(env = process.env) {
  if (elicitationHookConfigured(env)) {
    throw new ProtectionError(
      "elicitation_hook_configured",
      "an auto-response hook is set; human approval origin cannot be assumed",
    );
  }
}

module.exports = {
  DEFAULT_TOOL_DISCOVERY_TIMEOUT_MS,
  ProtectionError,
  STATES,
  acquireProjectLock,
  activationLease,
  assertSealOwnedLocalOverride,
  canonical,
  claudeProjectRoot,
  beforeForwardFromState,
  dataHome,
  doctor,
  localOverrideExists,
  listServerTools,
  stopStdioServer,
  loadReceiptSigner,
  lockPathFor,
  lockOwnerIsLive,
  macosHelperReadiness,
  macosProcessWitness,
  parseMacosProcessWitness,
  processStartWitness,
  protectReadiness,
  protectionBoundary,
  protectedToolNames,
  protectedToolSelections,
  protect,
  protectionView,
  projectDirectory,
  projectId,
  readProjectServer,
  readState,
  recordObservedClient,
  recover,
  receiptKeyPaths,
  realProjectRoot,
  statePathFor,
  statePathsFor,
  stateWithProject,
  unprotect,
};
