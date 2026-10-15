const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync, spawnSync } = require("node:child_process");
const test = require("node:test");
const { testTmpdir } = require("../scripts/temp-root.cjs");

const SEAL = path.join(__dirname, "..", "bin", "seal");
const ROOT = path.join(__dirname, "..");

function checkStatusExample(file, actualStatus, home) {
  const source = fs.readFileSync(file, "utf8");
  const lines = source.split("\n");
  const command = lines.findIndex((line) => /\bseal status\s*$/.test(line));
  assert.ok(command >= 0, `${file}: missing seal status command`);
  let fence = command + 1;
  while (fence < lines.length && lines[fence] !== "```") fence++;
  assert.ok(fence < lines.length, `${file}:${command + 1}: unterminated command block`);
  fence++;
  while (fence < lines.length && !lines[fence].startsWith("```")) {
    assert.ok(!/^#{1,6} /.test(lines[fence]), `${file}:${fence + 1}: status output moved beyond its section`);
    fence++;
  }
  assert.equal(lines[fence], "```output", `${file}:${fence + 1}: status command must be followed by its output block`);
  const start = fence + 1;
  const end = lines.indexOf("```", start);
  assert.ok(end > start, `${file}:${start + 1}: missing status output block`);
  const expectedLabels = actualStatus.match(/^Observation [^:\n]+:/gm);
  assert.ok(expectedLabels?.length, "real status output has no Observation labels");
  const observed = lines.slice(start, end).flatMap((line, index) =>
    line.startsWith("Observation ") ? [{ label: line.match(/^Observation [^:\n]+:/)?.[0], line, number: start + index + 1 }] : []);
  assert.deepEqual(observed.map(({ label }) => label), expectedLabels,
    `${file}:${start + 1}: Observation labels differ from real seal status output`);
  const time = observed.find(({ label }) => label === "Observation time:");
  assert.equal(time?.line, "Observation time: <time of status check>",
    `${file}:${time?.number ?? start + 1}: Observation time must use the marked placeholder`);
  const actualConfig = actualStatus.match(/^Observation config: (.+)$/m)?.[1];
  assert.ok(actualConfig?.startsWith(home + path.sep), "real status config is outside temporary home");
  const config = observed.find(({ label }) => label === "Observation config:");
  assert.equal(config?.line, `Observation config: /home/you/${path.relative(home, actualConfig)}`,
    `${file}:${config?.number ?? start + 1}: Observation config differs from real default-home status`);
}

function fakeClaudeBin(root) {
  const bin = path.join(root, "bin");
  fs.mkdirSync(bin, { recursive: true });
  const script = path.join(bin, "claude");
  fs.writeFileSync(script, `#!/usr/bin/env node
if (process.argv[2] === "--version") { console.log("2.1.278 (Claude Code)"); process.exit(0); }
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
  const root = testTmpdir("seal-stateguard-witness-");
  const repository = path.join(root, "parent");
  const project = path.join(repository, "seal-protect-demo");
  const home = path.join(root, "home");
  const config = path.join(root, "claude-config");
  const xdg = path.join(root, "xdg");
  fs.mkdirSync(project, { recursive: true });
  fs.mkdirSync(home, { recursive: true });
  execFileSync("git", ["init", "-q"], { cwd: repository });
  fs.writeFileSync(path.join(project, "server.cjs"), `#!/usr/bin/env node
const readline = require("node:readline");
const rl = readline.createInterface({ input: process.stdin, terminal: false });
rl.on("line", (line) => {
  const frame = JSON.parse(line);
  if (frame.method === "initialize") process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: frame.id, result: { protocolVersion: "2025-06-18", capabilities: {}, serverInfo: { name: "nested", version: "1" } } }) + "\\n");
  if (frame.method === "tools/list") process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: frame.id, result: { tools: [{ name: "demo.mutate" }] } }) + "\\n");
});
`);
  fs.writeFileSync(path.join(repository, ".mcp.json"), JSON.stringify({
    mcpServers: {
      db: { command: process.execPath, args: ["./seal-protect-demo/server.cjs"] },
    },
  }) + "\n");
  const env = {
    ...process.env,
    PATH: `${fakeClaudeBin(root)}${path.delimiter}${process.env.PATH}`,
    HOME: home,
    CLAUDE_CONFIG_DIR: config,
    XDG_DATA_HOME: xdg,
  };

  const protectArgs = require("../test-support/kernel-receipt.cjs").protectArgsWithPolicy(["protect", "db", "demo.mutate"], root);
  const output = execFileSync(SEAL, protectArgs, {
    cwd: project,
    env,
    encoding: "utf8",
  });

  const match = output.match(/^State: (.+)$/m);
  assert.ok(match, `protect output missing State: line; output was:\n${output}`);
  const statePath = match[1].trim();
  assert.ok(path.isAbsolute(statePath), `State path is not local and absolute: ${statePath}`);
  assert.equal(fs.statSync(statePath).isFile(), true, `State path is not a file: ${statePath}`);
  assert.equal(JSON.parse(fs.readFileSync(statePath, "utf8")).projectRoot, fs.realpathSync(repository));
  const status = execFileSync(SEAL, ["status"], { cwd: project, env, encoding: "utf8" });
  assert.match(status, /Sealed MCP route db: PENDING RESTART/);
  assert.match(status, /^  demo\.mutate$/m);

  const defaultEnv = { ...env, CLAUDE_CONFIG_DIR: home };
  const defaultRun = spawnSync(SEAL, ["status"], { cwd: project, env: defaultEnv, encoding: "utf8" });
  const defaultStatus = defaultRun.stdout;
  assert.match(defaultStatus, /^Observation config:/m, defaultRun.stderr);
  fs.mkdirSync(path.join(home, ".claude"));
  const withClaudeDir = spawnSync(SEAL, ["status"], { cwd: project, env: defaultEnv, encoding: "utf8" }).stdout;
  assert.equal(defaultStatus.match(/^Observation config: (.+)$/m)?.[1],
    withClaudeDir.match(/^Observation config: (.+)$/m)?.[1]);
  checkStatusExample(process.env.SEAL_STATUS_README || path.join(ROOT, "README.md"), defaultStatus, home);
  checkStatusExample(process.env.SEAL_STATUS_GUIDE || path.join(ROOT, "docs/guide/what-is-protected-right-now.md"), defaultStatus, home);

  const activated = spawnSync(process.execPath, [SEAL, "__proxy", "--protect-state", statePath], {
    cwd: repository,
    env,
    input: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }) + "\n" +
      JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }) + "\n",
    encoding: "utf8",
  });
  assert.equal(activated.status, 0, `${activated.stdout}\n${activated.stderr}`);
});
