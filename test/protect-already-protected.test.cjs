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
  const projectDirectory = path.dirname(statePathFor(project, env));
  const receiptsDirectory = path.join(projectDirectory, "receipts");
  const keysDirectory = path.join(env.XDG_DATA_HOME, "seal", "keys");
  fs.mkdirSync(receiptsDirectory, { recursive: true, mode: 0o700 });
  fs.mkdirSync(keysDirectory, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(projectDirectory, "state.json.live"), "seeded state target\n", { mode: 0o600 });
  fs.writeFileSync(path.join(projectDirectory, "approvals.journal"), "seeded approvals journal\n", { mode: 0o600 });
  fs.writeFileSync(path.join(projectDirectory, "approvals.journal.lock"), "seeded approvals lock\n", { mode: 0o600 });
  fs.writeFileSync(path.join(projectDirectory, "proxy.lock"), "seeded proxy lock\n", { mode: 0o600 });
  fs.writeFileSync(path.join(receiptsDirectory, "seeded-receipt.json"), "seeded receipt\n", { mode: 0o600 });
  fs.writeFileSync(path.join(keysDirectory, "receipt-ed25519"), "seeded private key\n", { mode: 0o600 });
  fs.writeFileSync(path.join(keysDirectory, "receipt-ed25519.pub"), "seeded public key\n", { mode: 0o644 });
  fs.writeFileSync(path.join(home, ".claude.json"), "{}\n", { mode: 0o600 });
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

function lstatType(stat) {
  if (stat.isDirectory()) return "directory";
  if (stat.isFile()) return "file";
  if (stat.isSymbolicLink()) return "symlink";
  return "other";
}

function treeSnapshot(directory) {
  const entries = [];
  const visit = (current, relative) => {
    for (const name of fs.readdirSync(current).sort()) {
      const absolute = path.join(current, name);
      const entryRelative = path.join(relative, name);
      const stat = fs.lstatSync(absolute);
      const entry = { path: entryRelative, type: lstatType(stat), mode: stat.mode & 0o7777 };
      if (stat.isFile()) entry.bytes = fs.readFileSync(absolute).toString("base64");
      entries.push(entry);
      if (stat.isDirectory()) visit(absolute, entryRelative);
    }
  };
  visit(directory, "");
  return entries;
}

function snapshotPath(filePath) {
  let stat;
  try {
    stat = fs.lstatSync(filePath);
  } catch (error) {
    if (error.code === "ENOENT") return { state: "absent" };
    throw error;
  }
  const snapshot = { state: "present", type: lstatType(stat), mode: stat.mode & 0o7777 };
  if (stat.isFile()) snapshot.bytes = fs.readFileSync(filePath).toString("base64");
  if (stat.isDirectory()) snapshot.tree = treeSnapshot(filePath);
  return snapshot;
}

function boundPaths(ctx, statePath) {
  const projectDirectory = path.dirname(statePath);
  const stateTargets = fs.readdirSync(projectDirectory)
    .filter((name) => /^state\.json\./.test(name))
    .sort()
    .map((name) => path.join(projectDirectory, name));
  return [
    path.join(ctx.project, ".mcp.json"),
    statePath,
    ...stateTargets,
    path.join(projectDirectory, "approvals.journal"),
    path.join(projectDirectory, "approvals.journal.lock"),
    path.join(projectDirectory, "receipts"),
    path.join(projectDirectory, "proxy.lock"),
    path.join(ctx.env.CLAUDE_CONFIG_DIR || ctx.env.HOME, ".claude.json"),
    path.join(ctx.env.XDG_DATA_HOME, "seal", "keys", "receipt-ed25519"),
    path.join(ctx.env.XDG_DATA_HOME, "seal", "keys", "receipt-ed25519.pub"),
  ];
}

function snapshotBoundPaths(paths) {
  return new Map(paths.map((filePath) => [filePath, snapshotPath(filePath)]));
}

function assertBoundPathsUnchanged(before, paths) {
  for (const filePath of paths) {
    const after = snapshotPath(filePath);
    assert.deepEqual(after, before.get(filePath), `refused second protect changed bound path: ${filePath}`);
  }
}

test("a later protect refuses already_protected and leaves the first tool set unchanged", (t) => {
  const ctx = setup();
  const first = run(ctx, ["protect", "db", "db.drop_table"]);
  assert.equal(first.code, 0, first.out);

  const statePath = statePathFor(ctx.project, ctx.env);
  const beforeSecond = fs.readFileSync(statePath, "utf8");
  const protectedToolsBeforeSecond = Buffer.from(JSON.stringify(readState(statePath).guardTools));
  const paths = boundPaths(ctx, statePath);
  const boundBeforeSecond = snapshotBoundPaths(paths);
  const second = run(ctx, ["protect", "db", "db.read"]);
  const afterSecond = fs.readFileSync(statePath, "utf8");
  const stateAfterSecond = readState(statePath);
  const protectedToolsAfterSecond = Buffer.from(JSON.stringify(stateAfterSecond.guardTools));
  const guardTools = stateAfterSecond.guardTools;

  assertBoundPathsUnchanged(boundBeforeSecond, paths);

  assert.deepEqual(
    protectedToolsAfterSecond,
    protectedToolsBeforeSecond,
    `second protect refusal must leave the recorded protected tool set byte-identical; before ${protectedToolsBeforeSecond}, after ${protectedToolsAfterSecond}`,
  );
  assert.equal(
    afterSecond,
    beforeSecond,
    `refused second protect changed on-disk state; before ${beforeSecond}, after ${afterSecond}`,
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
