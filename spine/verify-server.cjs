// SPDX-License-Identifier: Apache-2.0
// Read-only receipt verification over the same line-delimited stdio JSON-RPC
// transport as the demo server. Tool failures remain JSON tool results.
const fs = require("node:fs");
const path = require("node:path");
const readline = require("node:readline");
const { pathToFileURL } = require("node:url");
const { inspectRuntime } = require("./runtime-inspection.cjs");

const TOOL = "seal_verify";
const ROOT = path.resolve(__dirname, "..");

function refuse(code, message) {
  throw Object.assign(new Error(message), { code });
}

async function verifyReceipt(args) {
  try {
    if (!args || typeof args.receiptPath !== "string" || !args.receiptPath ||
        (args.pubkeyHex !== undefined && typeof args.pubkeyHex !== "string")) {
      refuse("invalid_arguments", "receiptPath must be a non-empty string and pubkeyHex, if supplied, must be a string");
    }
    const absolute = path.resolve(args.receiptPath);
    let stat;
    try { stat = fs.statSync(absolute); }
    catch { refuse("receipt_unavailable", `cannot inspect receipt path: ${absolute}`); }
    if (!stat.isFile()) refuse("receipt_not_file", `receipt path is not a regular file: ${absolute}`);
    if ((stat.mode & 0o444) === 0) refuse("receipt_unreadable", `receipt file has no read permission bits: ${absolute}`);
    let text;
    try { text = fs.readFileSync(absolute); }
    catch { refuse("receipt_unreadable", `cannot read receipt contents: ${absolute}`); }
    if (text.length === 0) refuse("receipt_empty", `receipt is empty: ${absolute}`);
    const runtime = inspectRuntime();
    if (!runtime.present) refuse("runtime_unavailable", `cannot verify receipt: local kernel runtime ${runtime.state} (${runtime.reason})`);
    const verifier = await import(pathToFileURL(path.join(ROOT, "checker", "seal-receipt-v2.mjs")).href);
    const result = await verifier.verify(text, { publicKeyHex: args.pubkeyHex });
    result.ok = result.validate && result.signature && result.replay;
    return result;
  } catch (error) {
    // False means not established; do not invent partial successes when the
    // shared checker throws before returning its result.
    return {
      ok: false, read: false, validate: false, signature: false, replay: false,
      authority: "NOT ESTABLISHED", occurrence: "NOT ESTABLISHED", verify: false,
      error: { code: error.code || "verification_failed", message: error.message },
    };
  }
}

function respond(message) {
  process.stdout.write(JSON.stringify(message) + "\n");
}

function run() {
  const input = readline.createInterface({ input: process.stdin, terminal: false });
  // Drain pending imports/replays on EOF instead of exiting before their replies.
  let pending = Promise.resolve();
  input.on("line", (line) => {
    pending = pending.then(async () => {
      if (line.trim() === "") return;
      let frame;
      try { frame = JSON.parse(line); }
      catch {
        respond({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } });
        return;
      }
      if (!frame || typeof frame !== "object" || Array.isArray(frame)) {
        respond({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "invalid request" } });
        return;
      }
      const id = frame.id;
      if (id === undefined) return; // notification: nothing to answer
      if (frame.method === "initialize") {
        respond({ jsonrpc: "2.0", id, result: {
          protocolVersion: frame.params?.protocolVersion || "2025-06-18",
          capabilities: { tools: {} },
          serverInfo: { name: "seal __verify-server", version: "0" },
        } });
        return;
      }
      if (frame.method === "tools/list") {
        respond({ jsonrpc: "2.0", id, result: { tools: [{
          name: TOOL,
          description: "Read a receipt and verify its signature and verifier-local replay",
          inputSchema: {
            type: "object",
            properties: { receiptPath: { type: "string" }, pubkeyHex: { type: "string" } },
            required: ["receiptPath"],
          },
        }] } });
        return;
      }
      if (frame.method === "tools/call") {
        const name = frame.params?.name;
        if (name !== TOOL) {
          respond({ jsonrpc: "2.0", id, error: { code: -32602, message: `unknown tool: ${name}` } });
          return;
        }
        const result = await verifyReceipt(frame.params?.arguments);
        respond({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: JSON.stringify(result) }] } });
        return;
      }
      respond({ jsonrpc: "2.0", id, error: { code: -32601, message: `unknown method: ${frame.method}` } });
    });
  });
}

module.exports = { run, TOOL };
