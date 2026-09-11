// SPDX-License-Identifier: Apache-2.0
// Shared demo config + scenario definitions for the in-browser WASM evaluator and
// the native conformance harness. Pure ES module (browser + node). NO kernel source
// here — only the public trusted-config payloads the black-box evaluator consumes.
//
// Each scenario carries the exact trusted-config + tool call that reproduces the
// verified verdict the demo narrates. Cert hashes are emitted by the kernel, not
// encoded here.
import { stableHashParts } from "./receipt-format.js";

export const PUBKEY = "demo-pk";

// SHA-256 target commitment, exact mirror of Lean Seal.stableHashParts.
export function stableHash(parts) {
  return stableHashParts(parts);
}

// Match Lean 4.28 Json.compress, not JSON.stringify: Lean uses scalar-value
// key ordering, long escapes for backspace/tab/form feed, and JsonNumber's
// decimal rendering. This is a target preimage only; it never rewrites the
// approved arguments. test/json-arguments.test.cjs checks it against real WASM.
function compareKeys(a, b) {
  const left = Array.from(a), right = Array.from(b);
  for (let i = 0; i < Math.min(left.length, right.length); i++) {
    const difference = left[i].codePointAt(0) - right[i].codePointAt(0);
    if (difference) return difference;
  }
  return left.length - right.length;
}

