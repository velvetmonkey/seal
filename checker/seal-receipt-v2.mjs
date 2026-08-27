// SPDX-License-Identifier: Apache-2.0
// Phase A verifier. It does not import a producer or its canonicaliser.
import { createHash, createPublicKey, verify as edVerify } from "node:crypto";
import { readFileSync } from "node:fs";
import { TextDecoder } from "node:util";
import { pathToFileURL } from "node:url";

const ORDER = ["seal_receipt", "tool", "action", "arguments", "now", "kernel_config", "granted_capabilities", "kernel_inputs", "verdict", "reason", "replay", "signature"];
const HEX64 = /^[0-9a-f]{64}$/;
const SPKI = Buffer.from("302a300506032b6570032100", "hex");
const fail = (message, code = "invalid_receipt") => { const e = new Error(message); e.code = code; throw e; };

// This is an independent implementation of the written specification:
// insertion order, never producer sorting.
export function canonical(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value) || !Number.isInteger(value) || !Number.isSafeInteger(value)) fail("number is not a finite safe integer", "number_not_canonical");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(",")}}`;
  fail("unsupported JSON value", "value_not_canonical");
}

export function sha256(text) { return createHash("sha256").update(Buffer.from(text, "utf8")).digest("hex"); }

// JSON.parse keeps the last duplicate member. Walk the bytes first so that a
// verifier never signs or judges an ambiguous interpretation.
function scanDocument(text) {
  let i = 0;
  const ws = () => { while (/[\t\n\r ]/.test(text[i] || "")) i++; };
  const string = () => { const start = i; if (text[i++] !== '"') fail("expected string", "read_failed"); while (i < text.length) { const c = text[i++]; if (c === "\\") { if (i >= text.length) fail("truncated escape", "read_failed"); if (text[i++] === "u") { if (!/^[0-9a-fA-F]{4}$/.test(text.slice(i, i + 4))) fail("bad unicode escape", "read_failed"); i += 4; } } else if (c === '"') return JSON.parse(text.slice(start, i)); else if (c.charCodeAt(0) < 32) fail("control character in string", "read_failed"); } fail("truncated string", "read_failed"); };
  const value = () => { ws(); const c = text[i]; if (c === '"') { string(); return; } if (c === "{") { object(); return; } if (c === "[") { array(); return; } if (text.startsWith("true", i)) { i += 4; return; } if (text.startsWith("false", i)) { i += 5; return; } if (text.startsWith("null", i)) { i += 4; return; } const n = text.slice(i).match(/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/); if (!n) fail("bad value", "read_failed"); i += n[0].length; };
  const array = () => { i++; ws(); if (text[i] === "]") { i++; return; } for (;;) { value(); ws(); if (text[i] === ",") { i++; continue; } if (text[i] === "]") { i++; return; } fail("truncated array", "read_failed"); } };
  const object = () => { i++; ws(); const names = new Set(); if (text[i] === "}") { i++; return; } for (;;) { const name = string(); if (names.has(name)) fail(`duplicate member ${name}`, "duplicate_member"); names.add(name); ws(); if (text[i++] !== ":") fail("expected colon", "read_failed"); value(); ws(); if (text[i] === ",") { i++; continue; } if (text[i] === "}") { i++; return; } fail("truncated object", "read_failed"); } };
  ws(); value(); ws(); if (i !== text.length) fail("trailing or truncated JSON", "read_failed");
}

export function read(input) {
  let text;
  if (typeof input === "string") text = input;
  else if (input instanceof Uint8Array) {
    try { text = new TextDecoder("utf-8", { fatal: true }).decode(input); }
    catch (e) { fail(`ill-formed UTF-8: ${e.message}`, "read_failed"); }
  } else fail("receipt must be UTF-8 bytes or a string", "read_failed");
  scanDocument(text);
  try { return JSON.parse(text); } catch (e) { fail(`JSON parse failed: ${e.message}`, "read_failed"); }
}

function validate(r) {
  if (!r || typeof r !== "object" || Array.isArray(r)) fail("envelope is not an object");
  if (r.seal_receipt !== "v2") fail("unsupported receipt schema");
  let orderIndex = -1;
  for (const k of Object.keys(r)) { const next = ORDER.indexOf(k); if (next <= orderIndex) fail("member order is not the v2 order", "member_order"); orderIndex = next; }
  if (typeof r.tool !== "string" || !r.tool || !r.arguments || Array.isArray(r.arguments)) fail("tool and arguments are required");
  if (!Number.isSafeInteger(r.now) || r.now < 0) fail("now must be a non-negative safe integer");
  if (!r.kernel_config || typeof r.kernel_config !== "object" || Array.isArray(r.kernel_config)) fail("kernel_config is required");
  if (!Array.isArray(r.granted_capabilities) || !r.kernel_inputs || typeof r.kernel_inputs !== "object") fail("kernel inputs are required");
  if (!Array.isArray(r.kernel_inputs.approvals) || !r.kernel_inputs.approvals.every((x) => typeof x === "string")) fail("approvals must be strings");
  for (const k of ["votes", "grants", "forecasts"]) if (typeof r.kernel_inputs[k] !== "string") fail(`kernel_inputs.${k} must be a string`);
  const targets = r.granted_capabilities.map((g) => g && g.target);
  if (!r.granted_capabilities.every((g) => g && typeof g === "object" && typeof g.target === "string") ||
      JSON.stringify(targets) !== JSON.stringify(r.kernel_inputs.approvals))
    fail("granted capabilities do not match approvals", "input_mismatch");
  if (!["ALLOW", "BLOCK", "ERROR"].includes(r.verdict) || typeof r.reason !== "string") fail("verdict and reason are required");
  if (!r.replay || !HEX64.test(r.replay.args_sha256) || !HEX64.test(r.replay.config_sha256)) fail("replay commitments are required");
  if (r.replay.args_sha256 !== sha256(canonical(r.arguments))) fail("arguments commitment mismatch", "commitment_mismatch");
  if (r.replay.config_sha256 !== sha256(canonical(r.kernel_config))) fail("kernel config commitment mismatch", "commitment_mismatch");
}

export async function replay(r) {
  if (r.kernel_inputs.grants !== "" || r.kernel_inputs.forecasts !== "")
    fail("grants and forecasts are inert in the current kernel and must be empty", "inert_input");
  const mod = await import(new URL("../runtime/kernel/decision-runner.cjs", import.meta.url));
  const x = await mod.default.decide(r.kernel_config, {
    tool: r.tool, args: r.arguments, approvals: r.kernel_inputs.approvals, now: r.now,
    votes: r.kernel_inputs.votes, grants: r.kernel_inputs.grants, forecasts: r.kernel_inputs.forecasts,
    granted_capabilities: r.granted_capabilities,
  });
  if (x.verdict !== r.verdict) fail(`recorded verdict ${r.verdict} does not reproduce as ${x.verdict}`, "verdict_mismatch");
  return x;
}

function checkSignature(r, keyHex) {
  if (!r.signature) return false;
  if (r.signature.algorithm !== "ed25519" || typeof r.signature.value !== "string" || !/^[0-9a-f]{128}$/.test(r.signature.value)) fail("signature is malformed", "signature_mismatch");
  if (!/^[0-9a-f]{64}$/.test(keyHex || "")) return false;
  const unsigned = { ...r }; delete unsigned.signature;
  const key = createPublicKey({ key: Buffer.concat([SPKI, Buffer.from(keyHex, "hex")]), type: "spki", format: "der" });
  if (!edVerify(null, Buffer.from(canonical(unsigned), "utf8"), key, Buffer.from(r.signature.value, "hex"))) fail("signature mismatch", "signature_mismatch");
  return true;
}

export async function verify(text, { publicKeyHex, authorityRoot, occurrenceWitness } = {}) {
  const r = read(text); validate(r);
  const signed = checkSignature(r, publicKeyHex || authorityRoot);
  await replay(r);
  return { read: true, validate: true, replay: true, signature: signed, authority: Boolean(authorityRoot), occurrence: Boolean(occurrenceWitness), verify: signed && Boolean(authorityRoot) && Boolean(occurrenceWitness), receipt: r };
}

export function format(result) { return `Document structure       ${result.read ? "VALID" : "INVALID"}\nSignature and bindings   ${result.signature ? "VALID" : "UNVERIFIED"}\nKernel decision          ${result.replay ? "REPRODUCED" : "NOT REPRODUCED"}\nAuthority key            UNPINNED / CALLER-SUPPLIED\nEvent occurrence         ${result.occurrence ? "WITNESSED" : "NOT ESTABLISHED"}\n                         ------------------\nREAD      ${result.read ? "available" : "unavailable"}\nVALIDATE  ${result.validate ? "available" : "unavailable"}\nREPLAY    ${result.replay ? "available" : "unavailable"}\nVERIFY    ${result.verify ? "VERIFIED" : "UNVERIFIED"}`; }

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const file = process.argv[2]; const keyAt = process.argv.indexOf("--pubkey");
  try { const out = await verify(readFileSync(file, "utf8"), { publicKeyHex: keyAt > 0 ? process.argv[keyAt + 1] : undefined }); console.log(format(out)); }
  catch (e) { console.log(`REFUSE ${e.code || "invalid_receipt"}: ${e.message}`); process.exitCode = 1; }
}
