// SPDX-License-Identifier: Apache-2.0
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");
const { testTmpdir } = require("../scripts/temp-root.cjs");

const ROOT = path.join(__dirname, "..");
const SCRATCH_ROOT = path.join(os.tmpdir(), "seal-reinstall-tests");
const BUILD = path.join(ROOT, "scripts", "build-dist.cjs");
const VERSION = fs.readFileSync(path.join(ROOT, "VERSION"), "utf8").trim();

function run(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8" });
  return { code: result.status, stdout: result.stdout || "", stderr: result.stderr || "" };
}

function buildArtifact() {
  fs.mkdirSync(SCRATCH_ROOT, { recursive: true });
  const out = testTmpdir(path.join(SCRATCH_ROOT, "seal-reinstall-test-"));
  const built = run(process.execPath, [BUILD, "--out", out]);
  assert.equal(built.code, 0, `${built.stdout}${built.stderr}`);
  const [digest, bytes, name] = fs.readFileSync(path.join(out, "SHA256SUMS"), "utf8").trim().split(/\s+/);
  return { out, artifact: path.join(out, name), digest, bytes };
}

function install(built, prefix) {
  return run(built.artifact, ["--sha256", built.digest, "--bytes", built.bytes, "--prefix", prefix]);
}

console.log(`reinstall.test effective uid: ${process.geteuid()}`);

test("installer succeeds over its verified existing immutable install", () => {
  const built = buildArtifact();
  const prefix = path.join(built.out, "prefix");
  const first = install(built, prefix);
  assert.equal(first.code, 0, `${first.stdout}${first.stderr}`);
  const record = JSON.parse(fs.readFileSync(path.join(prefix, "lib", "seal", "install.json"), "utf8"));
  const storeMode = fs.statSync(path.join(prefix, "lib", "seal", "store", record.treeSha256)).mode & 0o777;
  assert.equal(storeMode, 0o555, `expected immutable store mode 555, got ${storeMode.toString(8)}`);
  const second = install(built, prefix);
  assert.equal(second.code, 0, `${second.stdout}${second.stderr}`);
  const launched = run(process.execPath, [path.join(prefix, "bin", "seal"), "--version"]);
  assert.equal(launched.code, 0, `${launched.stdout}${launched.stderr}`);
  assert.equal(launched.stdout.trim(), VERSION);
});

test("installer refuses a physically unwritable launcher parent", () => {
  const built = buildArtifact();
  const prefix = path.join(built.out, "prefix");
  const first = install(built, prefix);
  assert.equal(first.code, 0, `${first.stdout}${first.stderr}`);
  const bin = path.join(prefix, "bin");
  fs.chmodSync(bin, 0o555);
  let refused;
  let denied;
  try {
    try {
      fs.writeFileSync(path.join(bin, `.seal-precondition-${process.pid}`), "precondition", { flag: "wx" });
    } catch (error) {
      denied = error;
    }
    console.log(
      `reinstall.test unwritable-parent precondition: euid=${process.geteuid()} chmod=0555 ` +
      `create=${denied ? `denied(${denied.code})` : "allowed"}`,
    );
    assert.ok(
      denied && (denied.code === "EACCES" || denied.code === "EPERM"),
      `cannot establish unwritable launcher-parent precondition for euid ${process.geteuid()}: ` +
      `create after chmod 0555 was ${denied ? denied.code : "allowed"}`,
    );
    refused = install(built, prefix);
  } finally {
    try { fs.unlinkSync(path.join(bin, `.seal-precondition-${process.pid}`)); } catch { /* absent when create was denied */ }
    fs.chmodSync(bin, 0o755);
  }
  assert.notEqual(refused.code, 0, `${refused.stdout}${refused.stderr}`);
  assert.match(refused.stderr, /^REFUSE install_parent_unwritable:/m);
});

