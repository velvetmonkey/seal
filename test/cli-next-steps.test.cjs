const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const test = require("node:test");

const SEAL = path.join(__dirname, "..", "bin", "seal");

function fakeClaudeBin(root) {
  const bin = path.join(root, "bin");
  fs.mkdirSync(bin, { recursive: true });
  const script = path.join(bin, "claude");
  fs.writeFileSync(script, `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const cwd = process.cwd();
const home = process.env.HOME || cwd;
const args = process.argv.slice(2);
const configPath = path.join(process.env.CLAUDE_CONFIG_DIR || home, ".claude.json");
function readConfig() { try { return JSON.parse(fs.readFileSync(configPath, "utf8")); } catch { return {}; } }
function writeConfig(config) { fs.mkdirSync(path.dirname(configPath), { recursive: true }); fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + "\\n"); }
function localServer(name) { return readConfig().projects?.[cwd]?.mcpServers?.[name]; }
function projectHas(name) {
  try { return !!JSON.parse(fs.readFileSync(path.join(cwd, ".mcp.json"), "utf8")).mcpServers[name]; } catch { return false; }
}
if (args[0] !== "mcp") process.exit(2);
if (args[1] === "get") {
  const name = args[2];
  if (localServer(name) || projectHas(name)) process.exit(0);
  process.exit(1);
}
if (args[1] === "add") {
  const name = args[4];
  const split = args.indexOf("--");
  const config = readConfig();
  config.projects ||= {};
  config.projects[cwd] ||= {};
  config.projects[cwd].mcpServers ||= {};
  config.projects[cwd].mcpServers[name] = { type: "stdio", command: args[split + 1], args: args.slice(split + 2), env: {} };
  writeConfig(config);
  process.exit(0);
}
if (args[1] === "remove") {
  const name = args[4];
  const config = readConfig();
  if (!config.projects?.[cwd]?.mcpServers?.[name]) process.exit(1);
  delete config.projects[cwd].mcpServers[name];
  writeConfig(config);
  process.exit(0);
}
process.exit(2);
`);
  fs.chmodSync(script, 0o755);
  return bin;
}

function run(project, home, args, extraEnv = {}) {
  try {
    return { code: 0, out: execFileSync(SEAL, args, {
      cwd: project,
      env: { ...process.env, ...extraEnv, HOME: home, XDG_DATA_HOME: path.join(home, ".local", "share") },
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    }) };
  } catch (error) {
    return { code: error.status, out: `${error.stdout || ""}${error.stderr || ""}` };
  }
}

function publicSealCommands() {
  const help = execFileSync(SEAL, { encoding: "utf8" });
  return new Set([...help.matchAll(/^  seal ([a-z-]+)/gm)].map((match) => match[1]));
}

function guidanceCommands(text) {
  const commands = [];
  let inGuidance = false;
  for (const line of text.split(/\r?\n/)) {
    if (line === "Next:" || line === "Undo:") {
      inGuidance = true;
      continue;
    }
    if (inGuidance && line && !line.startsWith("  ")) inGuidance = false;
    if (!inGuidance) continue;
    const trimmed = line.trim().replace(/^\d+\.\s+/, "");
    for (const match of trimmed.matchAll(/`(seal(?:\s+[^`]+)?)`/g)) commands.push(match[1]);
    if (/^seal(?:\s|$)/.test(trimmed)) commands.push(trimmed);
  }
  return commands;
}

test("printed Next and Undo seal commands resolve to public CLI commands", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "seal-next-steps-"));
  const project = path.join(root, "project");
  const home = path.join(root, "home");
  fs.mkdirSync(project);
  fs.mkdirSync(home);
  const fakeBin = fakeClaudeBin(root);
  fs.writeFileSync(path.join(project, ".mcp.json"), JSON.stringify({
    mcpServers: {
      db: { command: process.execPath, args: [path.join(__dirname, "..", "test-support", "tool-list-server.cjs"), "ok", "demo.mutate,demo.read"] },
    },
  }, null, 2) + "\n");
  const env = { PATH: `${fakeBin}${path.delimiter}${process.env.PATH}` };
  const outputs = [
    run(project, home, ["protect", "db", "demo.mutate"], env),
    run(project, home, ["status"], env),
    run(project, home, ["unprotect", "db"], env),
  ];
  for (const result of outputs) assert.equal(result.code, 0, result.out);

  const known = publicSealCommands();
  const printed = outputs.flatMap((result) => guidanceCommands(result.out));
  for (const command of printed) {
    const name = command.split(/\s+/)[1];
    assert.ok(
      known.has(name),
      `printed guidance command does not resolve: ${command}\nknown commands: ${[...known].sort().join(", ")}\noutput:\n${outputs.map((result) => result.out).join("\n---\n")}`,
    );
  }
  assert.deepEqual(
    printed.sort(),
    [
      "seal protect db demo.mutate",
      "seal status",
      "seal status",
      "seal status",
      "seal unprotect db",
      "seal unprotect db",
    ].sort(),
  );
});

test("Undo states unprotect clears every guarded tool on the server", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "seal-next-steps-scope-"));
  const project = path.join(root, "project");
  const home = path.join(root, "home");
  fs.mkdirSync(project);
  fs.mkdirSync(home);
  const fakeBin = fakeClaudeBin(root);
  fs.writeFileSync(path.join(project, ".mcp.json"), JSON.stringify({
    mcpServers: {
      db: { command: process.execPath, args: [path.join(__dirname, "..", "test-support", "tool-list-server.cjs"), "ok", "demo.mutate,demo.read"] },
    },
  }, null, 2) + "\n");

  const result = run(project, home, ["protect", "db", "demo.mutate", "demo.read"], {
    PATH: `${fakeBin}${path.delimiter}${process.env.PATH}`,
  });

  assert.equal(result.code, 0, result.out);
  assert.match(result.out, /^Sealed MCP route db: PENDING RESTART /m);
  assert.match(result.out, /^  demo\.mutate$/m);
  assert.match(result.out, /^  demo\.read$/m);
  assert.match(
    result.out,
    /^  To clear protection for every guarded tool on server db, including guarded tools: demo\.mutate, demo\.read, stop Claude Code, then run `seal unprotect db`\.$/m,
  );
});
