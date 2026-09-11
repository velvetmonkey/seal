const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
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
  const root = testTmpdir(path.join(os.tmpdir(), "seal-next-steps-"));
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
  const root = testTmpdir(path.join(os.tmpdir(), "seal-next-steps-scope-"));
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

// Keep command outcomes on disk as well as in assertions, so a failure can be
// inspected without depending on a shell pipeline's status.
function contractContext() {
  const root = testTmpdir(path.join(os.tmpdir(), "seal-cli-contract-"));
  const project = path.join(root, "project");
  const home = path.join(root, "home");
  fs.mkdirSync(project);
  fs.mkdirSync(home);
  const fakeBin = fakeClaudeBin(root);
  const env = { ...process.env, PATH: `${fakeBin}${path.delimiter}${process.env.PATH}`,
    HOME: home, CLAUDE_CONFIG_DIR: home, XDG_DATA_HOME: path.join(home, ".local", "share"),
    SEAL_ELICITATION_AUTO_RESPONSE: "", CLAUDE_ELICITATION_AUTO_RESPONSE: "" };
  let sequence = 0;
  return { root, project, home, env, run(args, input = "", extraEnv = {}) {
    const result = require("node:child_process").spawnSync(process.execPath, [SEAL, ...args], {
      cwd: project, env: { ...env, ...extraEnv }, input, encoding: "utf8", timeout: 30000,
    });
    const record = path.join(root, `${++sequence}.exit`);
    fs.writeFileSync(record, `${result.status}\n`);
    assert.ifError(result.error);
    return { code: Number(fs.readFileSync(record, "utf8")), out: result.stdout + result.stderr,
      stdout: result.stdout, stderr: result.stderr };
  } };
}

for (const alias of [[], ["--help"], ["-h"], ["--version"], ["-V"]]) {
  test(`CLI contract: ${alias[0] || "bare invocation"} exits 0 and prints its canonical output`, () => {
    const ctx = contractContext();
    const result = ctx.run(alias);
    assert.equal(result.code, 0, result.out);
    assert.equal(result.stderr, "");
    const version = alias[0] === "--version" || alias[0] === "-V";
    assert.equal(result.stdout, version
      ? `${require("../spine/version.cjs").requireMatchingVersion()}\n`
      : ctx.run(["--help"]).stdout);
    if (!version) assert.match(result.stdout, /seal protect/);
  });
}

test("CLI contract: every help line fits 80 columns", () => {
  const help = execFileSync(SEAL, ["--help"], { encoding: "utf8" });
  for (const [index, line] of help.split(/\r?\n/).entries()) {
    assert.ok([...line].length <= 80,
      `help line ${index + 1} exceeds 80 columns (${[...line].length}): ${line}`);
  }
});

