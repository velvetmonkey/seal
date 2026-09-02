// SPDX-License-Identifier: Apache-2.0
const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { testTmpdir } = require("../scripts/temp-root.cjs");

const ROOT = path.join(__dirname, "..");

function macho(arch) {
  const bytes = Buffer.alloc(8);
  bytes.writeUInt32LE(0xfeedfacf, 0);
  bytes.writeUInt32LE(arch === "arm64" ? 0x0100000c : 0x01000007, 4);
  return bytes;
}

function isolatedTree(t) {
  const root = testTmpdir(path.join(os.tmpdir(), "seal-darwin-readiness-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const directory of ["spine", "scripts", "runtime"]) fs.mkdirSync(path.join(root, directory));
  for (const relative of ["spine/platform.cjs", "spine/protection.cjs", "spine/version.cjs", "scripts/macos-helper.cjs", "VERSION", "package.json"]) {
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
  const restore = () => {
    if (previousPlatform === undefined) delete process.env.SEAL_SPINE_PLATFORM;
    else process.env.SEAL_SPINE_PLATFORM = previousPlatform;
    if (previousArch === undefined) delete process.env.SEAL_SPINE_ARCH;
    else process.env.SEAL_SPINE_ARCH = previousArch;
  };
  try {
    const result = fn();
    if (result && typeof result.then === "function") return result.finally(restore);
    restore();
    return result;
  } catch (error) {
    restore();
    throw error;
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

test("witness execution detects a helper replacement after the architecture gate", (t) => {
  const ctx = isolatedTree(t);
  writeHelper(ctx);
  let replaced = false;
  const loaded = loadProtection(ctx, () => {
    writeHelper(ctx);
    replaced = true;
    return { status: 0, stdout: "boot 1700000000.000000\nprocess 1750000000.123456\n" };
  });
  t.after(loaded.restore);
  const result = withPlatform("darwin", "arm64", loaded.protection.protectReadiness);
  assert.equal(replaced, true);
  assert.equal(result.ok, false);
  assert.equal(result.code, "macos_helper_substituted");
  console.log(`execution-tamper helper=replaced-after-architecture-gate witness=REFUSED code=${result.code}`);
  console.log(`execution-detail=${result.detail}`);
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

test("project-lock commit refuses a helper replacement after the witness gate", (t) => {
  const ctx = isolatedTree(t);
  writeHelper(ctx);
  const loaded = loadProtection(ctx, () => ({
    status: 0,
    stdout: "boot 1700000000.000000\nprocess 1750000000.123456\n",
  }));
  t.after(loaded.restore);
  withPlatform("darwin", "arm64", () => {
    const project = path.join(ctx.root, "lock-project");
    fs.mkdirSync(project);
    const env = { XDG_DATA_HOME: path.join(ctx.root, "lock-data") };
    const lockPath = loaded.protection.lockPathFor(project, env);
    const lockDirectory = path.dirname(lockPath);
    const originalMkdirSync = fs.mkdirSync;
    let replaced = false;
    fs.mkdirSync = (target, options) => {
      const result = originalMkdirSync(target, options);
      if (!replaced && target === lockDirectory) {
        replaced = true;
        writeHelper(ctx);
      }
      return result;
    };
    try {
      assert.throws(
        () => loaded.protection.acquireProjectLock(project, env),
        (error) => {
          console.log(`lock-tamper helper=replaced-after-gate commit=REFUSED code=${error.code}`);
          console.log(`lock-detail=${error.message}`);
          return error.code === "macos_helper_substituted" && error.refusal === true;
        },
      );
    } finally {
      fs.mkdirSync = originalMkdirSync;
    }
    assert.equal(replaced, true);
    assert.equal(fs.existsSync(lockPath), false, "the lock write must not commit");
    console.log(`lock-exists=${fs.existsSync(lockPath)}`);
  });
});

test("ACTIVE lease commit refuses a helper replacement after the witness gate", async (t) => {
  const ctx = isolatedTree(t);
  writeHelper(ctx);
  const loaded = loadProtection(ctx, () => ({
    status: 0,
    stdout: "boot 1700000000.000000\nprocess 1750000000.123456\n",
  }));
  t.after(loaded.restore);
  await withPlatform("darwin", "arm64", async () => {
    const project = path.join(ctx.root, "lease-project");
    const dataHome = path.join(ctx.root, "lease-data");
    fs.mkdirSync(project);
    const server = {
      command: process.execPath,
      args: [path.join(ROOT, "bin/seal"), "__demo-server", path.join(ctx.root, "demo-data.txt")],
    };
    fs.writeFileSync(path.join(project, ".mcp.json"), JSON.stringify({ mcpServers: { db: server } }) + "\n");
    const projectServer = loaded.protection.readProjectServer(project, "db");
    const env = { XDG_DATA_HOME: dataHome };
    const statePath = loaded.protection.statePathFor(project, env);
    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    fs.writeFileSync(statePath, JSON.stringify({
      schema: "seal.protect/v1",
      sealVersion: fs.readFileSync(path.join(ROOT, "VERSION"), "utf8").trim(),
      state: "PENDING RESTART",
      projectRoot: fs.realpathSync(project),
      projectId: loaded.protection.projectId(project),
      serverName: "db",
      guardTool: "demo.mutate",
      projectServerDigest: projectServer.serverDigest,
      projectServer: projectServer.server,
      childArgv: projectServer.childArgv,
      childEnv: projectServer.childEnv,
      discoveryTimeoutMs: 30000,
      lease: null,
    }, null, 2) + "\n");

    const temporary = `${statePath}.tmp-${process.pid}`;
    const originalWriteFileSync = fs.writeFileSync;
    let replaced = false;
    fs.writeFileSync = (target, data, options) => {
      const result = originalWriteFileSync(target, data, options);
      if (!replaced && target === temporary) {
        replaced = true;
        writeHelper(ctx);
      }
      return result;
    };
    try {
      await assert.rejects(
        loaded.protection.activationLease(statePath, env),
        (error) => {
          console.log(`lease-tamper helper=replaced-after-gate commit=REFUSED code=${error.code}`);
          console.log(`lease-detail=${error.message}`);
          return error.code === "macos_helper_substituted" && error.refusal === true;
        },
      );
    } finally {
      fs.writeFileSync = originalWriteFileSync;
    }
    assert.equal(replaced, true);
    const stored = JSON.parse(fs.readFileSync(statePath, "utf8"));
    assert.equal(stored.state, "PENDING RESTART");
    assert.equal(stored.lease, null);
    assert.equal(fs.existsSync(temporary), false, "the uncommitted temporary state must be removed");
    console.log(`stored-state=${stored.state} stored-lease=${stored.lease} temporary-exists=${fs.existsSync(temporary)}`);
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
