// SPDX-License-Identifier: Apache-2.0
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const test = require("node:test");

const SEAL = path.join(__dirname, "..", "bin", "seal");

test("the demo server advertises append and erase with real file effects", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "seal-demo-tools-"));
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
