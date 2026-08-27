// SPDX-License-Identifier: Apache-2.0
const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.join(__dirname, "..");

function macho(arch) {
  const bytes = Buffer.alloc(8);
  bytes.writeUInt32LE(0xfeedfacf, 0);
  bytes.writeUInt32LE(arch === "arm64" ? 0x0100000c : 0x01000007, 4);
  return bytes;
}

function isolatedTree(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "seal-darwin-readiness-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const directory of ["spine", "scripts", "runtime"]) fs.mkdirSync(path.join(root, directory));
  for (const relative of ["spine/platform.cjs", "spine/protection.cjs", "scripts/macos-helper.cjs"]) {
    fs.copyFileSync(path.join(ROOT, relative), path.join(root, relative));
  }
  return {
    root,
    helper: path.join(root, "runtime", "macos-process-start-witness"),
    platform: require(path.join(root, "spine", "platform.cjs")),
    protectionPath: path.join(root, "spine", "protection.cjs"),
  };
}

function withPlatform(platform, arch, fn) {
  const previousPlatform = process.env.SEAL_SPINE_PLATFORM;
  const previousArch = process.env.SEAL_SPINE_ARCH;
  process.env.SEAL_SPINE_PLATFORM = platform;
  process.env.SEAL_SPINE_ARCH = arch;
  try { return fn(); }
  finally {
    if (previousPlatform === undefined) delete process.env.SEAL_SPINE_PLATFORM;
    else process.env.SEAL_SPINE_PLATFORM = previousPlatform;
    if (previousArch === undefined) delete process.env.SEAL_SPINE_ARCH;
    else process.env.SEAL_SPINE_ARCH = previousArch;
  }
}

function loadProtection(ctx, invoke) {
  const original = childProcess.spawnSync;
  childProcess.spawnSync = (command, args, options) => command === ctx.helper
    ? invoke(command, args, options)
    : original(command, args, options);
  const protection = require(ctx.protectionPath);
  return { protection, restore: () => { childProcess.spawnSync = original; } };
}

function writeHelper(ctx, arch = "arm64", mode = 0o555) {
  fs.rmSync(ctx.helper, { force: true });
  fs.writeFileSync(ctx.helper, macho(arch), { mode });
  fs.chmodSync(ctx.helper, mode);
}

test("the platform contract is pure across PATH and helper damage", (t) => {
  const ctx = isolatedTree(t);
  writeHelper(ctx);
  const observed = [];
  const answer = (condition) => {
    const supported = ctx.platform.protectPlatformSupported("darwin", "arm64");
    observed.push(`${condition} protectPlatformSupported(darwin,arm64)=${supported}`);
    assert.equal(supported, true);
  };
  withPlatform("darwin", "arm64", () => {
    const previousPath = process.env.PATH;
    process.env.PATH = "";
    try { answer("PATH=empty"); }
    finally { process.env.PATH = previousPath; }
    fs.unlinkSync(ctx.helper);
    answer("helper=deleted");
    writeHelper(ctx, "arm64", 0o444);
    answer("helper=non-executable");
  });
  console.log(observed.join("\n"));
});

test("readiness reports all five ruled codes without unsupported-platform text", (t) => {
  const ctx = isolatedTree(t);
  let outcome = { status: 0, stdout: "boot 1700000000.000000\nprocess 1750000000.123456\n" };
  const loaded = loadProtection(ctx, () => outcome);
  t.after(loaded.restore);
  const { protectReadiness } = loaded.protection;
  const observed = [];
  const check = (condition, code) => {
    const result = withPlatform("darwin", "arm64", protectReadiness);
    const line = `${condition}: ${result.code} | ${result.detail}`;
    observed.push(line);
    assert.equal(result.ok, false);
    assert.equal(result.code, code);
    assert.doesNotMatch(line, /unsupported[_ -]platform/i);
  };

  check("helper deleted", "macos_helper_missing");
  writeHelper(ctx, "arm64", 0o444);
  check("helper mode 0444", "macos_helper_not_executable");
  writeHelper(ctx, "x64");
  check("x64 helper in arm64 build", "macos_helper_architecture");
  writeHelper(ctx);
  outcome = { status: 2, stdout: "" };
  check("helper boot sysctl(3) refusal", "macos_boot_time_unavailable");
  outcome = { status: 1, stdout: "" };
  check("helper process sysctl(3) refusal", "macos_process_witness_failed");
  console.log(observed.join("\n"));
});

