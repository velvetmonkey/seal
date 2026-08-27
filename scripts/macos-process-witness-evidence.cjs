// SPDX-License-Identifier: Apache-2.0
const assert = require("node:assert/strict");
const { spawn, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const { lockOwnerIsLive, processStartWitness } = require("../spine/protection.cjs");

const helper = path.join(__dirname, "../runtime/macos-process-start-witness");
const MAX_SECONDS_DIGITS = 10;
const MIN_BOOT_SECONDS = 946684800;

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

function diagnosticVerdict(live) {
  const helperResult = spawnSync(helper, [String(live.pid)], { encoding: "utf8", timeout: 1000 });
  const bootResult = spawnSync("sysctl", ["-n", "kern.boottime"], { encoding: "utf8", timeout: 1000 });
  const nowSeconds = Date.now() / 1000;
  const helperExit = !helperResult.error && helperResult.status === 0;
  const helperMatch = typeof helperResult.stdout === "string" && /^([1-9]\d*)\.(\d{6})\n?$/.exec(helperResult.stdout);
  const bootExit = !bootResult.error && bootResult.status === 0;
  const bootMatch = typeof bootResult.stdout === "string" &&
    /^\{ sec = ([1-9]\d*) , usec = \d+ \}(?: [^\r\n]*)?\n?$/.exec(bootResult.stdout);
  const bootSeconds = bootMatch ? Number(bootMatch[1]) : null;
  const boundsSane = bootSeconds !== null && bootMatch[1].length <= MAX_SECONDS_DIGITS &&
    Number.isSafeInteger(bootSeconds) && Number.isFinite(nowSeconds) &&
    bootSeconds >= MIN_BOOT_SECONDS && bootSeconds <= nowSeconds;
  const helperSeconds = helperMatch ? Number(helperMatch[1]) : null;
  const interval = boundsSane && helperMatch && helperMatch[1].length <= MAX_SECONDS_DIGITS &&
    Number.isSafeInteger(helperSeconds) && helperSeconds >= bootSeconds && helperSeconds <= nowSeconds;
  const verdicts = [
    ["helper-exit", helperExit],
    ["helper-parse", Boolean(helperMatch)],
    ["boot-command-exit", bootExit],
    ["boot-time-parse", Boolean(bootMatch)],
    ["boot-bound-sanity", boundsSane],
    ["interval", interval],
  ];

  console.log(`diagnostic sysctl-kern-boottime stdout=${JSON.stringify(bootResult.stdout)} stderr=${JSON.stringify(bootResult.stderr)} status=${bootResult.status}`);
  console.log(`diagnostic helper pid=${live.pid} stdout=${JSON.stringify(helperResult.stdout)} stderr=${JSON.stringify(helperResult.stderr)} status=${helperResult.status}`);
  for (const [step, passed] of verdicts) console.log(`diagnostic ${step}=${passed ? "pass" : "null"}`);
  console.log(`diagnostic first-null=${(verdicts.find(([, passed]) => !passed) || ["none"])[0]}`);
}

assert.equal(process.platform, "darwin", "this evidence script requires macOS");
assert.equal(fs.existsSync(helper), true, "build the helper before running this script");

const live = child();
try {
  diagnosticVerdict(live);
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