test("installed launcher rejects changed bytes and accepts restoration and prefix changes", () => {
  const built = buildArtifact();
  for (const name of ["fresh", "different prefix"]) {
    const prefix = path.join(built.out, name);
    const installed = install(built, prefix);
    assert.equal(installed.code, 0, `${installed.stdout}${installed.stderr}`);
    const launcher = path.join(prefix, "bin", "seal");
    const original = fs.readFileSync(launcher);
    const launch = () => run(process.execPath, [launcher, "--version"]);
    assert.equal(launch().stdout.trim(), VERSION);
    fs.chmodSync(launcher, 0o755);
    // Equal length mutation proves the digest check, not just the byte count.
    const changed = Buffer.from(original);
    const offset = changed.indexOf("SPDX");
    assert.ok(offset >= 0);
    changed[offset] = "X".charCodeAt(0);
    fs.writeFileSync(launcher, changed);
    const refused = launch();
    assert.equal(refused.code, 1);
    assert.match(refused.stderr, /^REFUSE launcher_digest_mismatch:/m);
    assert.equal(refused.stdout, "");
    fs.writeFileSync(launcher, original);
    const restored = launch();
    assert.equal(restored.code, 0, restored.stderr);
    assert.equal(restored.stdout.trim(), VERSION);
    const reinstalled = install(built, prefix);
    assert.equal(reinstalled.code, 0, reinstalled.stderr);
    assert.equal(launch().code, 0);
  }
});

// Product uninstall exercises the built installer and installed dispatcher.
let uninstallArtifact;
function uninstallBox() {
  uninstallArtifact ||= buildArtifact();
  const root = testTmpdir(path.join(SCRATCH_ROOT, 'uninstall-'));
  const home = path.join(root, 'home');
  const project = path.join(root, 'project');
  const prefix = path.join(root, 'prefix');
  const stubBin = path.join(root, 'client-bin');
  for (const dir of [home, project, stubBin]) fs.mkdirSync(dir);
  assert.equal(run('git', ['init', '-q', project]).code, 0);
  const env = { ...process.env, HOME: home, CLAUDE_CONFIG_DIR: home, XDG_DATA_HOME: path.join(home, 'data'), PATH: `${stubBin}${path.delimiter}${process.env.PATH}` };
  const config = path.join(home, '.claude.json');
  const server = path.join(root, 'server.cjs');
  fs.writeFileSync(server, `require('node:readline').createInterface({input:process.stdin}).on('line', line => {
    const q = JSON.parse(line); if (q.id === undefined) return;
    const result = q.method === 'initialize' ? {protocolVersion:'2024-11-05',capabilities:{tools:{}},serverInfo:{name:'test',version:'1'}} : q.method === 'tools/list' ? {tools:[{name:'inspect',inputSchema:{type:'object',properties:{}}}]} : {content:[]};
    console.log(JSON.stringify({jsonrpc:'2.0',id:q.id,result}));
  });\n`);
  const projectBytes = JSON.stringify({ mcpServers: { warehouse: { command: process.execPath, args: [server] } } }, null, 2) + '\n';
  fs.writeFileSync(path.join(project, '.mcp.json'), projectBytes);
  fs.writeFileSync(config, JSON.stringify({ theme: 'foreign', mcpServers: { foreign: {command:'foreign-server'} } }) + '\n');
  fs.writeFileSync(path.join(stubBin, 'claude'), `#!/usr/bin/env node
const fs=require('node:fs'), path=require('node:path');
const file=path.join(process.env.CLAUDE_CONFIG_DIR,'.claude.json');
const config=JSON.parse(fs.readFileSync(file)); const a=process.argv.slice(2); const name=a[4];
if(a[1]==='get') {const present=config.projects?.[process.cwd()]?.mcpServers?.[a[2]]; console.log(present?'  Scope: Local config (private)':'  Scope: Project config (shared)'); process.exit(0);}
config.projects ||= {}; config.projects[process.cwd()] ||= {}; const servers=config.projects[process.cwd()].mcpServers ||= {};
if(a[1]==='add') {const at=a.indexOf('--');servers[name]={type:'stdio',command:a[at+1],args:a.slice(at+2),env:{}};}
else if(a[1]==='remove') {delete servers[name];} else process.exit(2);
fs.writeFileSync(file,JSON.stringify(config,null,2)+'\\n');
`, { mode: 0o755 });
  const invoke = (argv, options = {}) => {
    const result = spawnSync(process.execPath, [path.join(prefix, 'bin/seal'), ...argv], { cwd: options.project || project, env: { ...env, ...options.env }, input: options.input ?? '', encoding: 'utf8', timeout: 20000 });
    return { code: result.status, out: (result.stdout || '') + (result.stderr || '') };
  };
  const installed = install(uninstallArtifact, prefix);
  assert.equal(installed.code, 0, installed.stderr);
  const protectedResult = invoke(['protect', 'warehouse', 'inspect']);
  assert.equal(protectedResult.code, 0, protectedResult.out);
  const recordPath = path.join(prefix, 'lib/seal/install.json');
  const record = () => JSON.parse(fs.readFileSync(recordPath));
  const statePath = require(path.join(prefix, record().store, "spine/protection.cjs")).statePathFor(project, env, "warehouse");
  return { root, home, project, prefix, env, config, projectBytes, invoke, statePath, recordPath, record };
}
function assertUninstallRouteRestored(box) {
  const config = JSON.parse(fs.readFileSync(box.config));
  assert.equal(config.projects?.[box.project]?.mcpServers?.warehouse, undefined, 'uninstall left a shadowing Seal MCP entry');
  assert.equal(fs.readFileSync(path.join(box.project, '.mcp.json'), 'utf8'), box.projectBytes);
  assert.equal(config.theme, 'foreign');
  assert.equal(config.mcpServers.foreign.command, 'foreign-server');
}

