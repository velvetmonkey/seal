// SPDX-License-Identifier: Apache-2.0
// Execute the guide's shell commands and pin its observed lines with the
// repository's synthetic Claude Code client adapted to the db demo tools.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const test = require('node:test');
const { testTmpdir } = require('../scripts/temp-root.cjs');

const root = path.resolve(__dirname, '..');
// CLAIM-COVERAGE: docs/guide/protect-your-first-tool.md#guide-commands-and-output
const page = fs.readFileSync(path.join(root, 'docs/guide/protect-your-first-tool.md'), 'utf8');
const capturedState = /\/mnt\/scratch\/lanes\/sealfirsttoolwalk\/cold\/xdg\/seal\/projects\/[a-f0-9]+\/servers\/db\/state\.json/g;

function run(file, args, options = {}) {
  const result = spawnSync(file, args, { encoding: 'utf8', timeout: 30000, ...options });
  assert.equal(result.status, 0, `${file} ${args.join(' ')}\n${result.stdout}\n${result.stderr}`);
  return result.stdout + result.stderr;
}

function adaptedClient(target) {
  let source = fs.readFileSync(path.join(root, 'harness/claude-code/synthetic-client.cjs'), 'utf8');
  source = source.replace('const SERVER_NAME = "notes";', 'const SERVER_NAME = "db";');
  source = source.replace('const GUARDED_TOOL = "append_note";', '');
  source = source.replace('  const scenario = process.env.SEAL_CC_SYNTHETIC_CASE || "activation";',
    '  const scenario = process.env.SEAL_CC_SYNTHETIC_CASE || "activation";\n  const GUARDED_TOOL = scenario === "mutate" ? "demo.mutate" : "demo.erase";');
  source = source.replace('if (scenario === "activation") return;',
    'if (scenario === "activation") { await new Promise((resolve) => setTimeout(resolve, 12000)); return; }');
  source = source.replace('const answered = await link.request("tools/call", { name: GUARDED_TOOL, arguments: { note } });\n    if (!elicitationMessage)',
    'const answered = await link.request("tools/call", { name: GUARDED_TOOL, arguments: scenario === "mutate" ? { line: note } : {} });\n    if (scenario !== "mutate" && !elicitationMessage)');
  source = source.replace('    process.stdout.write(`result: ${JSON.stringify(answered.result)}\\n`);',
    '    if (scenario === "mutate" && elicitationMessage) throw new Error("selective walk: demo.mutate showed an approval dialog");\n    process.stdout.write(`result: ${JSON.stringify(answered.result)}\\n`);');
  fs.writeFileSync(target, source);
}

