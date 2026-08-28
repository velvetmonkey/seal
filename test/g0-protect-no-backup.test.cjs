const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync, spawnSync } = require("node:child_process");
const test = require("node:test");

const ROOT = path.join(__dirname, "..");

function copyTree() {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "seal-g0-protect-mutant-"));
  fs.cpSync(ROOT, out, { recursive: true, filter: (source) => !source.includes("/node_modules/") && !source.includes("/.family/") && !source.includes("/dist/") });
  return out;
}

function fakeClaude(root) {
  const bin = path.join(root, "fake-bin");
  fs.mkdirSync(bin, { recursive: true });
  const file = path.join(bin, "claude");
  fs.writeFileSync(file, `#!/usr/bin/env node
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
  fs.chmodSync(file, 0o755);
  return bin;
}

function probe(root) {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "seal-g0-protect-probe-"));
  const project = path.join(work, "project");
  const home = path.join(work, "home");
  const config = path.join(work, "claude-config");
  const xdg = path.join(work, "xdg");
  fs.mkdirSync(project, { recursive: true }); fs.mkdirSync(home, { recursive: true });
  fs.writeFileSync(path.join(project, ".mcp.json"), JSON.stringify({ mcpServers: {
    db: { command: process.execPath, args: [path.join(root, "test-support", "tool-list-server.cjs"), "ok", "demo.mutate"] },
  } }) + "\n");
  const fake = fakeClaude(work);
  const result = spawnSync(process.execPath, [path.join(root, "bin", "seal"), "protect", "db", "demo.mutate"], {
    cwd: project, encoding: "utf8", timeout: 30000,
    env: { ...process.env, PATH: `${fake}${path.delimiter}${process.env.PATH}`, HOME: home, CLAUDE_CONFIG_DIR: config, XDG_DATA_HOME: xdg },
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.equal(fs.existsSync(path.join(home, ".claude", "backups")), false, `protect backup claim failed: ${path.join(home, ".claude", "backups")} exists`);
  assert.equal(fs.existsSync(path.join(config, ".claude", "backups")), false, `protect config-backup claim failed: ${path.join(config, ".claude", "backups")} exists`);
}

if (process.argv[2] === "--probe") {
  try { probe(process.argv[3]); } catch (error) { console.error(error.stack || error.message); process.exit(1); }
  process.exit(0);
}

test("protect leaves Claude backups absent", () => {
  probe(ROOT);
  assert.match(fs.readFileSync(path.join(ROOT, "docs", "guide", "choosing-what-to-protect.md"), "utf8"), /Claude Code writes `~\/\.claude\.json` and a backup under `~\/\.claude\/backups\/`\.\nSeal invokes Claude Code but writes neither file\./);

  const mutant = copyTree();
  const file = path.join(mutant, "spine", "protection.cjs");
  const source = fs.readFileSync(file, "utf8");
  const needle = "  const installedState = {\n";
  assert.equal(source.split(needle).length - 1, 1, "protect backup mutation site must be unique");
  const addition = "  fs.mkdirSync(path.join(env.HOME, \".claude\", \"backups\"), { recursive: true });\n  fs.writeFileSync(path.join(env.HOME, \".claude\", \"backups\", \"seal-backup\"), \"backup\\n\");\n";
  fs.writeFileSync(file, source.replace(needle, addition + needle));
  const result = spawnSync(process.execPath, [__filename, "--probe", mutant], { encoding: "utf8", timeout: 60000 });
  assert.notEqual(result.status, 0, "Claude backup mutant unexpectedly passed");
  assert.match(`${result.stdout}\n${result.stderr}`, /protect backup claim failed: .*\.claude[\\/]backups exists/);

  const configMutant = copyTree();
  const configFile = path.join(configMutant, "spine", "protection.cjs");
  const configSource = fs.readFileSync(configFile, "utf8");
  const configNeedle = "  const installedState = {\n";
  assert.equal(configSource.split(configNeedle).length - 1, 1, "config-backup mutation site must be unique");
  const configAddition = "  fs.mkdirSync(path.join(env.CLAUDE_CONFIG_DIR, \".claude\", \"backups\"), { recursive: true });\n  fs.writeFileSync(path.join(env.CLAUDE_CONFIG_DIR, \".claude\", \"backups\", \"seal-backup\"), \"backup\\n\");\n";
  fs.writeFileSync(configFile, configSource.replace(configNeedle, configAddition + configNeedle));
  const configResult = spawnSync(process.execPath, [__filename, "--probe", configMutant], { encoding: "utf8", timeout: 60000 });
  assert.notEqual(configResult.status, 0, "Claude config-backup mutant unexpectedly passed");
  assert.match(`${configResult.stdout}\n${configResult.stderr}`, /protect config-backup claim failed: .*\.claude[\\/]backups exists/);
});