test('uninstall leaves no shadowing MCP entry and catches physical reinsertion', () => {
  const box = uninstallBox();
  const original = JSON.parse(fs.readFileSync(box.config));
  const result = box.invoke(['uninstall'], { input: 'yes\n' });
  assert.equal(result.code, 0, result.out);
  assertUninstallRouteRestored(box);
  assert.equal(fs.existsSync(path.join(box.prefix, 'bin/seal')), false);
  const clean = fs.readFileSync(box.config);
  const sha = bytes => require('node:crypto').createHash('sha256').update(bytes).digest('hex');
  const tampered = JSON.parse(clean);
  tampered.projects[box.project].mcpServers.warehouse = original.projects[box.project].mcpServers.warehouse;
  fs.writeFileSync(box.config, JSON.stringify(tampered));
  assert.throws(() => assertUninstallRouteRestored(box), /shadowing Seal MCP entry/);
  fs.writeFileSync(box.config, clean);
  assert.equal(sha(fs.readFileSync(box.config)), sha(clean));
  console.log(`physical reinsertion detected; restored config sha256 ${sha(clean)}`);
});

test('uninstall cancellation and EOF change no prefix or config bytes', () => {
  const box = uninstallBox();
  const before = fs.readFileSync(box.recordPath);
  const config = fs.readFileSync(box.config);
  const snapshot = directory => fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).map(entry => {
    const file = path.join(directory, entry.name);
    return [entry.name, entry.isDirectory() ? snapshot(file) : fs.readFileSync(file).toString('base64')];
  });
  const prefixBefore = snapshot(box.prefix);
  for (const input of ['n\n', '']) {
    const result = box.invoke(['uninstall'], { input });
    assert.equal(result.code, 0, result.out);
    assert.match(result.out, /Remove file:/);
    assert.match(result.out, /Uninstall cancelled/);
    assert.deepEqual(fs.readFileSync(box.recordPath), before);
    assert.deepEqual(snapshot(box.prefix), prefixBefore);
    assert.deepEqual(fs.readFileSync(box.config), config);
    assert.equal(fs.existsSync(path.join(box.prefix, 'lib/seal/lifecycle.lock')), false);
  }
});

test('uninstall preserves a foreign file inside its store and shared prefix directories', () => {
  const box = uninstallBox();
  const foreign = path.join(box.prefix, box.record().store, 'spine', 'foreign-notes.txt');
  fs.writeFileSync(foreign, 'another tool owns this');
  const result = box.invoke(['uninstall'], { input: 'y\n' });
  assert.equal(result.code, 0, result.out);
  assert.equal(fs.readFileSync(foreign, 'utf8'), 'another tool owns this');
  assertUninstallRouteRestored(box);
});

