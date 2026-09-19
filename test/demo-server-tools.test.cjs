// SPDX-License-Identifier: Apache-2.0
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const test = require("node:test");
const { testTmpdir } = require("../scripts/temp-root.cjs");

const SEAL = path.join(__dirname, "..", "bin", "seal");

test("the demo server advertises append and erase with real file effects", async () => {
  const root = testTmpdir(path.join(os.tmpdir(), "seal-demo-tools-"));
  const dataFile = path.join(root, "data.txt");
  const child = spawn(process.execPath, [SEAL, "__demo-server", dataFile], {
    stdio: ["pipe", "pipe", "inherit"],
  });
  let buffered = "";
  const replies = [];
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    buffered += chunk;
    for (;;) {
      const newline = buffered.indexOf("\n");
      if (newline < 0) break;
      replies.push(JSON.parse(buffered.slice(0, newline)));
      buffered = buffered.slice(newline + 1);
    }
  });
  const request = (id, method, params = {}) => new Promise((resolve) => {
    const poll = () => {
      const index = replies.findIndex((reply) => reply.id === id);
      if (index >= 0) return resolve(replies.splice(index, 1)[0]);
      setImmediate(poll);
    };
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    poll();
  });

  try {
    await request(1, "initialize", { protocolVersion: "2025-06-18" });
    const listed = await request(2, "tools/list");
    assert.equal(fs.readFileSync(dataFile, "utf8"), "", "first use starts empty");
    assert.equal(fs.readFileSync(`${dataFile}.count`, "utf8"), "0\n");
    assert.deepEqual(listed.result.tools.map(({ name, description }) => ({ name, description })), [
      { name: "demo.mutate", description: "append one line to the demo data file" },
      { name: "demo.erase", description: "erase all contents of the demo data file" },
    ]);
    await request(3, "tools/call", { name: "demo.mutate", arguments: { line: "kept until erase" } });
    assert.equal(fs.readFileSync(dataFile, "utf8"), "kept until erase\n");
    await request(4, "tools/call", { name: "demo.erase", arguments: {} });
    assert.equal(fs.readFileSync(dataFile, "utf8"), "");
    assert.equal(fs.readFileSync(`${dataFile}.count`, "utf8"), "2\n");
  } finally {
    child.stdin.end();
    await new Promise((resolve) => child.once("exit", resolve));
  }
});

test("discovery and respawns preserve existing demo data and witnessed mutations", async () => {
  const { listServerTools } = require("../spine/protection.cjs");
  const root = testTmpdir(path.join(os.tmpdir(), "seal-demo-startup-"));
  const dataFile = path.join(root, "data.txt");
  const countFile = `${dataFile}.count`;
  fs.writeFileSync(dataFile, "important data\n");
  fs.writeFileSync(countFile, "7\n");
  const run = (frames = []) => {
    const child = spawnSync(process.execPath, [SEAL, "__demo-server", dataFile], {
      input: frames.map((frame) => JSON.stringify(frame) + "\n").join(""),
      encoding: "utf8", timeout: 10000,
    });
    assert.equal(child.status, 0, child.stderr);
    return child.stdout.trim() ? child.stdout.trim().split("\n").map(JSON.parse) : [];
  };
  const preserved = (data, count) => {
    assert.equal(fs.readFileSync(dataFile, "utf8"), data);
    assert.equal(fs.readFileSync(countFile, "utf8"), `${count}\n`);
  };
  assert.deepEqual(run(), [], "startup with no frames emits no reply");
  preserved("important data\n", 7);
  assert.deepEqual(await listServerTools({
    childArgv: [process.execPath, SEAL, "__demo-server", dataFile], projectRoot: root,
  }), ["demo.erase", "demo.mutate"]);
  preserved("important data\n", 7);
  for (const [name, data, count] of [
    ["demo.mutate", "important data\nnew line\n", 8],
    ["demo.erase", "", 9],
  ]) {
    const replies = run([{ jsonrpc: "2.0", id: 1, method: "tools/call",
      params: { name, arguments: { line: "new line" } } }]);
    assert.equal(replies.length, 1);
    assert.equal(replies[0].id, 1);
    assert.match(replies[0].result.content[0].text, new RegExp(`total tool calls: ${count}$`));
    preserved(data, count);
    run();
    preserved(data, count);
  }
});