test("one helper child returns boot and process facts together", (t) => {
  const ctx = isolatedTree(t);
  writeHelper(ctx);
  const calls = [];
  const stdout = "boot 1700000000.000000\nprocess 1750000000.123456\n";
  const loaded = loadProtection(ctx, (command, args) => {
    calls.push({ command, args });
    return { status: 0, stdout };
  });
  t.after(loaded.restore);
  const result = withPlatform("darwin", "arm64", loaded.protection.protectReadiness);
  assert.equal(result.ok, true);
  assert.equal(result.bootTime, "1700000000.000000");
  assert.equal(result.witness, "1750000000.123456");
  assert.equal(calls.length, 1);
  console.log(`call=${calls[0].command} ${calls[0].args.join(" ")}\nboot=${result.bootTime}\nprocess=${result.witness}\nchild-process-tally=${calls.length}`);
});

test("the boot-time plausibility floor survives the native output change", (t) => {
  const ctx = isolatedTree(t);
  const loaded = loadProtection(ctx, () => assert.fail("parser test must spawn nothing"));
  t.after(loaded.restore);
  const stdout = "boot 1.000000\nprocess 1750000000.123456\n";
  const result = loaded.protection.parseMacosProcessWitness({ status: 0, stdout }, 1800000000);
  assert.equal(result.ok, false);
  assert.equal(result.code, "macos_boot_time_unavailable");
  console.log(`input=${JSON.stringify(stdout)}\nrefusal=${result.code} detail=${result.detail}`);
});

test("lease acquisition rechecks a helper replaced after preflight", (t) => {
  const ctx = isolatedTree(t);
  writeHelper(ctx);
  const loaded = loadProtection(ctx, () => ({
    status: 0,
    stdout: "boot 1700000000.000000\nprocess 1750000000.123456\n",
  }));
  t.after(loaded.restore);
  withPlatform("darwin", "arm64", () => {
    const preflight = loaded.protection.protectReadiness();
    assert.equal(preflight.ok, true);
    writeHelper(ctx, "x64");
    const project = path.join(ctx.root, "project");
    fs.mkdirSync(project);
    const env = { XDG_DATA_HOME: path.join(ctx.root, "data"), HOME: path.join(ctx.root, "home") };
    assert.throws(
      () => loaded.protection.acquireProjectLock(project, env),
      (error) => {
        console.log(`preflight=ok helper=replaced lease-refusal=${error.code} detail=${error.message}`);
        return error.code === "macos_helper_architecture";
      },
    );
    assert.equal(fs.existsSync(loaded.protection.lockPathFor(project, env)), false);
  });
});

test("Linux readiness and witnessing spawn no child process", (t) => {
  const ctx = isolatedTree(t);
  const calls = [];
  const loaded = loadProtection(ctx, (command) => {
    calls.push(command);
    return { status: 1, stdout: "" };
  });
  t.after(loaded.restore);
  withPlatform("linux", "x64", () => {
    assert.equal(loaded.protection.protectReadiness().ok, true);
    assert.equal(typeof loaded.protection.processStartWitness(process.pid), "string");
  });
  assert.deepEqual(calls, []);
  console.log(`linux-child-processes=${JSON.stringify(calls)} length=${calls.length}`);
});

test("native source obtains both facts with sysctl(3) and prints both fields", () => {
  const source = fs.readFileSync(path.join(ROOT, "runtime", "macos-process-start-witness.c"), "utf8");
  assert.match(source, /KERN_BOOTTIME/);
  assert.match(source, /sysctl\(boot_mib, 2,/);
  assert.match(source, /sysctl\(process_mib, 4,/);
  assert.match(source, /printf\("boot %lld\.%06d\\n"/);
  assert.match(source, /printf\("process %lld\.%06d\\n"/);
});