for (const problem of ['malformed', 'unreadable', 'edited route']) test(`uninstall refuses ${problem} client config before removing payload`, () => {
  const box = uninstallBox();
  if (problem === 'malformed') fs.writeFileSync(box.config, '{');
  else if (problem === 'unreadable') fs.chmodSync(box.config, 0o000);
  else {
    const config = JSON.parse(fs.readFileSync(box.config));
    config.projects[box.project].mcpServers.warehouse.args.push('--foreign-edit');
    fs.writeFileSync(box.config, JSON.stringify(config));
  }
  const before = fs.readFileSync(box.recordPath);
  const result = box.invoke(['uninstall'], { input: 'y\n' });
  assert.notEqual(result.code, 0, result.out);
  assert.equal(result.out.trim().split('\n').length, 1, 'a refusal must not re-enter uninstall through failure guidance');
  assert.deepEqual(fs.readFileSync(box.recordPath), before);
  assert.equal(box.invoke(['--version']).code, 0);
  if (problem === 'unreadable') fs.chmodSync(box.config, 0o600);
});

test('uninstall removes every recorded project in different client configs', () => {
  const box = uninstallBox();
  const second = path.join(box.root, 'second');
  const client = path.join(box.root, 'second-client');
  fs.mkdirSync(second); fs.mkdirSync(client);
  assert.equal(run('git', ['init', '-q', second]).code, 0);
  fs.writeFileSync(path.join(second, '.mcp.json'), box.projectBytes);
  fs.writeFileSync(path.join(client, '.claude.json'), '{}\n');
  const env = { CLAUDE_CONFIG_DIR: client };
  assert.equal(box.invoke(['protect', 'warehouse', 'inspect'], { project: second, env }).code, 0);
  // Removing just one project's protection must retain the other route.
  const unprotect = box.invoke(['unprotect', 'warehouse']);
  assert.equal(unprotect.code, 0, unprotect.out);
  assert.ok(JSON.parse(fs.readFileSync(path.join(client, '.claude.json'))).projects[second].mcpServers.warehouse);
  const result = box.invoke(['uninstall'], { input: 'y\n' });
  assert.equal(result.code, 0, result.out);
  assertUninstallRouteRestored(box);
  assert.equal(JSON.parse(fs.readFileSync(path.join(client, '.claude.json'))).projects[second].mcpServers.warehouse, undefined);
});

