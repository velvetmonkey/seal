// SPDX-License-Identifier: Apache-2.0
const assert = require("node:assert/strict");
const { spawn, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const { lockOwnerIsLive, processStartWitness } = require("../spine/protection.cjs");

const helper = path.join(__dirname, "../runtime/macos-process-start-witness");

function child() {
  return spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
}

function stop(process) {
  if (!process.killed) process.kill("SIGKILL");
}

function witnessFor(process) {
  const witness = processStartWitness(process.pid);
  assert.match(witness, /^[1-9]\d*\.\d{6}$/);
  return witness;
}

assert.equal(process.platform, "darwin", "this evidence script requires macOS");
assert.equal(fs.existsSync(helper), true, "build the helper before running this script");

const live = child();
try {
  const witness = witnessFor(live);
  console.log(`live-child pid=${live.pid} witness=${witness}`);
} finally {
  stop(live);
}

const missing = spawnSync(helper, ["2147483647"], { encoding: "utf8" });
assert.notEqual(missing.status, 0);
assert.equal(missing.stdout, "");
console.log(`nonexistent pid=2147483647 exit=${missing.status} stdout=${JSON.stringify(missing.stdout)}`);

const unavailable = `${helper}.unavailable`;
fs.renameSync(helper, unavailable);
try {
  assert.equal(processStartWitness(process.pid), null);
  assert.throws(
    () => lockOwnerIsLive({ pid: process.pid, startWitness: "unavailable" }),
    (error) => error.code === "process_witness_unavailable",
  );
  console.log("helper-missing witness=null lock=process_witness_unavailable");
} finally {
  fs.renameSync(unavailable, helper);
}

const hanging = `${helper}.hanging`;
fs.renameSync(helper, hanging);
fs.writeFileSync(helper, "#!/bin/sh\nsleep 2\n", { mode: 0o755 });
try {
  assert.equal(processStartWitness(process.pid), null);
  console.log("helper-hanging witness=null");
} finally {
  fs.unlinkSync(helper);
  fs.renameSync(hanging, helper);
}

let sameSecond = false;
for (let attempt = 0; attempt < 4 && !sameSecond; attempt += 1) {
  const first = child();
  const second = child();
  try {
    const firstWitness = witnessFor(first);
    const secondWitness = witnessFor(second);
    if (firstWitness.slice(0, -7) === secondWitness.slice(0, -7)) {
      assert.notEqual(firstWitness, secondWitness);
      console.log(`same-second first=${firstWitness} second=${secondWitness}`);
      sameSecond = true;
    }
  } finally {
    stop(first);
    stop(second);
  }
}
assert.equal(sameSecond, true, "could not start two children inside one second");
