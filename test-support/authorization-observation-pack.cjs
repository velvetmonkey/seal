// SPDX-License-Identifier: Apache-2.0
"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
// Observation TCB: this models only Claude's local route registration, never
// protect-state, authorization, the kernel, or child effects. Human origin is
// explicitly outside the release claim.
function fakeClaudeBin(root) {
  const bin = path.join(root, "bin");
  fs.mkdirSync(bin, { recursive: true });
  const script = path.join(bin, "claude");
  fs.writeFileSync(script, `#!/usr/bin/env node
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

async function installPack({root, dir, projectRoot}) {
  const packBytes = fs.readFileSync(path.join(root, "runtime/observation-guard.json"));
  const pack = JSON.parse(packBytes);
  assert.equal(pack.schema, "seal.observation-guard/v1", "observation-pack:schema");
  assert.equal(pack.approvalTtlMs, 120000, "observation-pack:product-default-ttl");
  assert.equal(pack.ttlSource, "proxy-constructor-default", "observation-pack:ttl-source");
  assert.deepEqual(pack.guardPredicates, [], "observation-pack:unsupported-predicates");
  assert.deepEqual(pack.guardSelections, pack.guardTools.map(name => ({name, predicate: null})),
    "observation-pack:declared-selections");
  const env = {...process.env,
    PATH: fakeClaudeBin(dir) + path.delimiter + process.env.PATH,
    CLAUDE_CONFIG_DIR: path.join(dir, "claude-config"),
    XDG_DATA_HOME: path.join(dir, "data-home")};
  delete env.SEAL_CORRESPONDENCE;
  const protection = require(path.join(root, "spine/protection.cjs"));
  const result = await protection.protect({serverName: "demo", guardTools: pack.guardTools,
    projectRoot, sealBin: path.join(root, "bin/seal"), env});
  assert.deepEqual(protection.protectedToolSelections(protection.readState(result.statePath)),
    pack.guardSelections, "observation-pack:installed-protect-selections");
  return {env, statePath: result.statePath, pack,
    observation_guard_sha256: crypto.createHash("sha256").update(packBytes).digest("hex")};
}
module.exports = {installPack};