test('uninstall refuses a live wrapper lease and the wrapper still answers', async () => {
  const box = uninstallBox();
  const { spawn } = require('node:child_process');
  const child = spawn(process.execPath, [path.join(box.prefix, 'bin/seal'), '__proxy', '--protect-state', box.statePath], { cwd: box.project, env: box.env, stdio: ['pipe', 'pipe', 'pipe'] });
  const lines = require('node:readline').createInterface({ input: child.stdout });
  const responses = [];
  let stderr = '';
  child.stderr.on('data', b => { stderr += b; });
  lines.on('line', line => responses.push(JSON.parse(line)));
  const waitFor = async id => {
    const deadline = Date.now() + 10000;
    while (!responses.some(r => r.id === id)) {
      assert.ok(Date.now() < deadline, `wrapper response timed out: ${stderr}`);
      await new Promise(resolve => setTimeout(resolve, 20));
    }
  };
  try {
    child.stdin.write(JSON.stringify({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2024-11-05',capabilities:{elicitation:{}},clientInfo:{name:'test',version:'1'}}})+'\n');
    await waitFor(1);
    const result = box.invoke(['uninstall'], { input: 'yes\n' });
    assert.notEqual(result.code, 0, result.out);
    assert.match(result.out, /active wrapper/);
    child.stdin.write(JSON.stringify({jsonrpc:'2.0',id:2,method:'tools/list',params:{}})+'\n');
    await waitFor(2);
    assert.ok(responses.find(r => r.id === 2).result.tools.some(t => t.name === 'inspect'));
  } finally {
    lines.close(); child.stdin.end();
    await new Promise(resolve => child.exitCode !== null ? resolve() : child.once('exit', resolve));
  }
  const result = box.invoke(['uninstall'], { input: 'yes\n' });
  assert.equal(result.code, 0, result.out);
});

test('uninstall twice is a missing command, and reinstall can protect again', () => {
  const box = uninstallBox();
  const first = box.invoke(['uninstall'], { input: 'yes\n' });
  assert.equal(first.code, 0, first.out);
  const second = box.invoke(['uninstall'], { input: 'yes\n' });
  assert.notEqual(second.code, 0);
  assert.match(second.out, /MODULE_NOT_FOUND/);
  assertUninstallRouteRestored(box);
  const installed = install(uninstallArtifact, box.prefix);
  assert.equal(installed.code, 0, installed.stderr);
  const protectedAgain = box.invoke(['protect', 'warehouse', 'inspect']);
  assert.equal(protectedAgain.code, 0, protectedAgain.out);
});

test('uninstall preserves unrelated client edits made after protect', () => {
  const box = uninstallBox();
  const config = JSON.parse(fs.readFileSync(box.config));
  config.afterInstall = { chosenByUser: true };
  config.projects[box.project].mcpServers.other = { command: 'another-tool' };
  fs.writeFileSync(box.config, JSON.stringify(config));
  const result = box.invoke(['uninstall'], { input: 'y\n' });
  assert.equal(result.code, 0, result.out);
  const after = JSON.parse(fs.readFileSync(box.config));
  assert.deepEqual(after.afterInstall, { chosenByUser: true });
  assert.equal(after.projects[box.project].mcpServers.other.command, 'another-tool');
});

test('uninstall detects config changes made after its removal preview', async () => {
  const box = uninstallBox();
  const { spawn } = require('node:child_process');
  const child = spawn(process.execPath, [path.join(box.prefix, 'bin/seal'), 'uninstall'], { cwd: box.project, env: box.env, stdio: ['pipe', 'pipe', 'pipe'] });
  let out = '';
  child.stdout.on('data', b => { out += b; });
  let changed = false;
  child.stderr.on('data', b => {
    out += b;
    if (!changed && out.includes('Confirm uninstall?')) {
      changed = true;
      const config = JSON.parse(fs.readFileSync(box.config));
      config.concurrentEdit = 'retained';
      fs.writeFileSync(box.config, JSON.stringify(config));
      child.stdin.end('yes\n');
    }
  });
  const code = await new Promise(resolve => child.once('exit', resolve));
  assert.equal(changed, true, out);
  assert.notEqual(code, 0, out);
  assert.match(out, /files changed after preview/);
  assert.equal(box.invoke(['--version']).code, 0);
  assert.equal(JSON.parse(fs.readFileSync(box.config)).concurrentEdit, 'retained');
});

test('uninstall refuses payload symlink replacement and retains its foreign target', () => {
  const box = uninstallBox();
  const original = path.join(box.prefix, box.record().store, 'NOTICE');
  const foreign = path.join(box.root, 'foreign-notice');
  fs.writeFileSync(foreign, fs.readFileSync(original));
  fs.chmodSync(path.dirname(original), 0o755);
  fs.unlinkSync(original);
  fs.symlinkSync(foreign, original);
  const result = box.invoke(['uninstall'], { input: 'yes\n' });
  assert.notEqual(result.code, 0, result.out);
  assert.match(result.out, /symbolic link/);
  assert.ok(fs.existsSync(foreign));
});

test('uninstall refuses a route subsequently owned by a different installation', () => {
  const box = uninstallBox();
  assert.equal(box.invoke(['unprotect', 'warehouse']).code, 0);
  const second = path.join(box.root, 'other-prefix');
  assert.equal(install(uninstallArtifact, second).code, 0);
  const protectedAgain = spawnSync(process.execPath, [path.join(second, 'bin/seal'), 'protect', 'warehouse', 'inspect'], { cwd: box.project, env: box.env, encoding: 'utf8' });
  assert.equal(protectedAgain.status, 0, protectedAgain.stderr);
  const config = fs.readFileSync(box.config);
  const state = fs.readFileSync(box.statePath);
  const result = box.invoke(['uninstall'], { input: 'yes\n' });
  assert.notEqual(result.code, 0, result.out);
  assert.deepEqual(fs.readFileSync(box.config), config);
  assert.deepEqual(fs.readFileSync(box.statePath), state);
});

test('a cached installed module refuses mutations after its installation is removed', () => {
  const box = uninstallBox();
  const loaded = require(path.join(box.prefix, box.record().store, 'spine/uninstall.cjs'));
  const result = box.invoke(['uninstall'], { input: 'yes\n' });
  assert.equal(result.code, 0, result.out);
  assert.throws(() => loaded.installLock(), /installation was removed/);
  assertUninstallRouteRestored(box);
});

test("authorization rechecks the fixed installed tree and refuses without a kernel result", () => {
  const built = buildArtifact();
  const prefix = path.join(built.out, "runtime-check");
  assert.equal(install(built, prefix).code, 0);
  const recordPath = path.join(prefix, "lib/seal/install.json");
  const record = JSON.parse(fs.readFileSync(recordPath, "utf8"));
  const root = path.join(prefix, record.store);
  const { createRuntimeTreeCheck } = require("../spine/integrity.cjs");
  const { createApprovalContract } = require("../contract/contract.cjs");
  const check = createRuntimeTreeCheck(root);
  let kernelCalls = 0;
  const contract = createApprovalContract({ runtimeTreeCheck: check,
    kernelAdapter: { authorize() { kernelCalls++; return { verdict: "ALLOW" }; } } });
  function accept() {
    const call = { tool: "write", args: { line: "runtime" } };
    const requestState = contract.begin(call).result.requestState;
    return contract.retry({ ...call, requestState,
      inputResponses: { approval: { action: "accept", content: { approve: true } } } });
  }
  const file = path.join(root, "NOTICE");
  const original = fs.readFileSync(file);
  fs.chmodSync(file, 0o644);
  try {
    const bytes = Buffer.from(original); bytes[0] ^= 1;
    fs.writeFileSync(file, bytes);
    assert.equal(check().band, "FAIL");
    const failed = accept();
    assert.equal(failed.refusal, "runtime_tree_fail");
    assert.equal(failed.receipt, undefined);
    assert.equal(kernelCalls, 0);
  } finally { fs.writeFileSync(file, original); fs.chmodSync(file, 0o444); }
  fs.renameSync(recordPath, `${recordPath}.held`);
  try {
    assert.equal(check().band, "UNKNOWN");
    const unknown = accept();
    assert.equal(unknown.refusal, "runtime_tree_unknown");
    assert.equal(unknown.receipt, undefined);
    assert.equal(kernelCalls, 0);
  } finally { fs.renameSync(`${recordPath}.held`, recordPath); }
  assert.equal(accept().kind, "allow");
  assert.equal(accept().kind, "allow");
  assert.equal(kernelCalls, 2, "each clean approval enters the kernel");
  fs.chmodSync(root, 0o755);
  const extra = path.join(root, "unrecorded");
  try {
    fs.writeFileSync(extra, "not in the anchor");
    assert.equal(check().band, "FAIL");
    assert.equal(accept().refusal, "runtime_tree_fail");
    assert.equal(kernelCalls, 2, "the next approval must recheck the tree");
  } finally { fs.unlinkSync(extra); fs.chmodSync(root, 0o555); }
  assert.equal(createRuntimeTreeCheck(ROOT)().band, "UNKNOWN");
});

// Exercise the installed dispatcher, real approval/kernel path and lifecycle
// lock together. The client shim only stands in for Claude's config writes.
function installedSession(box, statePath) {
  const { spawn } = require('node:child_process');
  const child = spawn(process.execPath, [path.join(box.prefix, 'bin/seal'), '__proxy', '--protect-state', statePath],
    { cwd: box.project, env: box.env, stdio: ['pipe', 'pipe', 'pipe'] });
  const frames = [];
  let stderr = '';
  child.stderr.on('data', b => { stderr += b; });
  const lines = require('node:readline').createInterface({ input: child.stdout });
  lines.on('line', line => frames.push(JSON.parse(line)));
  const send = frame => child.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...frame }) + '\n');
  async function receive(predicate) {
    const deadline = Date.now() + 15000;
    for (;;) {
      const at = frames.findIndex(predicate);
      if (at >= 0) return frames.splice(at, 1)[0];
      assert.equal(child.exitCode, null, stderr);
      assert.ok(Date.now() < deadline, `installed session timed out: ${stderr}`);
      await new Promise(resolve => setTimeout(resolve, 10));
    }
  }
  return {
    child, stderr: () => stderr,
    async initialize() {
      send({ id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: { elicitation: {} }, clientInfo: { name: 'assembly', version: '1' } } });
      await receive(r => r.id === 1);
    },
    async approve(id) {
      send({ id, method: 'tools/call', params: { name: 'inspect', arguments: {} } });
      const prompt = await receive(r => r.method === 'elicitation/create');
      send({ id: prompt.id, result: { action: 'accept', content: { approve: true } } });
      return receive(r => r.id === id);
    },
    async stop() {
      child.stdin.end();
      await new Promise(resolve => child.exitCode !== null ? resolve() : child.once('exit', resolve));
      lines.close();
    },
  };
}

