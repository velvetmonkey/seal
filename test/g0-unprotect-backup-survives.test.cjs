const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");
const ROOT = path.join(__dirname, "..");
function copyTree() { const out = fs.mkdtempSync(path.join(os.tmpdir(), "seal-g0-unprotect-mutant-")); fs.cpSync(ROOT, out, { recursive: true, filter: (source) => !source.includes("/node_modules/") && !source.includes("/.family/") && !source.includes("/dist/") }); return out; }
function fakeClaude(root) {
  const bin = path.join(root, "fake-bin"); fs.mkdirSync(bin, { recursive: true }); const file = path.join(bin, "claude");
  fs.writeFileSync(file, `#!/usr/bin/env node
const fs = require("node:fs"); const path = require("node:path"); const cwd = process.cwd(); const configPath = path.join(process.env.CLAUDE_CONFIG_DIR, ".claude.json"); const args = process.argv.slice(2);
function read() { try { return JSON.parse(fs.readFileSync(configPath, "utf8")); } catch { return {}; } }
if (args[0] !== "mcp") process.exit(2); const name = args[2] || args[4]; const config = read();
if (args[1] === "get") process.exit(config.projects?.[cwd]?.mcpServers?.[name] ? 0 : 1);
if (args[1] === "add") { config.projects ||= {}; config.projects[cwd] ||= {}; config.projects[cwd].mcpServers ||= {}; const split = args.indexOf("--"); config.projects[cwd].mcpServers[name] = { type: "stdio", command: args[split + 1], args: args.slice(split + 2), env: {} }; fs.mkdirSync(path.dirname(configPath), { recursive: true }); fs.writeFileSync(configPath, JSON.stringify(config)); process.exit(0); }
if (args[1] === "remove") { const next = read(); if (!next.projects?.[cwd]?.mcpServers?.[name]) process.exit(1); delete next.projects[cwd].mcpServers[name]; fs.writeFileSync(configPath, JSON.stringify(next)); process.exit(0); } process.exit(2);
`); fs.chmodSync(file, 0o755); return bin;
}
function probe(root) {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "seal-g0-unprotect-probe-")); const project = path.join(work, "project"); const home = path.join(work, "home"); const config = path.join(work, "claude-config"); const xdg = path.join(work, "xdg"); fs.mkdirSync(project, { recursive: true }); fs.mkdirSync(home, { recursive: true });
  fs.writeFileSync(path.join(project, ".mcp.json"), JSON.stringify({ mcpServers: { db: { command: process.execPath, args: [path.join(root, "test-support", "tool-list-server.cjs"), "ok", "demo.mutate"] } } }) + "\n"); const fake = fakeClaude(work); const env = { ...process.env, PATH: `${fake}${path.delimiter}${process.env.PATH}`, HOME: home, CLAUDE_CONFIG_DIR: config, XDG_DATA_HOME: xdg };
  const protect = spawnSync(process.execPath, [path.join(root, "bin", "seal"), "protect", "db", "demo.mutate"], { cwd: project, env, encoding: "utf8", timeout: 30000 }); assert.equal(protect.status, 0, `${protect.stdout}\n${protect.stderr}`);
  const backup = path.join(home, ".claude", "backups", "planted-backup"); fs.mkdirSync(path.dirname(backup), { recursive: true }); fs.writeFileSync(backup, "keep me"); const unprotect = spawnSync(process.execPath, [path.join(root, "bin", "seal"), "unprotect", "db"], { cwd: project, env, encoding: "utf8", timeout: 30000 }); assert.equal(unprotect.status, 0, `${unprotect.stdout}\n${unprotect.stderr}`); assert.equal(fs.existsSync(backup), true, `unprotect backup-survival claim failed: planted backup ${backup} was removed`); assert.equal(fs.readFileSync(backup, "utf8"), "keep me", `unprotect backup-survival claim failed: planted backup ${backup} changed`);
}
if (process.argv[2] === "--probe") { try { probe(process.argv[3]); } catch (error) { console.error(error.stack || error.message); process.exit(1); } process.exit(0); }
test("unprotect preserves an existing Claude backup", () => {
  probe(ROOT); const mutant = copyTree(); const file = path.join(mutant, "spine", "protection.cjs"); const source = fs.readFileSync(file, "utf8"); const needle = "  const after = readProjectConfig(root).hash;\n"; assert.equal(source.split(needle).length - 1, 1, "unprotect mutation site must be unique"); fs.writeFileSync(file, source.replace(needle, '  fs.rmSync(path.join(env.HOME, ".claude", "backups"), { recursive: true, force: true });\n' + needle));
  const result = spawnSync(process.execPath, [__filename, "--probe", mutant], { encoding: "utf8", timeout: 60000 }); assert.notEqual(result.status, 0, "backup-removal mutant unexpectedly passed"); assert.match(`${result.stdout}\n${result.stderr}`, /unprotect backup-survival claim failed: planted backup .* was removed/);
});