// CLAIM-COVERAGE: docs/reference/cli.md#cli-reference
test("CLI contract: every public parser flag appears in help and the reference", () => {
  const root = path.resolve(__dirname, "..");
  const cli = fs.readFileSync(SEAL, "utf8");
  // Read parser code only: help, guidance, and private proxy flags must not be
  // able to satisfy this inventory on behalf of a public parser.
  const parser = cli.slice(cli.indexOf("async function verify("), cli.indexOf("function printHelp()"))
    + fs.readFileSync(path.join(root, "spine/demo.cjs"), "utf8").split("async function run(")[1].split("const dataFile")[0]
    + fs.readFileSync(path.join(root, "scripts/seal-reproduce.cjs"), "utf8").split("function parseArguments(")[1].split("function validateRequest(")[0];
  const flags = [...new Set([...parser.matchAll(/(?:===|!==|indexOf\()\s*["'](-{1,2}[A-Za-z][A-Za-z-]*)["']/g)].map((match) => match[1]))].sort();
  assert.deepEqual(flags, ["--archive", "--authority", "--authority-name", "--dir", "--help", "--manifest", "--output", "--platform", "--pubkey", "--source", "--timeout-ms", "--version", "-V", "-h"].sort());
  const help = contractContext().run(["--help"]);
  assert.equal(help.code, 0, help.out);
  const reference = fs.readFileSync(path.join(root, "docs/reference/cli.md"), "utf8");
  for (const flag of flags) {
    const token = new RegExp(`(?<![A-Za-z-])${flag}(?![A-Za-z-])`);
    assert.match(help.stdout, token, `parser flag missing from help: ${flag}`);
    assert.match(reference, token, `parser flag missing from reference: ${flag}`);
  }
});

test("CLI contract: unknown command exits 2 and prints diagnostic plus help", () => {
  const ctx = contractContext();
  const result = ctx.run(["not-a-command"]);
  assert.equal(result.code, 2);
  assert.equal(result.stderr, "seal: unknown command: not-a-command\n");
  assert.equal(result.stdout, ctx.run(["--help"]).stdout);
});

for (const [args, expected] of [
  [["demo", "--dir"], 1], [["verify"], 1], [["reproduce"], 1],
  [["protect"], 1], [["unprotect"], 1], [["recover"], 1], [["receipts"], 1],
  [["status", "extra"], 2],
]) {
  test(`CLI contract: ${args.join(" ")} usage exits ${expected}`, () => {
    const result = contractContext().run(args);
    assert.equal(result.code, expected, result.out);
    assert.ok(result.stderr.length > 0);
  });
}

// Load the real parser with discovery replaced at its boundary. A 1ms real
// server-start test would measure scheduler timing instead of option acceptance.
function cliSandbox(ctx, replacements = {}) {
  const { createRequire } = require("node:module");
  const realRequire = createRequire(SEAL);
  const sandbox = {
    __dirname: path.dirname(SEAL), __filename: SEAL, module: {},
    require(name) { return replacements[name] || realRequire(name); },
    console: { log() {}, error() {} },
    process: { argv: [process.execPath, SEAL], env: ctx.env, cwd: () => ctx.project,
      stdout: { write() {} }, stderr: { write() {} } },
  };
  require("node:vm").createContext(sandbox);
  require("node:vm").runInContext(fs.readFileSync(SEAL, "utf8"), sandbox, { filename: SEAL });
  return sandbox;
}

for (const value of ["0", "1", "2147483647", "2147483648"]) {
  test(`CLI contract: protect timeout boundary ${value}`, async () => {
    const ctx = contractContext();
    const protectionPath = path.resolve(__dirname, "../spine/protection.cjs");
    const protection = require(protectionPath);
    let observed;
    const sandbox = cliSandbox(ctx, { [protectionPath]: { ...protection, async protect(options) {
      observed = options;
      return { beforeHash: "unchanged", state: { guardTools: ["write"] }, toolNames: ["write"], statePath: "state" };
    }, protectionBoundary() { return []; } } });
    sandbox.args = ["--timeout-ms", value, "db", "write"];
    const promise = require("node:vm").runInContext("protectCommand(args)", sandbox);
    if (value === "1" || value === "2147483647") {
      await promise;
      assert.equal(observed.timeoutMs, Number(value));
      assert.equal(observed.serverName, "db");
      assert.deepEqual(Array.from(observed.guardTools), ["write"]);
    } else {
      await assert.rejects(promise, { code: "usage", message: "--timeout-ms requires an integer from 1 to 2147483647" });
      assert.equal(observed, undefined, "invalid timeout must never reach discovery");
      assert.equal(ctx.run(["protect", "--timeout-ms", value, "db", "write"]).code, 1);
    }
  });
}

test("CLI contract: demo --dir retains its artifacts, decline exits 0, EOF exits 1", () => {
  const ctx = contractContext();
  const directory = path.join(ctx.root, "chosen-demo");
  const declined = ctx.run(["demo", "--dir", directory], "n\n");
  assert.equal(declined.code, 0, declined.out);
  assert.ok(fs.statSync(path.join(directory, "receipts")).isDirectory());
  assert.ok(fs.statSync(path.join(directory, "receipt-signer.pub")).isFile());
  const eof = ctx.run(["demo", "--dir", path.join(ctx.root, "eof-demo")]);
  assert.equal(eof.code, 1, eof.out);
});

test("CLI contract: demo, verify and receipts success and verification failure have exact exits", () => {
  const ctx = contractContext();
  const directory = path.join(ctx.root, "approved-demo");
  const demo = ctx.run(["demo", "--dir", directory], "y\n");
  assert.equal(demo.code, 0, demo.out);
  const receipts = path.join(directory, "receipts");
  const receipt = path.join(receipts, fs.readdirSync(receipts).find((name) => name.endsWith("-ALLOW.json")));
  const key = fs.readFileSync(path.join(directory, "receipt-signer.pub"), "utf8").trim();
  const verified = ctx.run(["verify", receipt, "--pubkey", key]);
  assert.equal(verified.code, 0, verified.out);
  assert.equal(ctx.run(["verify", receipt]).code, 1);
  const population = ctx.run(["receipts", receipts]);
  assert.equal(population.code, 0, population.out);
});

test("CLI contract: protect, unprotect, recover, doctor and status exact exits", () => {
  const ctx = contractContext();
  fs.writeFileSync(path.join(ctx.project, ".mcp.json"), JSON.stringify({ mcpServers: {
    db: { command: process.execPath, args: [path.resolve(__dirname, "../test-support/tool-list-server.cjs"), "ok", "demo.mutate"] },
  } }));
  const unprotected = ctx.run(["status"]);
  assert.equal(unprotected.code, 0, unprotected.out);
  assert.match(unprotected.out, /Sealed MCP route: - outside Seal/);
  assert.equal(ctx.run(["doctor"]).code, 0);
  assert.equal(ctx.run(["doctor"], "", { SEAL_ELICITATION_AUTO_RESPONSE: "automatic" }).code, 1);
  const protectedRun = ctx.run(["protect", "--timeout-ms", "2147483647", "db", "demo.mutate"]);
  assert.equal(protectedRun.code, 0, protectedRun.out);
  assert.equal(ctx.run(["protect", "db", "demo.mutate"]).code, 1);
  const statePath = protectedRun.out.match(/^State: (.+)$/m)[1];
  const original = fs.readFileSync(statePath, "utf8");
  fs.writeFileSync(statePath, "{");
  assert.equal(ctx.run(["status"]).code, 1);
  assert.equal(ctx.run(["recover", "--archive", "db"]).code, 1);
  fs.writeFileSync(statePath, original);
  const unprotect = ctx.run(["unprotect", "db"]);
  assert.equal(unprotect.code, 0, unprotect.out);
  assert.equal(ctx.run(["unprotect", "absent"]).code, 1);
  const again = ctx.run(["protect", "db", "demo.mutate"]);
  assert.equal(again.code, 0, again.out);
  // Fault injection: incompatible stored schema, never a new expected fixture.
  const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
  state.schema = "seal.protect/incompatible-test";
  fs.writeFileSync(statePath, JSON.stringify(state));
  const recover = ctx.run(["recover", "--archive", "db"]);
  assert.equal(recover.code, 0, recover.out);
  assert.match(recover.out, /Archived incompatible protection state:/);
});

for (const alias of ["--version", "-V"]) {
  test(`CLI contract: ${alias} version disagreement exits 1`, () => {
    const ctx = contractContext();
    const copy = path.join(ctx.root, "copy");
    for (const entry of ["bin", "spine", "scripts", "runtime-manifest.json", "package.json", "VERSION"])
      fs.cpSync(path.resolve(__dirname, "..", entry), path.join(copy, entry), { recursive: true });
    fs.writeFileSync(path.join(copy, "VERSION"), "0.0.0-test-mismatch\n");
    const result = require("node:child_process").spawnSync(process.execPath, [path.join(copy, "bin/seal"), alias], { encoding: "utf8" });
    const record = path.join(ctx.root, "version.exit");
    fs.writeFileSync(record, `${result.status}\n`);
    assert.equal(Number(fs.readFileSync(record, "utf8")), 1, result.stdout + result.stderr);
    assert.match(result.stderr, /version/i);
  });
}

for (const args of [
  ["v9.0.0", "--source", "source", "--platform", "linux-x64", "--authority", "independent", "--authority-name", "rebuilder"],
  ["build-pinned-kernel", "v9.0.0", "--output", "kernel.wasm", "--source", "source", "--manifest", "release.json"],
]) {
  for (const code of [0, 1]) {
    test(`CLI contract: reproduce ${args[0]} forwards all owner flags and exit ${code}`, async () => {
      const ctx = contractContext();
      let forwarded;
      const ownerPath = path.resolve(__dirname, "../scripts/seal-reproduce.cjs");
      const sandbox = cliSandbox(ctx, { [ownerPath]: { main(received) {
        forwarded = Array.from(received);
        sandbox.process.exitCode = code;
      } } });
      sandbox.process.argv.push("reproduce", ...args);
      await require("node:vm").runInContext("main()", sandbox);
      const record = path.join(ctx.root, "reproduce.exit");
      fs.writeFileSync(record, `${sandbox.process.exitCode}\n`);
      assert.equal(Number(fs.readFileSync(record, "utf8")), code);
      assert.deepEqual(forwarded, args);
    });
  }
}
