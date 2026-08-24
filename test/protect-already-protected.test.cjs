// SPDX-License-Identifier: Apache-2.0
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const ROOT = path.join(__dirname, "..");
const SEAL = path.join(ROOT, "bin/seal");
const SERVER = path.join(ROOT, "test-support/tool-list-server.cjs");
const { readState, statePathFor } = require("../spine/protection.cjs");

function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "seal-tool-validation-"));
  const project = path.join(root, "project");
  const home = path.join(root, "home");
  const bin = path.join(root, "bin");
  fs.mkdirSync(project);
  fs.mkdirSync(home);
  fs.mkdirSync(bin);

  const claude = path.join(bin, "claude");
  fs.writeFileSync(claude, `#!/usr/bin/env node
const fs=require("node:fs"),path=require("node:path"),crypto=require("node:crypto");
const a=process.argv.slice(2), d=path.join(process.env.HOME,".claude-local"); fs.mkdirSync(d,{recursive:true});
const f=path.join(d,crypto.createHash("sha256").update(process.cwd()+":"+a[a[1]==="add"?4:2]).digest("hex")+".json");
if(a[1]==="get") process.exit(fs.existsSync(f)?0:1);
if(a[1]==="add"){fs.writeFileSync(f,JSON.stringify(a));process.exit(0)}
if(a[1]==="remove"){try{fs.unlinkSync(f)}catch{}process.exit(0)} process.exit(2);
`, { mode: 0o755 });

  fs.writeFileSync(path.join(project, ".mcp.json"), JSON.stringify({
    mcpServers: { db: { command: process.execPath, args: [SERVER, "ok", "db.drop_table,db.read"] } },
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
  const stdout = result.stdout || "";
  const stderr = result.stderr || "";
  return { code: result.status, stdout, stderr, out: `${stdout}${stderr}` };
}

test("a later protect refuses already_protected and leaves the first tool set unchanged", (t) => {
  const ctx = setup();
  const first = run(ctx, ["protect", "db", "db.drop_table"]);
  assert.equal(first.code, 0, first.out);

  const statePath = statePathFor(ctx.project, ctx.env);
  const protectedToolsBeforeSecond = Buffer.from(JSON.stringify(readState(statePath).guardTools));
  const second = run(ctx, ["protect", "db", "db.read"]);
  const stateAfterSecond = readState(statePath);
  const protectedToolsAfterSecond = Buffer.from(JSON.stringify(stateAfterSecond.guardTools));
  const guardTools = stateAfterSecond.guardTools;

  assert.deepEqual(
    protectedToolsAfterSecond,
    protectedToolsBeforeSecond,
    `second protect refusal must leave the recorded protected tool set byte-identical; before ${protectedToolsBeforeSecond}, after ${protectedToolsAfterSecond}`,
  );

  const third = run(ctx, ["protect", "db", "db.read"]);
  const stateAfterThird = readState(statePath);

  assert.equal(
    second.stdout,
    "",
    `refused second protect must keep stdout empty; found ${JSON.stringify(second.stdout)}`,
  );
  assert.equal(
    second.code,
    1,
    `later protect must refuse already_protected instead of adding tools; found exit ${second.code}, output ${JSON.stringify(second.out)}, guardTools ${JSON.stringify(guardTools)}`,
  );
  assert.equal(
    third.code,
    1,
    `third protect must also refuse already_protected; found exit ${third.code}, output ${JSON.stringify(third.out)}, guardTools ${JSON.stringify(stateAfterThird.guardTools)}`,
  );
  assert.deepEqual(
    stateAfterThird.guardTools,
    ["db.drop_table"],
    `third protect must not replace guardTools; found ${JSON.stringify(stateAfterThird.guardTools)}`,
  );
  assert.deepEqual(
    [Object.hasOwn(stateAfterSecond, "guardTool"), Object.hasOwn(stateAfterThird, "guardTool")],
    [false, false],
    `refused protects must not write singular guardTool; found after second ${JSON.stringify(stateAfterSecond)}, after third ${JSON.stringify(stateAfterThird)}`,
  );
  assert.deepEqual(guardTools, ["db.drop_table"]);
  t.diagnostic(`second protect exit: ${second.code}`);
  t.diagnostic(second.out.trim());
  t.diagnostic(`guardTools after refusal: ${JSON.stringify(guardTools)}`);
  t.diagnostic(`third protect exit: ${third.code}`);
  t.diagnostic(third.out.trim());
  t.diagnostic(`guardTools after third refusal: ${JSON.stringify(stateAfterThird.guardTools)}`);
});
