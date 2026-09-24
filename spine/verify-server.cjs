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

// Shared CLI/MCP verification boundary. The typed result is built only here;
// transport-specific exit status and legacy text errors stay outside that object.
async function verifyReceipt({ receiptPath, pubkeyHex } = {}) {
  let result = {
    read: false, validate: false, replay: false, signature: false,
    authority: "NOT ESTABLISHED", occurrence: "NOT ESTABLISHED", verify: false,
  };
  let phase = "input";
  try {
    if (typeof receiptPath !== "string" || !receiptPath || receiptPath === "--json") throw new Error("usage: seal verify PATH");
    if (pubkeyHex !== undefined && typeof pubkeyHex !== "string") {
      throw Object.assign(new Error("pubkeyHex must be a string"), { code: "invalid_arguments" });
    }
    const absolute = path.resolve(receiptPath);
    let stat;
    try { stat = fs.statSync(absolute); } catch { throw new Error(`cannot inspect receipt path: ${absolute}`); }
    if (!stat.isFile()) throw new Error(`receipt path is not a regular file: ${absolute}`);
    if ((stat.mode & 0o444) === 0) throw new Error(`receipt file has no read permission bits: ${absolute}`);
    let text;
    try { text = fs.readFileSync(absolute); } catch { throw new Error(`cannot read receipt contents: ${absolute}`); }
    if (text.length === 0) throw new Error(`receipt is empty: ${absolute}`);
    phase = "runtime";
    const runtime = inspectRuntime();
    if (!runtime.present) throw new Error(`cannot verify receipt: local kernel runtime ${runtime.state} (${runtime.reason})`);
    const verifier = await import(pathToFileURL(path.join(ROOT, "checker", "seal-receipt-v2.mjs")).href);
    phase = "receipt";
    // read() retains the checker's UTF-8 and duplicate-member refusals.
    verifier.read(text); result.read = true;
    result = await verifier.verify(text, { publicKeyHex: pubkeyHex });
    result.ok = result.validate && result.signature && result.replay;
    result.code = result.ok ? null : "signature_unverifiable";
    return { result, exitCode: result.ok ? 0 : 1, verifier };
  } catch (error) {
    const verificationFailure = new Set([
      "signature_mismatch", "commitment_mismatch", "verdict_mismatch",
      "action_verdict_mismatch", "inert_input",
    ]).has(error.code);
    const exitCode = phase === "runtime" || verificationFailure ? 1 : 2;
    return { result: {
      ...result, ok: false,
      code: error.code || (phase === "input" ? "read_failed" : phase === "runtime" ? "runtime_unavailable" : "invalid_receipt"),
      message: error.message,
    }, exitCode, error };
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
        const { result } = await verifyReceipt(frame.params?.arguments || {});
        respond({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: JSON.stringify(result) }] } });
        return;
      }
      respond({ jsonrpc: "2.0", id, error: { code: -32601, message: `unknown method: ${frame.method}` } });
    });
  });
}

module.exports = { run, TOOL, verifyReceipt };