for (const existing of ["data", "count"]) {
  test(`demo startup refuses an orphaned ${existing} file without changing it`, () => {
    const root = testTmpdir(path.join(os.tmpdir(), "seal-demo-orphan-"));
    const dataFile = path.join(root, "data.txt");
    const present = existing === "data" ? dataFile : `${dataFile}.count`;
    const absent = existing === "data" ? `${dataFile}.count` : dataFile;
    fs.writeFileSync(present, existing === "data" ? "important data\n" : "7\n");
    const before = fs.readFileSync(present);
    const child = spawnSync(process.execPath, [SEAL, "__demo-server", dataFile], {
      input: "", encoding: "utf8", timeout: 10000,
    });
    assert.equal(child.status, 2, child.stderr);
    assert.match(child.stderr, /inconsistent state/);
    assert.equal(child.stdout, "");
    assert.deepEqual(fs.readFileSync(present), before);
    assert.equal(fs.existsSync(absent), false);
  });
}

// Exercise the private persistence boundaries without expanding the server API.
const vm = require("node:vm");
const { createRequire } = require("node:module");
const serverPath = path.join(__dirname, "..", "spine", "demo-server.cjs");
const serverScope = { require: createRequire(serverPath), module: { exports: {} }, Buffer, process };
vm.runInNewContext(
  fs.readFileSync(serverPath, "utf8") + "\nmodule.exports = { writeFileSyncedTo, appendSyncedTo };",
  serverScope,
  { filename: serverPath },
);

for (const [name, write] of Object.entries(serverScope.module.exports)) {
  for (const kind of ["string", "Buffer"]) {
    test(`${name} preserves ${kind} bytes and ENOSPC but refuses real partial writes`, (t) => {
      const root = testTmpdir(path.join(os.tmpdir(), "seal-demo-write-"));
      const file = path.join(root, "data");
      const text = "éclair\n";
      const data = kind === "string" ? text : Buffer.from(text);
      const bytes = Buffer.from(text);
      const prefix = name === "appendSyncedTo" ? Buffer.from("existing\n") : Buffer.alloc(0);
      const reset = () => fs.writeFileSync(file, prefix);

      reset();
      const successWrite = t.mock.method(fs, "writeSync");
      const successSync = t.mock.method(fs, "fsyncSync");
      const successClose = t.mock.method(fs, "closeSync");
      write(file, data);
      assert.equal(successWrite.mock.callCount(), 1);
      assert.equal(successSync.mock.callCount(), 1);
      assert.equal(successClose.mock.callCount(), 1);
      t.mock.restoreAll();
      assert.deepEqual(fs.readFileSync(file), Buffer.concat([prefix, bytes]));

      const full = Object.assign(new Error("disk full"), { code: "ENOSPC" });
      t.mock.method(fs, "writeSync", () => { throw full; });
      try {
        assert.throws(() => write(file, data), (error) => error === full);
      } finally {
        t.mock.restoreAll();
      }

      fs.writeFileSync(file, "existing\n");
      const originalWrite = fs.writeSync;
      let offered;
      let fdUsed;
      let error;
      t.mock.method(fs, "writeSync", (fd, input) => {
        fdUsed = fd;
        offered = Buffer.from(input);
        return originalWrite(fd, offered, 0, offered.length - 1);
      });
      const sync = t.mock.method(fs, "fsyncSync");
      try {
        try { write(file, data); } catch (caught) { error = caught; }
        assert.deepEqual(offered, bytes);
        if (name === "appendSyncedTo") {
          assert.equal(fs.readFileSync(file, "utf8"), "existing\n");
        } else {
          assert.throws(() => fs.readFileSync(file), { code: "ENOENT" });
        }
        assert.equal(error?.code, "EIO", `${name} returned success after a real partial ${kind} write`);
        assert.equal(error.message, `incomplete write: wrote ${bytes.length - 1} of ${bytes.length} bytes`);
        assert.equal(sync.mock.callCount(), name === "appendSyncedTo" ? 1 : 0, "only append rollback must fsync after failure");
        assert.throws(() => fs.fstatSync(fdUsed), { code: "EBADF" }, "the descriptor must still close");
      } finally {
        t.mock.restoreAll();
      }
      if (name === "appendSyncedTo") {
        write(file, "next\n");
        assert.equal(fs.readFileSync(file, "utf8"), "existing\nnext\n");
      }
    });
  }
}

