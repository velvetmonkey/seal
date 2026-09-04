// SPDX-License-Identifier: Apache-2.0
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { testTmpdir } = require("../scripts/temp-root.cjs");
const { spawnSync } = require("node:child_process");

const ROOT = path.join(__dirname, "..");
const SEAL = path.join(ROOT, "bin/seal");
const SERVER = path.join(ROOT, "test-support/tool-list-server.cjs");
const DECLARED_TOOLS = ["db.drop_table", "db.read", "db.health"];
const {
  protectedToolNames,
  protectionView, // CLAIM-COVERAGE: docs/reference/multi-tool-semantics.md#multi-tool-semantics
  readState,
  statePathFor,
} = require("../spine/protection.cjs");

function setup(mode = "ok", source = DECLARED_TOOLS.join(",")) {
  const root = testTmpdir(path.join(os.tmpdir(), "seal-multi-tool-atomicity-"));
  const project = path.join(root, "project");
  const home = path.join(root, "home");
  const bin = path.join(root, "bin");
  fs.mkdirSync(project); fs.mkdirSync(home); fs.mkdirSync(bin);
  const claude = path.join(bin, "claude");
  fs.writeFileSync(claude, `#!/usr/bin/env node
const fs=require("node:fs"),path=require("node:path");
const a=process.argv.slice(2), cwd=process.cwd(), f=path.join(process.env.HOME,".claude.json");
function read(){try{return JSON.parse(fs.readFileSync(f,"utf8"))}catch{return {}}}
function write(c){fs.writeFileSync(f,JSON.stringify(c,null,2)+"\\n")}
if(a[1]==="get") process.exit(read().projects?.[cwd]?.mcpServers?.[a[2]]?0:1);
if(a[1]==="add"){
  const split=a.indexOf("--"),c=read(),name=a[4];
  c.projects||={}; c.projects[cwd]||={}; c.projects[cwd].mcpServers||={};
  c.projects[cwd].mcpServers[name]={type:"stdio",command:a[split+1],args:a.slice(split+2),env:{}};
  write(c); process.exit(0);
}
if(a[1]==="remove"){
  const c=read(),name=a[4];
  if(c.projects?.[cwd]?.mcpServers?.[name]) delete c.projects[cwd].mcpServers[name];
  write(c); process.exit(0);
}
process.exit(2);
`, { mode: 0o755 });
  const args = [SERVER, mode];
  if (source !== undefined) args.push(source);
  fs.writeFileSync(path.join(project, ".mcp.json"), JSON.stringify({
    mcpServers: { db: { command: process.execPath, args } },
  }, null, 2) + "\n");
  const env = {
    ...process.env,
    HOME: home,
    XDG_DATA_HOME: path.join(home, ".local/share"),
    PATH: `${bin}${path.delimiter}${process.env.PATH}`,
  };
  return { project, env };
}

function run(ctx, args) {
  const result = spawnSync(process.execPath, [SEAL, ...args], {
    cwd: ctx.project,
    env: ctx.env,
    encoding: "utf8",
  });
  return { code: result.status, out: `${result.stdout || ""}${result.stderr || ""}` };
}

function protectDeclaredSet(ctx) {
  const result = run(ctx, ["protect", "db", ...DECLARED_TOOLS]);
  assert.equal(result.code, 0, result.out);
  return statePathFor(ctx.project, ctx.env);
}

function observedView(ctx, statePath) {
  return protectionView(readState(statePath), ctx.project, ctx.env);
}

function observedGuardedTools(view) {
  return Array.isArray(view.guardTools) ? protectedToolNames(view) : [];
}

function assertAtomicity(stateName, guardedTools) {
  const guardsDeclaredSet = guardedTools.length === DECLARED_TOOLS.length &&
    guardedTools.every((name, index) => name === DECLARED_TOOLS[index]);
  const missing = DECLARED_TOOLS.filter((name) => !guardedTools.includes(name));
  assert.ok(
    guardsDeclaredSet,
    `${stateName} ATOMICITY observed a strict subset; missing tool(s): ${missing.join(", ")}; declared: ${DECLARED_TOOLS.join(", ")}; guarded: ${guardedTools.join(", ")}`,
  );
}

function assertNoDeclaredToolsGuarded(guardedTools) {
  const declaredToolsStillGuarded = DECLARED_TOOLS.filter((name) => guardedTools.includes(name));
  assert.deepEqual(
    declaredToolsStillGuarded,
    [],
    `UNPROTECTED still guards declared tool(s): ${declaredToolsStillGuarded.join(", ")}; guarded: ${guardedTools.join(", ")}`,
  );
}

