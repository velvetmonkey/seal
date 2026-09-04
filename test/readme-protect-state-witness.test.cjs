const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync, spawnSync } = require("node:child_process");
const test = require("node:test");
const { testTmpdir } = require("../scripts/temp-root.cjs");

const SEAL = path.join(__dirname, "..", "bin", "seal");

function fakeClaudeBin(root) {
  const bin = path.join(root, "bin");
  fs.mkdirSync(bin, { recursive: true });
  const script = path.join(bin, "claude");
  fs.writeFileSync(script, `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const cwd = process.cwd();
const configPath = path.join(process.env.CLAUDE_CONFIG_DIR, ".claude.json");
const args = process.argv.slice(2);
function localRoot() {
  const got = require("node:child_process").spawnSync("git", ["-C", cwd, "rev-parse", "--show-toplevel"], { encoding: "utf8" });
  return got.status === 0 && got.stdout.trim() ? fs.realpathSync(got.stdout.trim()) : cwd;
}
function read() { try { return JSON.parse(fs.readFileSync(configPath, "utf8")); } catch { return {}; } }
if (args[0] !== "mcp") process.exit(2);
const name = args[1] === "get" ? args[2] : args[4];
const config = read();
const root = localRoot();
if (args[1] === "get") process.exit(config.projects?.[root]?.mcpServers?.[name] ? 0 : 1);
if (args[1] === "add") {
  config.projects ||= {}; config.projects[root] ||= {}; config.projects[root].mcpServers ||= {};
  const split = args.indexOf("--");
  config.projects[root].mcpServers[name] = { type: "stdio", command: args[split + 1], args: args.slice(split + 2), env: {} };
  fs.mkdirSync(path.dirname(configPath), { recursive: true }); fs.writeFileSync(configPath, JSON.stringify(config)); process.exit(0);
}
process.exit(2);
`);
  fs.chmodSync(script, 0o755);
  return bin;
}

test("protect prints a real local State path for a nested project", () => {
  const root = testTmpdir(path.join(os.homedir(), "scratch-stateguard-witness-"));
  const project = path.join(root, "parent", "seal-protect-demo");
  const home = path.join(root, "home");
  const config = path.join(root, "claude-config");
  const xdg = path.join(root, "xdg");
  fs.mkdirSync(project, { recursive: true });
  fs.mkdirSync(home, { recursive: true });
  execFileSync("git", ["init", "-q"], { cwd: path.join(root, "parent") });
  fs.writeFileSync(path.join(project, "server.cjs"), `#!/usr/bin/env node
const readline = require("node:readline");
const rl = readline.createInterface({ input: process.stdin, terminal: false });
rl.on("line", (line) => {
  const frame = JSON.parse(line);
  if (frame.method === "initialize") process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: frame.id, result: { protocolVersion: "2025-06-18", capabilities: {}, serverInfo: { name: "nested", version: "1" } } }) + "\\n");
  if (frame.method === "tools/list") process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: frame.id, result: { tools: [{ name: "demo.mutate" }] } }) + "\\n");
});
`);
  fs.writeFileSync(path.join(project, ".mcp.json"), JSON.stringify({
    mcpServers: {
      db: { command: process.execPath, args: ["./server.cjs"] },
    },
  }) + "\n");
  const env = {
    ...process.env,
    PATH: `${fakeClaudeBin(root)}${path.delimiter}${process.env.PATH}`,
    HOME: home,
    CLAUDE_CONFIG_DIR: config,
    XDG_DATA_HOME: xdg,
  };

  const output = execFileSync(SEAL, ["protect", "db", "demo.mutate"], {
    cwd: project,
    env,
    encoding: "utf8",
  });

  const match = output.match(/^State: (.+)$/m);
  assert.ok(match, `protect output missing State: line; output was:\n${output}`);
  const statePath = match[1].trim();
  assert.ok(path.isAbsolute(statePath), `State path is not local and absolute: ${statePath}`);
  assert.equal(fs.statSync(statePath).isFile(), true, `State path is not a file: ${statePath}`);
  const status = execFileSync(SEAL, ["status"], { cwd: project, env, encoding: "utf8" });
  assert.match(status, /Sealed MCP route db: PENDING RESTART/);
  assert.match(status, /^  demo\.mutate$/m);

  const activated = spawnSync(process.execPath, [SEAL, "__proxy", "--protect-state", statePath], {
    cwd: path.join(root, "parent"),
    env,
    input: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }) + "\n" +
      JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }) + "\n",
    encoding: "utf8",
  });
  assert.equal(activated.status, 0, `${activated.stdout}\n${activated.stderr}`);
});
