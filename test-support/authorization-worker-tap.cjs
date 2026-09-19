// SPDX-License-Identifier: Apache-2.0
"use strict";
// Observation TCB, never packaged. Observe actual ccall arguments/results, not
// the candidate worker's summary. All original functions receive unchanged args.
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const cp = require("node:child_process");
const root = fs.realpathSync(process.env.SEAL_OBSERVATION_ROOT);
const output = process.env.SEAL_OBSERVATION_TAP;
const hash = bytes => require("node:crypto").createHash("sha256").update(bytes).digest("hex");
function record(kind, value) {
  const fd = fs.openSync(output, "a", 0o600);
  try { fs.writeFileSync(fd, JSON.stringify({pid:process.pid, kind, ...value}) + "\n"); fs.fsyncSync(fd); }
  finally { fs.closeSync(fd); }
}
const originalLoad = Module._load;
const wrapped = new WeakSet();
Module._load = function(id, parent, main) {
  const value = originalLoad.apply(this, arguments);
  let file;
  try { file = Module._resolveFilename(id, parent); } catch { return value; }
  if (typeof file !== "string" || !file.startsWith(root + path.sep) || wrapped.has(value)) return value;
  if (file === path.join(root, "runtime/kernel/runner.cjs")) {
    wrapped.add(value);
    const decide = value.decide;
    value.decide = async function(...args) {
      const {M} = await value.load();
      const ccall = M.ccall;
      M.ccall = function(name, ...rest) {
        const input = rest[2];
        if (name === "seal_decide") record("seal_decide_input", {bytes: input[0], sha256: hash(input[0])});
        const result = ccall.call(this, name, ...rest);
        if (name === "seal_decide") record("seal_decide_output", {bytes: result, sha256: hash(result)});
        return result;
      };
      try { return await decide.apply(this, args); } finally { M.ccall = ccall; }
    };
  }
  if (file === path.join(root, "spine/protection.cjs")) {
    wrapped.add(value);
    const selections = value.protectedToolSelections;
    value.protectedToolSelections = function(...args) {
      const actual = selections.apply(this, args);
      record("loaded_guard_selections", {selections: actual});
      return actual;
    };
  }
  if (file === path.join(root, "contract/contract.cjs")) {
    wrapped.add(value);
    const create = value.createApprovalContract;
    value.createApprovalContract = function(options = {}) {
      record("contract_config", {ttlMs: options.ttlMs ?? 120000});
      return create.apply(this, arguments);
    };
  }
  return value;
};
const spawnSync = cp.spawnSync;
cp.spawnSync = function(command, args, options) {
  const worker = path.join(root, "contract/kernel-authorization-worker.cjs");
  if (args?.[0] !== worker) return spawnSync.apply(this, arguments);
  return spawnSync.call(this, command,
    [path.join(__dirname, "authorization-worker-wrapper.cjs"), worker, ...args.slice(1)], options);
};