// Run the real tool handlers with a real short write in a child, so an
// uncaught persistence error cannot be confused with a successful RPC reply.
for (const tool of ["demo.mutate", "demo.erase"]) {
  test(`${tool} leaves no accepted partial record after a real short write`, () => {
    const root = testTmpdir(path.join(os.tmpdir(), "seal-demo-handler-"));
    const file = path.join(root, "data");
    const child = spawnSync(process.execPath, ["-e", `
      const fs = require("node:fs");
      const write = fs.writeSync;
      fs.writeSync = (fd, bytes, ...args) => {
        const target = ${JSON.stringify(tool)} === "demo.erase" ? "1\\n" : "abcdef\\n";
        if (Buffer.isBuffer(bytes) && bytes.toString() === target) {
          return write(fd, bytes, 0, bytes.length - 1);
        }
        return write(fd, bytes, ...args);
      };
      require(${JSON.stringify(serverPath)}).run(${JSON.stringify(file)});
    `], {
      input: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call",
        params: { name: tool, arguments: { line: "abcdef" } } }) + "\n",
      encoding: "utf8",
      timeout: 10000,
    });
    assert.equal(child.status, 1, child.stderr);
    assert.match(child.stderr, /incomplete write: wrote/);
    assert.equal(child.stdout, "");
    assert.equal(fs.readFileSync(file, "utf8"), "");
    if (tool === "demo.erase") {
      // Execute the downstream reader itself, including its normal trim().
      const demoPath = path.join(__dirname, "..", "spine", "demo.cjs");
      const scope = { require: createRequire(demoPath), module: { exports: {} }, process };
      vm.runInNewContext(fs.readFileSync(demoPath, "utf8") + "\nmodule.exports = { readCount };", scope);
      assert.throws(() => scope.module.exports.readCount(`${file}.count`), { code: "ENOENT" });
    } else {
      assert.equal(fs.readFileSync(`${file}.count`, "utf8"), "0\n");
    }
  });
}

// Like durability-lock.test.cjs, child-local filesystem barriers force the
// interleavings without adding a timing hook to the product.
for (const mode of ["exclusive-open", "between-files"]) {
  test(`concurrent first demo startups handle ${mode} races`, async () => {
    const root = testTmpdir(path.join(os.tmpdir(), "seal-demo-race-"));
    const failures = [];
    for (let trial = 0; trial < 20; trial++) {
      const file = path.join(root, `data-${trial}`);
      const children = [0, 1].map((seat) => new Promise((resolve, reject) => {
        const child = spawn(process.execPath, ["-e", `
          const fs = require("node:fs");
          const file = ${JSON.stringify(file)}, seat = ${seat}, mode = ${JSON.stringify(mode)};
          const exists = fs.existsSync, open = fs.openSync;
          const sleep = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
          const wait = marker => {
            const end = Date.now() + 5000;
            while (!exists(marker)) {
              if (Date.now() > end) throw Error("demo race barrier timeout: " + marker);
              sleep(5);
            }
          };
          if (mode === "between-files" && seat === 1) wait(file + ".pending");
          fs.existsSync = target => {
            const result = exists(target);
            if (mode === "between-files" && seat === 1 && target === file && result)
              fs.writeFileSync(file + ".observed", "");
            return result;
          };
          fs.openSync = (target, flags, ...args) => {
            if (target === file && flags === "wx" && mode === "exclusive-open") {
              fs.writeFileSync(file + ".ready-" + seat, "");
              wait(file + ".ready-" + (1 - seat));
            }
            if (target === file + ".count" && flags === "wx" && mode === "between-files") {
              fs.writeFileSync(file + ".pending", "");
              wait(file + ".observed");
              sleep(30);
            }
            try { return open(target, flags, ...args); }
            catch (error) {
              if (target === file && error.code === "EEXIST")
                fs.writeFileSync(file + ".observed", "");
              throw error;
            }
          };
          require(${JSON.stringify(serverPath)}).run(file);
        `], { stdio: ["pipe", "pipe", "pipe"], timeout: 10000 });
        let stdout = "", stderr = "";
        child.stdout.on("data", chunk => { stdout += chunk; });
        child.stderr.on("data", chunk => { stderr += chunk; });
        child.on("error", reject);
        child.on("close", (code, signal) => resolve({ seat, code, signal, stdout, stderr }));
        child.stdin.on("error", () => {}); // Preserve the child's failure diagnostics.
        child.stdin.end(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize" }) + "\n");
      }));
      const results = await Promise.all(children);
      for (const result of results) {
        if (result.code !== 0 || result.stderr || !result.stdout.includes('"serverInfo"'))
          failures.push({ trial, ...result });
      }
      assert.equal(fs.readFileSync(file, "utf8"), "");
      assert.equal(fs.readFileSync(`${file}.count`, "utf8"), "0\n");
    }
    assert.deepEqual(failures, [], "both children must initialize silently in every trial");
  });
}