test("the shared atomicity helper rejects a known incomplete declaration", () => {
  assert.throws(
    () => assertAtomicity("KNOWN-BAD", DECLARED_TOOLS.slice(0, -1)),
    /KNOWN-BAD ATOMICITY.*missing tool\(s\): db\.health/,
  );
});

test("the UNPROTECTED set assertion rejects one still-guarded member", () => {
  assert.throws(
    () => assertNoDeclaredToolsGuarded([DECLARED_TOOLS[0]]),
    /UNPROTECTED still guards declared tool\(s\): db\.drop_table/,
  );
});

test("BROKEN guards the complete three-tool declaration after one member vanishes", () => {
  const names = path.join(os.tmpdir(), `seal-multi-tool-names-${crypto.randomUUID()}`);
  fs.writeFileSync(names, `${DECLARED_TOOLS.join(" ")}\n`);
  const ctx = setup("file", names);
  const statePath = protectDeclaredSet(ctx);

  fs.writeFileSync(names, `${DECLARED_TOOLS.slice(0, 2).join(" ")}\n`);
  const activation = run(ctx, ["__proxy", "--protect-state", statePath]);
  assert.notEqual(
    activation.code,
    0,
    `BROKEN expected missing tool ${DECLARED_TOOLS.at(-1)} to refuse activation; output: ${activation.out}`,
  );
  assert.match(activation.out, /protected tool "db\.health" vanished/);
  const view = observedView(ctx, statePath);
  assert.equal(view.state, "BROKEN");
  assertAtomicity(view.state, observedGuardedTools(view));
});

test("DRIFTED guards the complete three-tool declaration after server configuration changes", () => {
  const ctx = setup();
  const statePath = protectDeclaredSet(ctx);
  const projectFile = path.join(ctx.project, ".mcp.json");
  const config = JSON.parse(fs.readFileSync(projectFile, "utf8"));
  config.mcpServers.db.args.push("configuration-changed");
  fs.writeFileSync(projectFile, JSON.stringify(config, null, 2) + "\n");

  const activation = run(ctx, ["__proxy", "--protect-state", statePath]);
  assert.notEqual(activation.code, 0);
  assert.match(activation.out, /drifted/);
  const view = observedView(ctx, statePath);
  assert.equal(view.state, "DRIFTED");
  assertAtomicity(view.state, observedGuardedTools(view));
});

test("STALE exposes one complete three-tool guard set for a dead shared lease", () => {
  const ctx = setup();
  const statePath = protectDeclaredSet(ctx);
  const pending = readState(statePath);
  fs.writeFileSync(statePath, JSON.stringify({
    ...pending,
    state: "ACTIVE",
    lease: { pid: 2147483647, startWitness: "absent", generation: 7 },
  }, null, 2) + "\n");

  const view = observedView(ctx, statePath);
  assert.equal(view.state, "STALE");
  assert.equal(view.lease.generation, 7);
  assertAtomicity(view.state, observedGuardedTools(view));
});

test("UNPROTECTED guards none of a former three-tool declaration and clears its shared lease", () => {
  const ctx = setup();
  const statePath = protectDeclaredSet(ctx);
  const activation = run(ctx, ["__proxy", "--protect-state", statePath]);
  assert.equal(activation.code, 0, activation.out);
  const activeView = observedView(ctx, statePath);
  assert.equal(activeView.state, "STALE");
  assertAtomicity(activeView.state, observedGuardedTools(activeView));

  const unprotected = run(ctx, ["unprotect", "db"]);
  assert.equal(unprotected.code, 0, unprotected.out);
  assert.match(unprotected.out, /^Sealed MCP route db: - outside Seal /m);
  const stored = readState(statePath);
  assert.equal(stored.state, "UNPROTECTED");
  assert.equal(stored.lease, null);
  const view = observedView(ctx, statePath);
  assert.equal(view.state, "UNPROTECTED");
  const guardedAfterUnprotect = observedGuardedTools(view);
  assertNoDeclaredToolsGuarded(guardedAfterUnprotect);
});

test("a later protect refuses replacement and leaves the complete declared set guarded", () => {
  const ctx = setup();
  const statePath = protectDeclaredSet(ctx);
  const replacement = run(ctx, ["protect", "db", DECLARED_TOOLS[0], DECLARED_TOOLS[1]]);
  assert.notEqual(replacement.code, 0);
  assert.match(replacement.out, /already_protected/);
  const view = observedView(ctx, statePath);
  assert.equal(view.state, "PENDING RESTART");
  assertAtomicity(view.state, observedGuardedTools(view));
});
