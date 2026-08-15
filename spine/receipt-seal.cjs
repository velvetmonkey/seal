// SPDX-License-Identifier: Apache-2.0
// Receipt sealing (product side of V11-RECEIPT-01). The proxy signs each
// receipt at emission so that a SEPARATE external checker — one that shares
// no code with this binary — can accept a genuine receipt and refuse a
// mutated one, GIVEN a public key the reader trusts out of band.
//
// The seal carries per-field commitments (decision, tool, arguments) AND an
// Ed25519 signature over the whole committed body. The commitments let the
// checker name WHICH field was mutated; the signature makes every commitment
// unforgeable — you cannot repair a commitment to match a mutated field
// without re-signing, and you cannot re-sign without the private key.
const crypto = require("node:crypto");

const DOMAIN = "seal.receipt-seal/v1\n";
const SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

class ReceiptRefusal extends Error {
  constructor(code, message) {
    super(message);
    this.name = "ReceiptRefusal";
    this.code = code;
    this.refusal = true;
  }
}

function sha256Hex(text) {
  return crypto.createHash("sha256").update(Buffer.from(text, "utf8")).digest("hex");
}

// Compact JSON with UTF-8-sorted keys. The checker carries a COPY of this same
// rule, kept local so it imports no Seal module at check time. That is source
// separation only: a defect in the rule itself exists in both copies, and the
// checker cannot detect it. Proved 2026-08-15 by flipping the key comparator in
// both copies; the checker then accepted the receipt.
function canonical(value) {
  if (value === undefined) throw new ReceiptRefusal("receipt_value_absent", "receipt value is absent");
  if (typeof value === "number" && !Number.isFinite(value)) {
    throw new ReceiptRefusal("receipt_value_malformed", "receipt number is not finite");
  }
  if (value === null || typeof value === "number" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (typeof value !== "object") {
    throw new ReceiptRefusal("receipt_value_malformed", `receipt value has unsupported type ${typeof value}`);
  }
  const names = Object.keys(value).sort((a, b) => Buffer.compare(Buffer.from(a, "utf8"), Buffer.from(b, "utf8")));
  return `{${names.map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(",")}}`;
}

function publicKeyHex(publicKey) {
  const der = publicKey.export({ type: "spki", format: "der" });
  return der.subarray(der.length - 32).toString("hex");
}

function generateSigner() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  return { privateKey, publicKey, publicKeyHex: publicKeyHex(publicKey) };
}

// Given the plain receipt body, return the sealed receipt: body + commitments
// + signature. `decision`, `tool`, `arguments` must be present on the body.
function sealReceipt(signer, body) {
  const decision = String(body.decision);
  const tool = String(body.tool);
  const argsCanonical = canonical(body.arguments ?? {});
  const commitments = {
    decision_sha256: sha256Hex(decision),
    tool_sha256: sha256Hex(tool),
    args_sha256: sha256Hex(argsCanonical),
    effect_sha256: sha256Hex(canonical({ args: body.arguments ?? {}, tool })),
  };
  const committed = { ...body, seal: { alg: "ed25519", ...commitments } };
  const message = Buffer.from(DOMAIN + canonical(committed), "utf8");
  const sig = crypto.sign(null, message, signer.privateKey).toString("hex");
  committed.seal.sig = sig;
  return committed;
}

module.exports = { ReceiptRefusal, generateSigner, sealReceipt, canonical, sha256Hex, publicKeyHex };
