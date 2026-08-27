// SPDX-License-Identifier: Apache-2.0
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const ROOT = path.join(__dirname, "..");

function probe(pathValue, slowHelper = false) {
  const source = String.raw`
    const fs = require("node:fs");
    const path = require("node:path");
    const childProcess = require("node:child_process");
    const root = process.env.SEAL_PROBE_ROOT;
    const helper = path.join(root, "runtime", "macos-process-start-witness");
    const originalStatSync = fs.statSync;
    const originalAccessSync = fs.accessSync;
    const originalSpawnSync = childProcess.spawnSync;
    fs.statSync = (target, ...args) => target === helper ? { isFile: () => true } : originalStatSync(target, ...args);
    fs.accessSync = (target, ...args) => target === helper ? undefined : originalAccessSync(target, ...args);
    const calls = [];
    childProcess.spawnSync = (command, args, options) => {
      calls.push(command);
      if (command === "/usr/sbin/sysctl") {
        return { status: 0, stdout: "{ sec = 1700000000, usec = 0 } Tue Nov 14 22:13:20 2023\n" };
      }
      if (command === helper) {
        if (process.env.SEAL_PROBE_SLOW === "1") {
          const error = new Error("spawnSync " + helper + " ETIMEDOUT");
          error.code = "ETIMEDOUT";
          return { status: null, stdout: "", error };
        }
        return { status: 0, stdout: "1750000000.123456\n" };
      }
      return originalSpawnSync(command, args, options);
    };
    process.env.SEAL_SPINE_PLATFORM = "darwin";
    process.env.SEAL_SPINE_ARCH = "arm64";
    const support = require(path.join(root, "spine", "platform.cjs")).platformSupport();
    const protection = require(path.join(root, "spine", "protection.cjs"));
    const bounds = protection.macosProcessStartWitnessBounds();
    const witness = protection.processStartWitness(process.pid);
    const doctor = protection.doctor(process.env);
    let cliDoctorText = null;
    if (process.env.SEAL_PROBE_SLOW === "1") {
      cliDoctorText = "";
      const originalWrite = process.stdout.write;
      const originalArgv = process.argv;
      process.stdout.write = (chunk) => { cliDoctorText += String(chunk); return true; };
      process.argv = [process.execPath, path.join(root, "bin", "seal"), "doctor"];
      require(path.join(root, "bin", "seal"));
      process.stdout.write = originalWrite;
      process.argv = originalArgv;
      process.exitCode = 0;
    }
    process.stdout.write(JSON.stringify({ support, bounds, witness, doctor, cliDoctorText, calls }) + "\n");
  `;
  return spawnSync(process.execPath, ["-e", source], {
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: pathValue,
      SEAL_PROBE_ROOT: ROOT,
      ...(slowHelper ? { SEAL_PROBE_SLOW: "1" } : {}),
    },
  });
}

test("caller PATH cannot select sysctl for Protect support or witness bounds", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "seal-fake-sysctl-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const marker = path.join(root, "called");
  const fake = path.join(root, "sysctl");
  fs.writeFileSync(fake, `#!/bin/sh\nprintf called > '${marker}'\nprintf '{ sec = 1799999999, usec = 0 }\\n'\n`, { mode: 0o755 });

  const result = probe(root);
  assert.equal(result.status, 0, result.stderr);
  const observed = JSON.parse(result.stdout);
  assert.equal(observed.support.protectSupported, true);
  assert.equal(observed.bounds.bootSeconds, 1700000000);
  assert.equal(observed.witness, "1750000000.123456");
  assert.equal(fs.existsSync(marker), false, "fake PATH sysctl ran");
  assert.ok(observed.calls.filter((command) => command === "/usr/sbin/sysctl").length >= 3);
  assert.equal(observed.calls.includes(fake), false);
  console.log(`fake-sysctl=${fake} fake-boot=1799999999 called=${fs.existsSync(marker)} protectSupported=${observed.support.protectSupported} witness-boot-bound=${observed.bounds.bootSeconds} witness=${observed.witness} sysctl-calls=${observed.calls.filter((command) => command === "/usr/sbin/sysctl").join(",")}`);
});

test("healthy simulated Darwin remains Protect-supported with an empty PATH", () => {
  const result = probe("");
  assert.equal(result.status, 0, result.stderr);
  const observed = JSON.parse(result.stdout);
  assert.equal(observed.support.protectSupported, true);
  assert.equal(observed.bounds.bootSeconds, 1700000000);
  console.log(`PATH=${JSON.stringify("")} protectSupported=${observed.support.protectSupported} witness-boot-bound=${observed.bounds.bootSeconds}`);
});

test("seal doctor reports a timed-out macOS process-start helper", () => {
  const result = probe("", true);
  assert.equal(result.status, 0, result.stderr);
  const observed = JSON.parse(result.stdout);
  assert.equal(observed.support.protectSupported, false);
  assert.equal(observed.support.protectReason, "macos_process_start_witness_timeout");
  assert.equal(observed.doctor.ok, false);
  assert.equal(observed.doctor.code, "macos_process_start_witness_timeout");
  assert.match(observed.doctor.text, /Protect is unavailable: macos_process_start_witness_timeout/);
  assert.equal(observed.cliDoctorText, observed.doctor.text);
  console.log(`seal doctor:\n${observed.cliDoctorText.trimEnd()}`);
});
