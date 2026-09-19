// SPDX-License-Identifier: Apache-2.0
// The hidden demo MCP server (`seal __demo-server DATAFILE`). A real child
// process with real effect boundaries: demo.mutate appends one line to
// DATAFILE, while demo.erase truncates DATAFILE. Each call increments
// DATAFILE.count. The count file is the acceptance evidence — only this
// process writes it, so a reader learns how many calls actually arrived, not
// how many anyone claimed arrived.
const fs = require("node:fs");
const path = require("node:path");
const readline = require("node:readline");
const { writeCompleteSync } = require("./write.cjs");

const TOOL = "demo.mutate";
const ERASE_TOOL = "demo.erase";

function writeFileSyncedTo(filePath, text, flags = "w") {
  const fd = fs.openSync(filePath, flags, 0o600);
  try {
    writeCompleteSync(fd, text);
    fs.fsyncSync(fd);
  } catch (error) {
    // A failed replacement is not evidence that a later reader may accept.
    // Match receipt emission: remove the incomplete file before propagating.
    try {
      fs.unlinkSync(filePath);
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], "demo replacement and cleanup failed");
    }
    throw error;
  } finally {
    fs.closeSync(fd);
  }
}

function appendSyncedTo(filePath, text) {
  const fd = fs.openSync(filePath, "a", 0o600);
  try {
    const before = fs.fstatSync(fd).size;
    try {
      writeCompleteSync(fd, text);
      fs.fsyncSync(fd);
    } catch (error) {
      // Like journal append, restore the complete prefix and persist rollback.
      // The demo server handles these writes synchronously in one process.
      try {
        fs.ftruncateSync(fd, before);
        fs.fsyncSync(fd);
      } catch (rollbackError) {
        throw new AggregateError([error, rollbackError], "demo append and rollback failed");
      }
      throw error;
    }
  } finally {
    fs.closeSync(fd);
  }
}

function incrementCount(countFile) {
  const count = Number.parseInt(fs.readFileSync(countFile, "utf8").trim(), 10) + 1;
  writeFileSyncedTo(countFile, `${count}\n`);
  return count;
}

function respond(message) {
  process.stdout.write(JSON.stringify(message) + "\n");
}

function run(dataFile) {
  if (!dataFile) {
    process.stderr.write("seal __demo-server: usage: seal __demo-server DATAFILE\n");
    process.exit(2);
  }
  const countFile = `${dataFile}.count`;
  fs.mkdirSync(path.dirname(dataFile), { recursive: true, mode: 0o700 });
  const refuseInconsistent = () => {
    process.stderr.write("seal __demo-server: inconsistent state: DATAFILE and DATAFILE.count must both exist or both be absent; refusing initialization\n");
    process.exit(2);
  };
  // Read the count first: it is created last. A data-only observation may
  // belong to a live initializer, so only refuse it after the bounded wait.
  let created = false;
  if (fs.existsSync(countFile)) {
    if (!fs.existsSync(dataFile)) refuseInconsistent();
  } else {
    try {
      writeFileSyncedTo(dataFile, "", "wx");
      created = true;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
  }
  if (created) {
    writeFileSyncedTo(countFile, "0\n", "wx");
  } else {
    const sleeper = new Int32Array(new SharedArrayBuffer(4));
    const deadline = performance.now() + 1000;
    // An open count file can still be empty before the winner writes 0.
    while (!fs.existsSync(countFile) || fs.statSync(countFile).size === 0) {
      if (performance.now() >= deadline) refuseInconsistent();
      Atomics.wait(sleeper, 0, 0, 10);
    }
  }

  const input = readline.createInterface({ input: process.stdin, terminal: false });
  input.on("line", (line) => {
    if (line.trim() === "") return;
    let frame;
    try {
      frame = JSON.parse(line);
    } catch {
      respond({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } });
      return;
    }
    const id = frame.id;
    if (frame.method === "initialize") {
      respond({ jsonrpc: "2.0", id, result: {
        protocolVersion: frame.params?.protocolVersion || "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: { name: "seal __demo-server", version: "0" },
      } });
      return;
    }
    if (frame.method === "tools/list") {
      respond({ jsonrpc: "2.0", id, result: { tools: [
        {
          name: TOOL,
          description: "append one line to the demo data file",
          inputSchema: { type: "object", properties: { line: { type: "string" } }, required: ["line"] },
        },
        {
          name: ERASE_TOOL,
          description: "erase all contents of the demo data file",
          inputSchema: { type: "object", properties: {} },
        },
      ] } });
      return;
    }
    if (frame.method === "tools/call") {
      const name = frame.params?.name;
      if (name !== TOOL && name !== ERASE_TOOL) {
        respond({ jsonrpc: "2.0", id, error: { code: -32602, message: `unknown tool: ${name}` } });
        return;
      }
      if (name === ERASE_TOOL) {
        writeFileSyncedTo(dataFile, "");
        const count = incrementCount(countFile);
        respond({ jsonrpc: "2.0", id, result: { content: [{
          type: "text",
          text: `demo server: erased ${path.basename(dataFile)}; total tool calls: ${count}`,
        }] } });
        return;
      }
      const text = typeof frame.params?.arguments?.line === "string" ? frame.params.arguments.line : "";
      appendSyncedTo(dataFile, text + "\n");
      const count = incrementCount(countFile);
      respond({ jsonrpc: "2.0", id, result: { content: [{
        type: "text",
        text: `demo server: appended ${Buffer.byteLength(text, "utf8") + 1} bytes to ${path.basename(dataFile)}; total tool calls: ${count}`,
      }] } });
      return;
    }
    if (id === undefined) return; // notification: nothing to answer
    respond({ jsonrpc: "2.0", id, error: { code: -32601, message: `unknown method: ${frame.method}` } });
  });
  input.on("close", () => process.exit(0));
}

module.exports = { run, TOOL, ERASE_TOOL };
