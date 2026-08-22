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

const TOOL = "demo.mutate";
const ERASE_TOOL = "demo.erase";

function writeFileSyncedTo(filePath, text) {
  const fd = fs.openSync(filePath, "w", 0o600);
  try {
    fs.writeSync(fd, text);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

function appendSyncedTo(filePath, text) {
  const fd = fs.openSync(filePath, "a", 0o600);
  try {
    fs.writeSync(fd, text);
    fs.fsyncSync(fd);
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
  writeFileSyncedTo(dataFile, "");
  writeFileSyncedTo(countFile, "0\n");

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