test('guide commands and expected output lines match a selective synthetic walk', async () => {
  const scratch = testTmpdir(path.join(os.tmpdir(), 'seal-first-tool-doc-'));
  const project = path.join(scratch, 'project');
  const config = path.join(scratch, 'config');
  const xdg = path.join(scratch, 'xdg');
  const home = path.join(scratch, 'home');
  const dist = path.join(scratch, 'dist');
  const prefix = path.join(scratch, 'installed');
  for (const directory of [project, config, xdg, home, dist]) fs.mkdirSync(directory, { recursive: true });
  run(process.execPath, [path.join(root, 'scripts/build-dist.cjs'), '--platform', 'linux-x64', '--out', dist], { cwd: root });
  const [digest, bytes, name] = fs.readFileSync(path.join(dist, 'SHA256SUMS'), 'utf8').trim().split(/\s+/);
  run(path.join(dist, name), ['--sha256', digest, '--bytes', bytes, '--prefix', prefix], { cwd: scratch });
  const env = { ...process.env, HOME: home, CLAUDE_CONFIG_DIR: config, XDG_DATA_HOME: xdg,
    PATH: `${path.join(prefix, 'bin')}${path.delimiter}${process.env.PATH}` };
  const client = path.join(scratch, 'synthetic-db-client.cjs');
  adaptedClient(client);
  const bashBlocks = [...page.matchAll(/```bash\n([\s\S]*?)\n```/g)].map((m) => m[1]);
  const outputBlocks = [...page.matchAll(/```output\n([\s\S]*?)\n```/g)].map((m) => m[1]);
  assert.equal(bashBlocks.length, 7, 'guide shell command blocks drifted');
  assert.equal(outputBlocks.length, 13, 'guide expected output blocks drifted');
  assert.match(bashBlocks[1], /^seal protect db /);
  assert.match(bashBlocks[2], /^seal status$/);
  assert.match(bashBlocks[3], /^seal status$/);
  assert.equal(bashBlocks[4], 'seal history /mnt/scratch/lanes/sealfirsttoolwalk/cold/xdg/seal/projects/3c3eddb5aed87a8793c1039c9e2c0016/servers/db/receipts --limit 5',
    'guide history command drifted from the captured receipts path');
  assert.match(bashBlocks[5], /^seal unprotect db/);
  assert.match(bashBlocks[6], /^seal status$/);
  const shell = (command) => run('bash', ['-c', command], { cwd: project, env });
  const before = shell(bashBlocks[0]);
  const protect = shell(bashBlocks[1]);
  const statePath = protect.match(/Sealed MCP route db: PENDING RESTART \(([^)]+)\)/)?.[1];
  assert.ok(statePath, protect);
  const pending = shell(bashBlocks[2]);
  const activation = spawn(process.execPath, [client], { cwd: project,
    env: { ...env, SEAL_CC_SYNTHETIC_CASE: 'activation' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let activationOutput = '';
  activation.stdout.on('data', (chunk) => { activationOutput += chunk; });
  activation.stderr.on('data', (chunk) => { activationOutput += chunk; });
  let active = '';
  for (let attempt = 0; attempt < 20; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    active = shell(bashBlocks[2]);
    if (active.includes('LEASE ACTIVE')) break;
  }
  assert.match(active, /LEASE ACTIVE/, activationOutput);
  await new Promise((resolve, reject) => activation.once('exit', (code) => code === 0 ? resolve() : reject(new Error(activationOutput))));
  const clientRun = (scenario, note) => run(process.execPath, [client], { cwd: project,
    env: { ...env, SEAL_CC_SYNTHETIC_CASE: scenario, SEAL_CC_SYNTHETIC_NOTE: note || 'seal-accepted-note' } });
  const mutate = clientRun('mutate', 'first line');
  assert.doesNotMatch(mutate, /Approve one run|selective walk: demo\.mutate showed an approval dialog/,
    'selective walk: demo.mutate must pass without a dialog');
  const afterMutate = shell('sha256sum data.txt');
  const decline = clientRun('decline');
  const afterDecline = shell('sha256sum data.txt');
  assert.equal(afterDecline, afterMutate, 'decline must leave data.txt unchanged');
  const accept = clientRun('accept');
  const afterAccept = shell('sha256sum data.txt');
  const stale = shell(bashBlocks[3]);
  const receiptDir = path.join(path.dirname(statePath), 'receipts');
  const historyCommand = bashBlocks[4].replace(/seal history \S+ --limit 5/, `seal history ${receiptDir} --limit 5`);
  const history = shell(historyCommand);
  const undo = shell(bashBlocks[5]);
  const unprotected = shell(bashBlocks[6]);
  const actual = [before, protect, pending, active, mutate, decline, afterDecline, accept, afterAccept, stale, history, undo, unprotected];
  for (let i = 0; i < outputBlocks.length; i++) {
    const expectedLines = outputBlocks[i].replace(capturedState, statePath).split('\n');
    for (const line of expectedLines) {
      if (!line) continue;
      const comparable = /^\d{13} (ALLOW|BLOCK) /.test(line)
        ? actual[i].split('\n').some((candidate) => candidate.replace(/^\d{13} /, '') === line.replace(/^\d{13} /, ''))
        : actual[i].split('\n').includes(line);
      assert.ok(comparable, `page expected output line drifted in block ${i + 1}: ${line}\nActual:\n${actual[i]}`);
    }
  }
});
