// SPDX-License-Identifier: Apache-2.0
// Producer-side implementation of docs/SEAL-RECEIPT-V2.md. The separately landed
// verifier deliberately does not import this module.
const crypto = require("node:crypto");

class ReceiptRefusal extends Error {
  constructor(code, message) {
    super(message);
    this.name = "ReceiptRefusal";
    this.code = code;
    this.refusal = true;
  }
}

function canonical(value) {
  if (value === undefined) throw new ReceiptRefusal("receipt_value_absent", "receipt value is absent");
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value) || !Number.isInteger(value) || !Number.isSafeInteger(value)) {
      throw new ReceiptRefusal("receipt_value_malformed", "receipt number is not a finite safe integer");
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  }
  throw new ReceiptRefusal("receipt_value_malformed", `receipt value has unsupported type ${typeof value}`);
}

function sha256Hex(text) {
  return crypto.createHash("sha256").update(Buffer.from(text, "utf8")).digest("hex");
}

function publicKeyHex(publicKey) {
  const der = publicKey.export({ type: "spki", format: "der" });
  return der.subarray(der.length - 32).toString("hex");
}

function generateSigner() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  return { privateKey, publicKey, publicKeyHex: publicKeyHex(publicKey) };
}

function assembleReceipt(record, action) {
  const body = {
    seal_receipt: "v2",
    tool: record.tool,
  };
  if (action !== undefined) body.action = action;
  body.arguments = record.arguments;
  body.now = record.now;
  body.kernel_config = record.kernel_config;
  body.granted_capabilities = record.granted_capabilities;
  body.kernel_inputs = record.kernel_inputs;
  body.verdict = record.verdict;
  body.reason = record.reason;
  body.replay = {
    args_sha256: sha256Hex(canonical(record.arguments)),
    config_sha256: sha256Hex(canonical(record.kernel_config)),
  };
  return body;
}

function sealReceipt(signer, record, action) {
  const body = assembleReceipt(record, action);
  if (!signer) return body;
  return {
    ...body,
    signature: {
      algorithm: "ed25519",
      value: crypto.sign(null, Buffer.from(canonical(body), "utf8"), signer.privateKey).toString("hex"),
    },
  };
}

module.exports = { ReceiptRefusal, assembleReceipt, canonical, generateSigner, publicKeyHex, sealReceipt, sha256Hex };
