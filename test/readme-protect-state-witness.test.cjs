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
const configPath = path.join(process.env.CLAUDE_CONFIG_DIR, ".claude.json");
const args = process.argv.slice(2);
function read() { try { return JSON.parse(fs.readFileSync(configPath, "utf8")); } catch { return {}; } }
if (args[0] !== "mcp") process.exit(2);
const name = args[2] || args[4];
const config = read();
if (args[1] === "get") process.exit(config.projects?.[cwd]?.mcpServers?.[name] ? 0 : 1);
if (args[1] === "add") {
  config.projects ||= {}; config.projects[cwd] ||= {}; config.projects[cwd].mcpServers ||= {};
  const split = args.indexOf("--");
  config.projects[cwd].mcpServers[name] = { type: "stdio", command: args[split + 1], args: args.slice(split + 2), env: {} };
  fs.mkdirSync(path.dirname(configPath), { recursive: true }); fs.writeFileSync(configPath, JSON.stringify(config)); process.exit(0);
}
process.exit(2);
`);
  fs.chmodSync(script, 0o755);
  return bin;
}

test("protect prints a real local State path", () => {
  const root = fs.mkdtempSync(path.join(os.homedir(), "scratch-stateguard-witness-"));
  const project = path.join(root, "project");
  const home = path.join(root, "home");
  const config = path.join(root, "claude-config");
  const xdg = path.join(root, "xdg");
  fs.mkdirSync(project, { recursive: true });
  fs.mkdirSync(home, { recursive: true });
  fs.writeFileSync(path.join(project, ".mcp.json"), JSON.stringify({
    mcpServers: {
      db: { command: process.execPath, args: [path.join(__dirname, "..", "test-support", "tool-list-server.cjs"), "ok", "demo.mutate"] },
    },
  }) + "\n");

  const output = execFileSync(SEAL, ["protect", "db", "demo.mutate"], {
    cwd: project,
    env: {
      ...process.env,
      PATH: `${fakeClaudeBin(root)}${path.delimiter}${process.env.PATH}`,
      HOME: home,
      CLAUDE_CONFIG_DIR: config,
      XDG_DATA_HOME: xdg,
    },
    encoding: "utf8",
  });

  const match = output.match(/^State: (.+)$/m);
  assert.ok(match, `protect output missing State: line; output was:\n${output}`);
  const statePath = match[1].trim();
  assert.ok(path.isAbsolute(statePath), `State path is not local and absolute: ${statePath}`);
  assert.equal(fs.statSync(statePath).isFile(), true, `State path is not a file: ${statePath}`);
});