function leanString(value) {
  // Match entire JSON escape tokens so a literal backslash followed by "t"
  // stays distinct from a tab character.
  return JSON.stringify(value).replace(/\\(?:["\\/bfnrt]|u[0-9a-f]{4})/g,
    (escape) => ({ "\\b": "\\u0008", "\\t": "\\u0009", "\\f": "\\u000c" })[escape] || escape);
}

function leanNumber(value) {
  // Algorithm: leanprover/lean4 v4.28.0, src/Lean/Data/Json/Basic.lean,
  // JsonNumber.toString. Keep this version aligned with the pinned WASM.
  if (!Number.isFinite(value)) throw new Error("non-finite number has no kernel encoding");
  if (value === 0) return "0";
  const sign = value < 0 ? "-" : "";
  const [mantissa, power = "0"] = String(Math.abs(value)).split("e");
  const [whole, fraction = ""] = mantissa.split(".");
  const digits = (whole + fraction).replace(/^0+/, "");
  const places = fraction.length - Number(power);
  if (places <= 0) return sign + digits + "0".repeat(-places);
  // Lean JsonNumber.toString retains up to nine leading fractional zeroes
  // before moving the remaining scale into a negative exponent.
  const exponent = Math.min(0, 9 + digits.length - places);
  const scale = places + exponent;
  const padded = digits.padStart(scale + 1, "0");
  const left = padded.slice(0, -scale);
  const right = padded.slice(-scale).replace(/0+$/, "");
  return sign + left + (right ? `.${right}` : "") + (exponent ? `e${exponent}` : "");
}

const canonicalJson = (value) => {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value).sort(compareKeys).map((key) =>
      `${leanString(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  if (typeof value === "string") return leanString(value);
  if (typeof value === "number") return leanNumber(value);
  return JSON.stringify(value);
};

// The kernel's raw-wire digit bound counts leading fractional zeroes. Use
// scientific notation for fractions so every finite binary64 value needs at
// most 17 mantissa digits. The downstream call and receipt keep their original
// parsed numbers. Integer-valued protocol fields keep their existing spelling.
function wireJson(value) {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("non-finite number has no kernel encoding");
    return Number.isInteger(value) ? JSON.stringify(value) : value.toExponential();
  }
  if (Array.isArray(value)) return `[${value.map(wireJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value).filter((key) => value[key] !== undefined).map((key) =>
      `${JSON.stringify(key)}:${wireJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

// Stage-A guarded target: domain + tool + complete canonical arguments and
// explicit absence frames for metadata, request state and input responses.
export function guardTarget(tool, args, server = "") {
  return stableHash([
    "seal.guard-target/v2-proposed-meta-all", ...(server === "" ? [tool] : [server, tool]), canonicalJson(args),
    "meta.absent", "", "requestState.absent", "",
    "inputResponses.absent", "",
  ]);
}

export function buildEnvelope(payload, pubkey = PUBKEY) {
  const compact = JSON.stringify(payload);
  return JSON.stringify({ payload: compact, signature: `stub-ed25519:${pubkey}:${compact}` });
}

const safety = (tools) => ({ approval: { control_file: "X", ttl_seconds: 120 }, tools });
const DB = { name: "db.execute", mode: "guarded",
  match: { type: "contains_any_ci", arg: "sql", needles: ["drop", "delete", "truncate"] },
  target: [{ full_arguments: true }] };
const G = (name) => ({ name, mode: "guarded", match: { type: "always" },
  target: [{ full_arguments: true }] });
const DENY_APPROVE = { name: "approve", mode: "deny", match: { type: "always" }, target: [] };
const CONSENSUS = { roster: [1, 2, 3], votes_file: "X", high_stakes: ["payments.send"] };

// Demo 1 — determinism differential: db.execute + approve safety-gated;
// payments.send is consensus-gated (safety allows it once approved).
const CFG_DEMO1 = { epoch: 1,
  safety: safety([DB, G("payments.send"), DENY_APPROVE]),
  temporal: { policies: [] }, consensus: CONSENSUS };
// Demo 2 — policy swap: payment safety-gated; policy B adds the quorum rule.
const CFG_PAY_A = { epoch: 1, safety: safety([G("payments.send")]), temporal: { policies: [] } };
const CFG_PAY_B = { ...CFG_PAY_A, consensus: CONSENSUS };
// Demo 3 — confident hallucination: store.update safety-gated + convergence kernel.
const CFG_STORE = { epoch: 1, safety: safety([G("store.update")]),
  temporal: { policies: [] }, convergence: { tools: [{ tool: "store.update", op_arg: "op" }] } };
// Temporal — out-of-order / stale-capability: a destructive db.execute AFTER a session.revoke is
// forbidden by a real temporal policy. Needs an ordered trace (revoke then the call), so it is
// decided as a sequence (seal_init once, a seal_decide per step) — see decideSeq.
export const CFG_TEMPORAL = { epoch: 1,
  safety: safety([DB, G("session.revoke")]),
  temporal: { policies: [{ name: "no-destructive-after-revoke", type: "no_after",
    trigger: ["session.revoke"], forbidden: ["db.execute"] }] } };
// "Fire your own" box: a rich multi-kernel config covering the common tools.
export const CFG_STANDARD = { epoch: 1,
  safety: safety([DB, G("payments.send"), G("session.revoke"),
                  G("store.update"), G("key.use"), DENY_APPROVE]),
  temporal: { policies: [] }, consensus: CONSENSUS,
  convergence: { tools: [{ tool: "store.update", op_arg: "op" }] } };

// scenario key -> {config, tool, args, approvals, demo, label}
export const SCENARIOS = {
  "destructive-sql": { config: CFG_DEMO1, tool: "db.execute", args: { database: "prod", sql: "drop table users" }, approvals: [], demo: 1, label: "Drop the production users table (no approval)" },
  "self-approve":    { config: CFG_DEMO1, tool: "approve", args: { target: 1 }, approvals: [], demo: 1, label: "Self-approve my own destructive call" },
  "wire-40k":        { config: CFG_DEMO1, tool: "payments.send", args: { amount: 40000, to: "GB-unlisted" }, approvals: [guardTarget("payments.send", { amount: 40000, to: "GB-unlisted" })], demo: 1, label: "Wire £40,000 to an unlisted account" },
  "pay-before":      { config: CFG_PAY_A, tool: "payments.send", args: { amount: 40000, to: "supplier-77" }, approvals: [guardTarget("payments.send", { amount: 40000, to: "supplier-77" })], demo: 2, label: "Policy A — no quorum rule" },
  "pay-after":       { config: CFG_PAY_B, tool: "payments.send", args: { amount: 40000, to: "supplier-77" }, approvals: [guardTarget("payments.send", { amount: 40000, to: "supplier-77" })], demo: 2, label: "Policy B — + 2-of-3 quorum" },
  "store-safe":      { config: CFG_STORE, tool: "store.update", args: { op: "orset.add", key: "k1" }, approvals: [guardTarget("store.update", { op: "orset.add", key: "k1" })], demo: 3, label: "store.update { op: orset.add }" },
  "store-subtle":    { config: CFG_STORE, tool: "store.update", args: { op: "assign", key: "k1" }, approvals: [guardTarget("store.update", { op: "assign", key: "k1" })], demo: 3, label: "store.update { op: assign }" },
};

const rpc = (tool, args, id = 1) => wireJson({ jsonrpc: "2.0", id, method: "tools/call", params: { name: tool, arguments: args } });

// Build the seal_decide step-input JSON for a scenario (or a custom tool call).
// `votes` is the raw consensus votes-file text (NDJSON lines
// `{"acceptor":<nat>,"value":"<tool>"}`); default "" is byte-identical to before, so
// existing scenarios/conformance are unaffected.
export function buildStepInput({ tool, args, approvals = [], now = 1000, votes = "", id = 1 }) {
  return JSON.stringify({ line: rpc(tool, args, id), now,
    approvals: approvals.map((t) => ({ target: t })), votes, grants: "", forecasts: "" });
}

// Parse seal_decide output -> demo-friendly verdict.
export function parseVerdict(raw, tool) {
  const v = JSON.parse(raw);
  if (v.error) return { verdict: "ERROR", reason: v.error, certs: [], tool };
  if (v.route === "passthrough") return { verdict: "ALLOW", reason: "not a mediated tool call (passthrough)", certs: [], tool };
  const audit = v.audit ? JSON.parse(v.audit) : { certs: [], verdict: v.route === "block" ? "deny" : "allow" };
  const certs = (audit.certs || []).map((c) => ({ kernel: c.kernel, verdict: c.verdict, reason: c.reason, certHash: String(c.certHash) }));
  const denied = certs.find((c) => c.verdict === "deny");
  return {
    verdict: v.route === "block" ? "DENY" : "ALLOW",
    reason: denied ? `${denied.kernel} kernel: ${denied.reason}` : "every gating kernel allows",
    deny_kernel: denied ? denied.kernel : null,
    certs, tool,
    // single representative cert for the determinism lane (the deny cert, else first)
    certHash: (denied || certs[0] || {}).certHash || null,
  };
}
