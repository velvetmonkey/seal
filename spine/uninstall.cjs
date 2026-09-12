// SPDX-License-Identifier: Apache-2.0
// Installation ownership is recorded when paths are first created. Contents
// alone are not evidence that Seal created a pre-existing path.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const os = require('node:os');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const canonical = value => Array.isArray(value) ? `[${value.map(canonical)}]` : value && typeof value === 'object'
  ? `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`)}}` : JSON.stringify(value);
function fail(reason) { throw new Error(`uninstall refused: ${reason}`); }
function stat(file) { try { return fs.lstatSync(file); } catch (e) { if (e.code === 'ENOENT') return null; throw e; } }
function regular(file) {
  const s = stat(file);
  if (!s?.isFile() || !(s.mode & 0o444)) fail(`not a readable regular file: ${file}`);
  return fs.readFileSync(file);
}
function inside(prefix, relative) {
  if (typeof relative !== 'string' || path.isAbsolute(relative) || relative.split(/[\\/]/).includes('..')) fail('invalid ownership path');
  const full = path.resolve(prefix, relative);
  if (full !== prefix && !full.startsWith(prefix + path.sep)) fail('ownership path escapes prefix');
  for (let part = full; part !== path.dirname(prefix); part = path.dirname(part)) {
    const s = stat(part);
    if (s?.isSymbolicLink()) fail(`symbolic link in removal path: ${part}`);
  }
  return full;
}
function installation(root = path.resolve(__dirname, '..')) {
  const prefix = path.resolve(root, '../../../..');
  const recordPath = path.join(prefix, 'lib/seal/install.json');
  const installedLayout = path.dirname(root) === path.join(prefix, 'lib/seal/store') && /^[0-9a-f]{64}$/.test(path.basename(root));
  if (!stat(recordPath)) {
    if (installedLayout) fail('installation was removed; this operation cannot continue');
    return null;
  }
  const record = JSON.parse(regular(recordPath));
  const recordedRoot = path.resolve(prefix, record.store) === root || record.ownership?.paths?.some(entry => entry.path === path.relative(prefix, path.join(root, 'bin/seal')));
  if (record.schema !== 'seal.install/v1' || !recordedRoot || !installedLayout) {
    if (installedLayout) fail('installed payload is no longer registered; this operation cannot continue');
    return null;
  }
  return { prefix, root, recordPath, record };
}
// Shared by all installed project mutations, including activation. A crashed
// lock is a refusal requiring inspection, never permission to delete a file.
function installLock(install = installation(), operation = 'uninstall') {
  if (!install) return { release() {} };
  const { ProtectionError, processStartWitness, lockOwnerIsLive } = require('./protection.cjs');
  const refuse = (code, reason) => { throw new ProtectionError(code, `${operation} refused: ${reason}`); };
  const file = path.join(install.prefix, 'lib/seal/lifecycle.lock');
  const owner = { pid: process.pid, startWitness: processStartWitness(process.pid) };
  if (!owner.startWitness) refuse('installation_lock_invalid', 'cannot establish installation-lock process-start witness');
  // Publish complete owner bytes atomically: a competing startup must never
  // observe our newly created lock before its owner record has been written.
  const temporary = `${file}.${process.pid}.${crypto.randomBytes(8).toString('hex')}`;
  fs.writeFileSync(temporary, JSON.stringify(owner) + '\n', { flag: 'wx', mode: 0o600 });
  const identity = fs.lstatSync(temporary);
  try {
    fs.linkSync(temporary, file);
  } catch (error) {
    if (error.code !== 'EEXIST') refuse('installation_lock_invalid', `cannot acquire installation lock ${file}: ${error.code}`);
    let existing;
    try {
      const current = fs.lstatSync(file);
      if (!current.isFile() || !(current.mode & 0o444)) throw new Error('not a readable regular file');
      existing = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (!Number.isSafeInteger(existing.pid) || existing.pid <= 0 || typeof existing.startWitness !== 'string' || !existing.startWitness) throw new Error('invalid owner record');
      if (!lockOwnerIsLive(existing, 'installation-lock owner')) throw new Error('stale owner');
    } catch (invalid) {
      // A holder can release between EEXIST and reading its record.
      if (invalid.code === 'ENOENT') return installLock(install, operation);
      refuse('installation_lock_invalid', `stale or invalid installation lock ${file}: ${invalid.message}; inspect the lock before retrying`);
    }
    const contention = new ProtectionError('installation_lock_active', `${operation} refused: installation lock held by pid ${existing.pid}; retry after that Seal operation finishes`);
    contention.lockHolderPid = existing.pid;
    throw contention;
  } finally { fs.unlinkSync(temporary); }
  let released = false;
  return { release() {
    if (released) return;
    released = true;
    const current = stat(file);
    if (current?.ino === identity.ino && current.dev === identity.dev) fs.unlinkSync(file);
  } };
}
function routeRegistry(install) {
  if (!install.record.routeRegistry) return { file: null, routes: install.record.routes || [] };
  if (install.record.routeRegistry !== 'lib/seal/routes.json') fail('invalid route registry path');
  const file = inside(install.prefix, install.record.routeRegistry);
  const bytes = regular(file);
  const registry = JSON.parse(bytes);
  if (registry.schema !== 'seal.routes/v1' || !Array.isArray(registry.routes)) fail('invalid route registry');
  return { file, bytes, routes: registry.routes };
}
// Called under the installation lock BEFORE Claude can write its override.
function registerRoute(statePath, state, env) {
  const install = installation();
  if (!install) return;
  const route = { statePath, configPath: path.resolve(env.CLAUDE_CONFIG_DIR || env.HOME || os.homedir(), '.claude.json'),
    projectRoot: state.localOverride.claudeProjectRoot, serverName: state.serverName,
    definition: state.localOverride.definition };
  const registry = routeRegistry(install);
  if (!registry.file) fail('route registration requires reinstalling Seal with a separate route registry');
  const routes = [...registry.routes.filter(r => r.statePath !== statePath), route];
  atomicReplace(registry.file, JSON.stringify({ schema: 'seal.routes/v1', routes }, null, 2) + '\n', registry.bytes);
}
function plan(install, env = process.env) {
  const { prefix, root, recordPath } = install;
  const recordBytes = regular(recordPath);
  const record = JSON.parse(recordBytes);
  if (record.ownership?.schema !== 'seal.created-paths/v1' || !record.ownership.paths.some(e => e.path === 'bin/seal') || !record.ownership.paths.some(e => e.path === 'lib/seal/install.json')) fail('this install has no creation ledger; automatic file removal cannot establish ownership');
  const snapshots = new Map([[recordPath, recordBytes]]);
  const configPaths = new Set([path.resolve(env.CLAUDE_CONFIG_DIR || env.HOME || os.homedir(), '.claude.json')]);
  const registry = routeRegistry({ ...install, record });
  if (registry.file) snapshots.set(registry.file, registry.bytes);
  const routes = [...registry.routes];
  for (const route of routes) configPaths.add(route.configPath);
  const configs = [];
  const states = new Map();
  const { lockOwnerIsLive } = require('./protection.cjs');
  for (const configPath of configPaths) {
    if (!stat(configPath)) continue;
    const bytes = regular(configPath);
    const data = JSON.parse(bytes);
    if (!data || typeof data !== 'object' || Array.isArray(data)) fail(`invalid client configuration: ${configPath}`);
    snapshots.set(configPath, bytes);
    configs.push({ file: configPath, data, changes: [] });
    // Discover old routes and copies in ALL local scopes and user scope. Only
    // a matching ownership definition is removable; a suspicious edit refuses.
    const scopes = [['user', data.mcpServers], ...Object.entries(data.projects || {}).map(([key, p]) => [key, p?.mcpServers])];
    for (const [scope, servers] of scopes) {
      if (!servers) continue;
      if (typeof servers !== 'object' || Array.isArray(servers)) fail(`invalid MCP scope in ${configPath}`);
      for (const [name, definition] of Object.entries(servers)) {
        const command = definition?.command;
        const targetsInstall = typeof command === 'string' && (command === path.join(prefix, 'bin/seal') || command === path.join(root, 'bin/seal') || command.startsWith(path.join(prefix, 'lib/seal/store') + path.sep));
        const registered = routes.find(r => r.configPath === configPath && r.projectRoot === scope && r.serverName === name);
        if (!targetsInstall && !registered) continue;
        const args = definition?.args;
        const statePath = registered?.statePath || (Array.isArray(args) && args[0] === '__proxy' && args[1] === '--protect-state' && args.length === 3 ? args[2] : null);
        if (typeof statePath !== 'string' || !path.isAbsolute(statePath)) fail(`unrecognised Seal route ${name} in ${configPath}`);
        const stateBytes = regular(statePath);
        const state = JSON.parse(stateBytes);
        const owned = state?.localOverride;
        if (state.schema !== 'seal.protect/v1' || !owned || owned.serverName !== name || state.serverName !== name || canonical(definition) !== canonical(owned.definition) || (registered && canonical(definition) !== canonical(registered.definition))) fail(`client route was edited: ${name} in ${configPath}`);
        if (lockOwnerIsLive(state.lease)) fail(`active wrapper for ${name}; stop Claude Code and retry`);
        snapshots.set(statePath, stateBytes);
        states.set(statePath, state);
        configs.at(-1).changes.push({ scope, name, servers });
      }
    }
  }
  // A removed config entry does not make an already-running proxy safe to
  // delete. Inspect every registered state even when its entry is absent.
  for (const route of routes) {
    if (!stat(route.statePath)) fail(`registered protection state is missing: ${route.statePath}`);
    const bytes = regular(route.statePath);
    const state = JSON.parse(bytes);
    if (canonical(state.localOverride?.definition) !== canonical(route.definition)) fail(`registered protection state was replaced: ${route.statePath}`);
    if (lockOwnerIsLive(state.lease)) fail(`active wrapper for ${route.serverName}; stop Claude Code and retry`);
    snapshots.set(route.statePath, bytes);
    states.set(route.statePath, state);
  }
  const files = [];
  const dirs = [];
  for (const entry of record.ownership.paths) {
    const full = inside(prefix, entry.path);
    const s = stat(full);
    if (!s) continue;
    if (entry.kind === 'directory') {
      if (!s.isDirectory()) fail(`created directory was replaced: ${full}`);
      dirs.push(full);
    } else {
      const bytes = regular(full);
      if (full !== recordPath && full !== registry.file && hash(bytes) !== entry.sha256) fail(`created file was edited: ${full}`);
      snapshots.set(full, bytes);
      files.push(full);
    }
  }
  // The record is removed last so a failed removal retains ownership evidence.
  files.sort((a, b) => (a === recordPath ? 1 : b === recordPath ? -1 : a.localeCompare(b)));
  dirs.sort((a, b) => b.length - a.length);
  return { configs, states, snapshots, files, dirs, recordPath };
}
function atomicReplace(file, output, expected) {
  const temporary = `${file}.seal-uninstall-${process.pid}`;
  let fd;
  try {
    fd = fs.openSync(temporary, 'wx', fs.statSync(file).mode & 0o777);
    fs.writeFileSync(fd, output); fs.fsyncSync(fd);
  } catch (error) {
    if (fd !== undefined) { fs.closeSync(fd); fs.unlinkSync(temporary); }
    throw error;
  }
  fs.closeSync(fd);
  try {
    if (!regular(file).equals(expected)) fail(`file changed during uninstall: ${file}`);
    fs.renameSync(temporary, file);
  } catch (error) { fs.unlinkSync(temporary); throw error; }
}
async function run(args, ask, env = process.env) {
  if (args.length) fail('usage: seal uninstall');
  const install = installation();
  if (!install) fail('run the installed seal command');
  const preview = plan(install, env);
  console.log('Uninstall this Seal installation from every recorded project.');
  for (const config of preview.configs) for (const change of config.changes) console.log(`Remove MCP entry: ${JSON.stringify({ file: config.file, scope: change.scope, server: change.name })}`);
  console.log(`Temporary file (create then remove): ${JSON.stringify(path.join(install.prefix, 'lib/seal/lifecycle.lock'))}`);
  for (const file of [...preview.configs.filter(c => c.changes.length).map(c => c.file), ...preview.states.keys()]) {
    console.log(`Temporary file (create then remove): ${JSON.stringify(`${file}.seal-uninstall-${process.pid}`)}`);
  }
  for (const file of preview.states.keys()) console.log(`Clear protection state: ${JSON.stringify(file)}`);
  for (const file of preview.files) console.log(`Remove file: ${JSON.stringify(file)}`);
  for (const dir of preview.dirs) console.log(`Remove directory if empty: ${JSON.stringify(dir)}`);
  console.log('Retain protection history, approval journals, receipts and signing keys.');
  const answer = await ask('Confirm uninstall? [y/N] ');
  if (answer.kind !== 'answer' || !['y', 'yes'].includes(answer.value)) {
    console.log('Uninstall cancelled; no files were changed.'); return;
  }
  const lock = installLock(install);
  try {
    const current = plan(install, env);
    if (canonical([...preview.snapshots].map(([p, b]) => [p, hash(b)])) !== canonical([...current.snapshots].map(([p, b]) => [p, hash(b)]))) fail('files changed after preview; retry');
    // Config first. If a write fails, the still-installed command remains
    // available. Check bytes immediately before each edit to detect drift.
    for (const config of current.configs) {
      if (!config.changes.length) continue;
      if (!regular(config.file).equals(current.snapshots.get(config.file))) fail(`client configuration changed: ${config.file}`);
      for (const change of config.changes) delete change.servers[change.name];
      atomicReplace(config.file, JSON.stringify(config.data, null, 2) + '\n', current.snapshots.get(config.file));
    }
    for (const [file, state] of current.states) {
      if (!regular(file).equals(current.snapshots.get(file))) fail(`protection state changed: ${file}`);
      const next = { ...state, state: 'UNPROTECTED', lease: null, unprotectedAt: new Date().toISOString() };
      atomicReplace(file, JSON.stringify(next, null, 2) + '\n', current.snapshots.get(file));
    }
    for (const file of current.files) {
      if (!regular(file).equals(current.snapshots.get(file))) fail(`file changed during uninstall: ${file}`);
      const parent = path.dirname(file);
      if (current.dirs.includes(parent)) fs.chmodSync(parent, fs.statSync(parent).mode | 0o700);
      fs.unlinkSync(file);
    }
    lock.release();
    for (const dir of current.dirs) {
      try { fs.rmdirSync(dir); }
      catch (e) { if (e.code !== 'ENOTEMPTY' && e.code !== 'EEXIST') throw e; }
    }
    console.log('Seal uninstall completed; nonempty shared directories were preserved.');
  } finally { lock.release(); }
}
module.exports = { installation, installLock, registerRoute, run, plan };
