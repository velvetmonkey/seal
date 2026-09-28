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
const authorization = import(require("node:url").pathToFileURL(path.join(ROOT, "authorization.js")).href);

// Independently encode the kernel wire form. Fractions use scientific
// notation to satisfy its mantissa-digit bound without rounding their values.
// This does not import the producer or its target/receipt canonicalisers.
function wireJson(value) {
  if (Array.isArray(value)) return `[${value.map(wireJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const members = Object.keys(value).filter((key) => value[key] !== undefined);
    return `{${members.map((key) => `${JSON.stringify(key)}:${wireJson(value[key])}`).join(",")}}`;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("non-finite kernel input");
    if (!Number.isInteger(value)) return value.toExponential();
  }
  return JSON.stringify(value);
}

function rpc(tool, args, id = 1, action) {
  return wireJson({ jsonrpc: "2.0", id, method: "tools/call", params: { name: tool, ...(action === undefined ? {} : { action }), arguments: args } });
}

function buildStepInput({ tool, args, action, line, signedApprovals = [], approvals, now, votes, grants, forecasts, granted_capabilities }) {
  return JSON.stringify({
    line: line ?? rpc(tool, args, 1, action), now, signedApprovals,
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
  const session = await (await authorization).authorizationSession(config);
  const init = JSON.parse(M.ccall("seal_init", "string", ["string", "string"], [session.envelope, session.publicKey]));
  if (init.ok !== true) throw new Error("seal_init failed: " + JSON.stringify(init));
  const raw = M.ccall("seal_decide", "string", ["string"], [await session.approve(M, buildStepInput(input))]);
  return { raw, verdict: parseVerdict(raw) };
}

module.exports = { decide, parseVerdict };
