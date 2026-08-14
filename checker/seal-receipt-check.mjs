// SPDX-License-Identifier: Apache-2.0
//
// V11-RECEIPT-01 — the EXTERNAL Seal receipt checker.
//
// This program is deliberately NOT the seal binary. It imports nothing from
// the seal command or its internal modules, and it never spawns or shells out
// to them; it re-implements canonicalisation, hashing and Ed25519
// verification from scratch on top of node:crypto alone. A reader can
// therefore check Seal's claim about a receipt without running — or trusting
// — Seal's own code.
//
// Trust model, stated plainly: the public key is a TRUST INPUT the reader
// supplies out of band (--pubkey). The checker NEVER takes the verifying key
// from inside the receipt, because a mutator who could edit the receipt could
// also swap an embedded key. Given a trusted key, this checker refuses any
// receipt whose decision, tool, arguments or signature has been altered.
//
// Usage:
//   node checker/seal-receipt-check.mjs RECEIPT.json --pubkey (HEX | FILE)
//
// Exit 0 and "ACCEPT ..." on a genuine receipt; non-zero and "REFUSE <code>:
// <reason>" on a mutated or malformed one. It never prints "verified" as a
// bare adjective and it makes no claim beyond what it recomputed.

import { readFileSync } from "node:fs";
import { createHash, verify as edVerify, createPublicKey } from "node:crypto";

const DOMAIN = "seal.receipt-seal/v1\n";
const SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

function sha256Hex(text) {
  return createHash("sha256").update(Buffer.from(text, "utf8")).digest("hex");
}

// Independent canonicaliser: compact JSON, object keys sorted by UTF-8 bytes.
function canonical(value) {
  if (value === null || typeof value === "number" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const names = Object.keys(value).sort((a, b) => Buffer.compare(Buffer.from(a, "utf8"), Buffer.from(b, "utf8")));
  return `{${names.map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(",")}}`;
}

function publicKeyFromHex(hex) {
  if (!/^[0-9a-f]{64}$/.test(hex)) throw new Error("public key must be 32-byte hex");
  return createPublicKey({ key: Buffer.concat([SPKI_PREFIX, Buffer.from(hex, "hex")]), type: "spki", format: "der" });
}

class Refusal extends Error {
  constructor(code, reason) { super(reason); this.code = code; }
}

// The check. Returns { accepted, checks } or throws Refusal. Order matters:
// the per-field commitments are checked first so a single-field mutation is
// named specifically; the signature is the unforgeable backstop that also
// catches any field a commitment does not cover (e.g. a repaired commitment).
export function checkReceipt(receipt, pubKeyHex) {
  if (receipt === null || typeof receipt !== "object") throw new Refusal("not_a_receipt", "input is not a JSON object");
  if (receipt.receipt !== "seal.spine/v1") throw new Refusal("unknown_format", `unknown receipt format: ${receipt.receipt}`);
  const seal = receipt.seal;
  if (!seal || typeof seal !== "object") throw new Refusal("unsealed", "receipt carries no seal; it cannot be checked");
  if (seal.alg !== "ed25519") throw new Refusal("unknown_algorithm", `unknown seal algorithm: ${seal.alg}`);
  for (const field of ["decision", "tool", "arguments"]) {
    if (!(field in receipt)) throw new Refusal("incomplete_receipt", `receipt has no ${field} field to check`);
  }

  // 1. decision commitment
  if (sha256Hex(String(receipt.decision)) !== seal.decision_sha256) {
    throw new Refusal("decision_binding_mismatch", "the recorded decision does not match its sealed commitment");
  }
  // 2. tool commitment
  if (sha256Hex(String(receipt.tool)) !== seal.tool_sha256) {
    throw new Refusal("tool_binding_mismatch", "the recorded tool does not match its sealed commitment");
  }
  // 3. arguments commitment
  if (sha256Hex(canonical(receipt.arguments)) !== seal.args_sha256) {
    throw new Refusal("arguments_binding_mismatch", "the recorded arguments do not match their sealed commitment");
  }
  // 4. combined effect commitment (defence in depth)
  if (sha256Hex(canonical({ args: receipt.arguments, tool: receipt.tool })) !== seal.effect_sha256) {
    throw new Refusal("effect_binding_mismatch", "the recorded effect does not match its sealed commitment");
  }
  // 5. signature backstop — makes every commitment above unforgeable
  const { sig, ...sealWithoutSig } = seal;
  if (typeof sig !== "string" || !/^[0-9a-f]{128}$/.test(sig)) throw new Refusal("signature_malformed", "the seal signature is missing or malformed");
  const committed = { ...receipt, seal: sealWithoutSig };
  const message = Buffer.from(DOMAIN + canonical(committed), "utf8");
  let ok;
  try {
    ok = edVerify(null, message, publicKeyFromHex(pubKeyHex), Buffer.from(sig, "hex"));
  } catch (error) {
    throw new Refusal("pubkey_invalid", `the supplied public key is unusable: ${error.message}`);
  }
  if (!ok) throw new Refusal("signature_invalid", "the seal signature does not verify against the supplied public key");

  return {
    accepted: true,
    decision: receipt.decision,
    tool: receipt.tool,
    checks: ["decision", "tool", "arguments", "effect", "signature"],
  };
}

function resolvePubkey(value) {
  if (/^[0-9a-f]{64}$/.test(value)) return value;
  try {
    return readFileSync(value, "utf8").trim();
  } catch {
    throw new Refusal("pubkey_missing", `--pubkey must be 32-byte hex or a readable file: ${value}`);
  }
}

function main(argv) {
  const args = argv.slice(2);
  const receiptPath = args.find((a) => !a.startsWith("--"));
  const keyIndex = args.indexOf("--pubkey");
  if (!receiptPath || keyIndex === -1 || !args[keyIndex + 1]) {
    process.stderr.write("usage: seal-receipt-check.mjs RECEIPT.json --pubkey (HEX | FILE)\n");
    process.exit(2);
  }
  let receipt;
  try {
    receipt = JSON.parse(readFileSync(receiptPath, "utf8"));
  } catch (error) {
    process.stdout.write(`REFUSE unreadable_receipt: ${error.message}\n`);
    process.exit(1);
  }
  try {
    const pubKeyHex = resolvePubkey(args[keyIndex + 1]);
    const result = checkReceipt(receipt, pubKeyHex);
    process.stdout.write(`ACCEPT ${result.decision} ${result.tool} — decision, tool, arguments and signature all match the sealed commitments\n`);
    process.exit(0);
  } catch (error) {
    if (error instanceof Refusal) {
      process.stdout.write(`REFUSE ${error.code}: ${error.message}\n`);
      process.exit(1);
    }
    process.stdout.write(`REFUSE checker_error: ${error.message}\n`);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main(process.argv);
