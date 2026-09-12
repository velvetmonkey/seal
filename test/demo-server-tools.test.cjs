// SPDX-License-Identifier: Apache-2.0
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
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
      write(file, data);
      assert.deepEqual(fs.readFileSync(file), Buffer.concat([prefix, bytes]));

      const full = Object.assign(new Error("disk full"), { code: "ENOSPC" });
      t.mock.method(fs, "writeSync", () => { throw full; });
      try {
        assert.throws(() => write(file, data), (error) => error === full);
      } finally {
        t.mock.restoreAll();
      }

      reset();
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
        assert.deepEqual(fs.readFileSync(file), Buffer.concat([prefix, bytes.subarray(0, -1)]));
        assert.equal(error?.code, "EIO", `${name} returned success after a real partial ${kind} write`);
        assert.equal(error.message, `incomplete write: wrote ${bytes.length - 1} of ${bytes.length} bytes`);
        assert.equal(sync.mock.callCount(), 0, "a failed write must not reach fsync");
        assert.throws(() => fs.fstatSync(fdUsed), { code: "EBADF" }, "the descriptor must still close");
      } finally {
        t.mock.restoreAll();
      }
    });
  }
}
