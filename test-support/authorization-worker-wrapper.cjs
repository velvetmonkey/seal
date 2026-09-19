// SPDX-License-Identifier: Apache-2.0
"use strict";
// Observation TCB: retain worker stdio, execute installed bytes without edits.
const fs = require("node:fs");
const path = require("node:path");
const {spawnSync} = require("node:child_process");
const root = fs.realpathSync(process.env.SEAL_OBSERVATION_ROOT);
const worker = fs.realpathSync(process.argv[2]);
if (worker !== path.join(root, "contract/kernel-authorization-worker.cjs"))
  throw new Error("candidate-root: wrapper bypass/checkout worker");
const bytes = fs.readFileSync(0);
function record(kind, body) {
  const fd = fs.openSync(process.env.SEAL_OBSERVATION_TAP, "a", 0o600);
  try { fs.writeFileSync(fd, JSON.stringify({pid:process.pid, kind, bytes:body.toString("utf8")})+"\n"); fs.fsyncSync(fd); }
  finally { fs.closeSync(fd); }
}
record("worker_input", bytes);
const result = spawnSync(process.execPath,
  ["--require", path.join(__dirname, "authorization-worker-tap.cjs"), worker, ...process.argv.slice(3)],
  {input: bytes, env:process.env, maxBuffer:32*1024*1024});
if (result.error) throw result.error;
record("worker_output", result.stdout);
fs.writeFileSync(1, result.stdout);
fs.writeFileSync(2, result.stderr);
process.exit(result.status ?? 1);
