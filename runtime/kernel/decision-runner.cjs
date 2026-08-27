// SPDX-License-Identifier: Apache-2.0
// Decision-only verifier runner. This deliberately does not load kernel.js or
// receipt-format.js: the verifier needs the raw kernel decision, not a
// producer-assembled receipt.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = path.resolve(__dirname);
const WASM_DIR = path.join(ROOT, "wasm");
let moduleInstance;
const keys = crypto.generateKeyPairSync("ed25519");
const publicKey = Buffer.from(keys.publicKey.export({ type: "spki", format: "der" }))
  .subarray(-32).toString("hex");

function buildEnvelope(config) {
  const payload = JSON.stringify(config);
  const signature = crypto.sign(null, Buffer.from(payload, "utf8"), keys.privateKey).toString("hex");
  return JSON.stringify({ payload, signature });
}

function rpc(tool, args, id = 1) {
  return JSON.stringify({ jsonrpc: "2.0", id, method: "tools/call", params: { name: tool, arguments: args } });
}

function buildStepInput({ tool, args, approvals, now, votes, grants, forecasts, granted_capabilities }) {
  return JSON.stringify({
    line: rpc(tool, args), now,
    approvals: approvals.map((target) => ({ target })),
    votes, grants, forecasts, granted_capabilities,
  });
}

function parseVerdict(raw) {
  const result = JSON.parse(raw);
  if (result.error) return "ERROR";
  if (result.route === "passthrough") return "ALLOW";
  return result.route === "block" ? "BLOCK" : "ALLOW";
}

async function load() {
  if (moduleInstance) return moduleInstance;
  globalThis.require = require;
  globalThis.__dirname = WASM_DIR;
  (0, eval)(fs.readFileSync(path.join(WASM_DIR, "seal.js"), "utf8"));
  moduleInstance = await globalThis.SealModule({ locateFile: (p) => path.join(WASM_DIR, p), print() {}, printErr() {} });
  return moduleInstance;
}

async function decide(config, input) {
  const M = await load();
  const init = JSON.parse(M.ccall("seal_init", "string", ["string", "string"], [buildEnvelope(config), publicKey]));
  if (init.ok !== true) throw new Error("seal_init failed: " + JSON.stringify(init));
  const raw = M.ccall("seal_decide", "string", ["string"], [buildStepInput(input)]);
  return { raw, verdict: parseVerdict(raw) };
}

module.exports = { decide };
