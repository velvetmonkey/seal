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
  try {
    if (typeof raw !== "string") return "ERROR";
    const result = JSON.parse(raw);
    if (!result || typeof result !== "object" || Array.isArray(result)) return "ERROR";
    if (Object.hasOwn(result, "error")) return "ERROR";
    if (!["passthrough", "forward", "block"].includes(result.route)) return "ERROR";
    // The judge validates supplied audit structure independently of the
    // producer. A malformed or contradictory audit cannot grant permission.
    if (Object.hasOwn(result, "audit")) {
      if (typeof result.audit !== "string" || result.route === "passthrough") return "ERROR";
      const audit = JSON.parse(result.audit);
      if (!audit || typeof audit !== "object" || Array.isArray(audit) ||
          audit.verdict !== (result.route === "forward" ? "allow" : "deny") ||
          !Array.isArray(audit.certs) || audit.certs.some(c =>
            !c || typeof c !== "object" || Array.isArray(c) ||
            typeof c.kernel !== "string" || typeof c.reason !== "string" ||
            typeof c.certHash !== "string" || !/^[0-9]+$/.test(c.certHash) ||
            !["allow", "deny"].includes(c.verdict) ||
            (result.route === "forward" && c.verdict !== "allow"))) return "ERROR";
    }
    if (result.route === "forward" || result.route === "passthrough") return "ALLOW";
    return "BLOCK";
  } catch { return "ERROR"; }
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

module.exports = { decide, parseVerdict };