function secondInstalledRoute(box) {
  const config = JSON.parse(fs.readFileSync(path.join(box.project, '.mcp.json')));
  config.mcpServers.second = config.mcpServers.warehouse;
  fs.writeFileSync(path.join(box.project, '.mcp.json'), JSON.stringify(config));
  const protectedResult = box.invoke(['protect', 'second', 'inspect']);
  assert.equal(protectedResult.code, 0, protectedResult.out);
  const installed = require(path.join(box.prefix, box.record().store, 'spine/protection.cjs'));
  return installed.statePathFor(box.project, box.env, 'second');
}

test('installed assembly: register B while A runs, approve A, wait for installation lock, uninstall both', async t => {
  const box = uninstallBox();
  const a = installedSession(box, box.statePath);
  let b;
  try {
    await a.initialize();
    assert.ok(!(await a.approve(2)).result.isError, 'initial approval must ALLOW');
    const anchor = fs.readFileSync(box.recordPath);
    const stateB = secondInstalledRoute(box);
    assert.deepEqual(fs.readFileSync(box.recordPath), anchor, "protect B must not rewrite any anchor byte");
    await t.test('route registration preserves running authorization', async () => {
      const result = await a.approve(3);
      assert.ok(!result.result.isError, JSON.stringify(result));
      console.log('ASSEMBLY route A approval after protect B: ALLOW');
    });
    await t.test('startup waits through a legitimate installation operation', async () => {
      const lifecycle = require(path.join(box.prefix, box.record().store, 'spine/uninstall.cjs'));
      const lock = lifecycle.installLock();
      const timer = setTimeout(() => lock.release(), 500);
      const started = performance.now();
      try {
        b = installedSession(box, stateB);
        await b.initialize();
        assert.ok(performance.now() - started >= 450, 'startup must wait for the holder');
        console.log(`ASSEMBLY B startup waited ${Math.round(performance.now() - started)}ms and succeeded`);
      } finally { clearTimeout(timer); lock.release(); }
    });
  } finally { await a.stop(); if (b) await b.stop(); }
  const owned = box.record().ownership.paths.filter(e => e.kind === 'file');
  const foreign = path.join(box.prefix, 'foreign.txt');
  fs.writeFileSync(foreign, 'retain me');
  const result = box.invoke(['uninstall'], { input: 'yes\n' });
  assert.equal(result.code, 0, result.out);
  for (const entry of owned) assert.equal(fs.existsSync(path.join(box.prefix, entry.path)), false, entry.path);
  const config = JSON.parse(fs.readFileSync(box.config));
  assert.deepEqual(config.projects[box.project].mcpServers, {});
  assert.equal(config.mcpServers.foreign.command, 'foreign-server');
  assert.equal(fs.readFileSync(foreign, 'utf8'), 'retain me');
  console.log('ASSEMBLY uninstall removed every owned file and both routes; foreign file retained');
});

