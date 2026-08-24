const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const ROOT = path.join(__dirname, "..");
const SEAL = path.join(ROOT, "bin", "seal");

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
const config = read();
if (args[1] === "get") {
  const name = args[2];
  if (config.projects?.[cwd]?.mcpServers?.[name]) { console.log("  Scope: Local config"); process.exit(0); }
  process.exit(1);
}
if (args[1] === "add") {
  const name = args[4];
  config.projects ||= {}; config.projects[cwd] ||= {}; config.projects[cwd].mcpServers ||= {};
  const split = args.indexOf("--");
  config.projects[cwd].mcpServers[name] = { type: "stdio", command: args[split + 1], args: args.slice(split + 2), env: {} };
  fs.mkdirSync(path.dirname(configPath), { recursive: true }); fs.writeFileSync(configPath, JSON.stringify(config)); process.exit(0);
}
if (args[1] === "remove") {
  const name = args[4];
  delete config.projects?.[cwd]?.mcpServers?.[name];
  fs.writeFileSync(configPath, JSON.stringify(config)); process.exit(0);
}
process.exit(2);
`);
  fs.chmodSync(script, 0o755);
  return bin;
}

function makeProtectFixture(root, toolNames = "demo.mutate") {
  const project = path.join(root, "project");
  const home = path.join(root, "home");
  const config = path.join(root, "claude-config");
  const xdg = path.join(root, "xdg");
  fs.mkdirSync(project, { recursive: true });
  fs.mkdirSync(home, { recursive: true });
  fs.writeFileSync(path.join(project, ".mcp.json"), JSON.stringify({
    mcpServers: {
      db: { command: process.execPath, args: [path.join(ROOT, "test-support", "tool-list-server.cjs"), "ok", toolNames] },
    },
  }) + "\n");
  const env = { ...process.env, PATH: `${fakeClaudeBin(root)}${path.delimiter}${process.env.PATH}`, HOME: home, CLAUDE_CONFIG_DIR: config, XDG_DATA_HOME: xdg };
  return {
    project,
    run(args) { return execFileSync(SEAL, args, { cwd: project, env, encoding: "utf8" }); },
  };
}

module.exports = { makeProtectFixture };