test('installed assembly negative controls: program and immutable record tampering refuse the next approval', async () => {
  const box = uninstallBox();
  const a = installedSession(box, box.statePath);
  try {
    await a.initialize();
    assert.ok(!(await a.approve(2)).result.isError);
    const program = path.join(box.prefix, box.record().store, 'spine/demo.cjs');
    const bytes = fs.readFileSync(program);
    fs.chmodSync(program, 0o644);
    try {
      const tampered = Buffer.from(bytes); tampered[0] ^= 1;
      fs.writeFileSync(program, tampered);
      const result = await a.approve(3);
      assert.equal(result.result.isError, true);
      assert.match(JSON.stringify(result), /runtime_tree_fail/);
      console.log('ASSEMBLY one installed program byte changed: next approval runtime_tree_fail');
    } finally { fs.writeFileSync(program, bytes); fs.chmodSync(program, 0o444); }
    const anchor = fs.readFileSync(box.recordPath);
    fs.chmodSync(box.recordPath, 0o644);
    try {
      // Even a semantically identical JSON record is a replacement of pinned bytes.
      fs.writeFileSync(box.recordPath, Buffer.concat([anchor, Buffer.from(' ')]));
      assert.match(JSON.stringify(await a.approve(4)), /runtime_tree_fail/);
    } finally { fs.writeFileSync(box.recordPath, anchor); fs.chmodSync(box.recordPath, 0o444); }
    assert.ok(!(await a.approve(5)).result.isError, 'restoring exact bytes permits the original anchor');
  } finally { await a.stop(); }
  assert.equal(box.invoke(['uninstall'], { input: 'yes\n' }).code, 0);
});

test('installed assembly negative controls: lock timeout, stale owner and invalid owner refuse startup without writes', async () => {
  const box = uninstallBox();
  const lifecycle = require(path.join(box.prefix, box.record().store, 'spine/uninstall.cjs'));
  const { spawn } = require('node:child_process');
  const lockPath = path.join(box.prefix, 'lib/seal/lifecycle.lock');
  const state = fs.readFileSync(box.statePath);
  async function refused() {
    const started = performance.now();
    const child = spawn(process.execPath, [path.join(box.prefix, 'bin/seal'), '__proxy', '--protect-state', box.statePath],
      { cwd: box.project, env: box.env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', b => { out += b; });
    child.stderr.on('data', b => { out += b; });
    const code = await new Promise(resolve => child.once('exit', resolve));
    assert.equal(code, 1, out);
    assert.match(out, /startup refused:/);
    assert.doesNotMatch(out, /uninstall refused/);
    assert.deepEqual(fs.readFileSync(box.statePath), state, 'refused startup must not alter route state');
    return { out, elapsed: performance.now() - started };
  }
  const lock = lifecycle.installLock();
  try {
    const result = await refused();
    assert.ok(result.elapsed >= 3200, result.out);
    assert.match(result.out, /timed out after waiting \d+ms to acquire the installation lock held by pid/);
    console.log(`ASSEMBLY timeout ${Math.round(result.elapsed)}ms: ${result.out.trim()}`);
  } finally { lock.release(); }
  for (const owner of ['invalid\n', JSON.stringify({ pid: process.pid, startWitness: 'wrong-start' })]) {
    fs.writeFileSync(lockPath, owner, { flag: 'wx', mode: 0o600 });
    try {
      const result = await refused();
      assert.match(result.out, /stale or invalid installation lock/);
      assert.doesNotMatch(result.out, /timed out/);
      assert.equal(fs.readFileSync(lockPath, 'utf8'), owner, 'invalid locks require inspection, never automatic removal');
    } finally { fs.unlinkSync(lockPath); }
  }
  assert.equal(box.invoke(['uninstall'], { input: 'yes\n' }).code, 0);
});

test('reinstall preserves the separate mutable route registry', () => {
  const box = uninstallBox();
  const registryPath = path.join(box.prefix, 'lib/seal/routes.json');
  const before = fs.readFileSync(registryPath);
  assert.equal(install(uninstallArtifact, box.prefix).code, 0);
  assert.deepEqual(fs.readFileSync(registryPath), before);
  assert.equal(box.invoke(['uninstall'], { input: 'yes\n' }).code, 0);
  assertUninstallRouteRestored(box);
});
