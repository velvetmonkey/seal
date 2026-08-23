// SPDX-License-Identifier: Apache-2.0
//
// V11-RECEIPT-01 — the EXTERNAL Seal receipt checker.
//
// This program is deliberately NOT the seal binary. It needs none of Seal's
// code at RUNTIME: it imports nothing from the seal command or its internal
// modules, never spawns or shells out to them, and reaches its answer using
// only node:crypto and node:fs. A reader can therefore check a receipt
// without running — or trusting — Seal's own code at check time.
//
// Trust model, stated plainly: the public key is a TRUST INPUT the reader
// supplies out of band (--pubkey). The checker NEVER takes the verifying key
// from inside the receipt, because a mutator who could edit the receipt could
// also swap an embedded key. Given a trusted key, this checker refuses any
// receipt whose decision, tool, arguments or signature has been altered.
//
// LIMITS — what this check does NOT establish:
//   1. Runtime-separate, with the canonicalisation implemented separately.
//      The receipt checker applies the same rule as the sealer in
//      spine/receipt-seal.cjs, but omits its refusal branches for undefined
//      values, non-finite numbers and unsupported non-object values. Run
//      `node --test test/receipt-checker.test.cjs` to check the corresponding
//      rule statements. A conceptual bug shared by both implementations can
//      still make both agree on the same wrong answer.
//   2. Key provisioning is the whole trust. If the reader supplies the
//      SEALER'S OWN key, the checker accepts whatever that sealer signed —
//      including a hostile sealer's receipts. The check is only as meaningful
//      as the --pubkey argument: the verifying key must come from a source
//      the reader ALREADY trusts, not from the sealer and not from beside the
//      receipt. This program cannot tell a trusted key from an attacker's.
//
// Usage:
//   node seal-receipt-check.mjs RECEIPT.json --pubkey (HEX | FILE)
//
// Exit 0 and "ACCEPT ..." on a genuine receipt; non-zero and "REFUSE <code>:
// <reason>" on a semantically mutated or malformed one. It never prints
// "verified" as a bare adjective and it makes no claim beyond what it recomputed.

import { readFileSync } from "node:fs";
import { createHash, verify as edVerify, createPublicKey } from "node:crypto";

const DOMAIN = "seal.receipt-seal/v1\n";
const SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

function sha256Hex(text) {
  return createHash("sha256").update(Buffer.from(text, "utf8")).digest("hex");
}

// Canonical form (compact JSON, object keys sorted by UTF-8 bytes). This local
// implementation shares no module with Seal at runtime; see LIMITS #1 for its
// checked correspondence with the sealer and the intentional refusal gaps.
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

// The commitments identify fields, not source offsets.  When invoked as the
// command-line checker, retain the receipt text as well, so a direct scalar
// field commitment can point the reader at that field's line. A commitment to
// a structured value proves only that some part of that structure changed; it
// cannot justify naming any nested source line. This deliberately does not
// try to reconstruct an expected value from a digest.
function lineForDirectField(receiptText, field) {
  if (typeof receiptText !== "string") return null;
  let depth = 0;
  for (let i = 0; i < receiptText.length; i += 1) {
    if (receiptText[i] === "{") { depth += 1; continue; }
    if (receiptText[i] === "}") { depth -= 1; continue; }
    if (receiptText[i] !== "\"") continue;
    const start = i;
    for (i += 1; i < receiptText.length; i += 1) {
      if (receiptText[i] === "\\") { i += 1; continue; }
      if (receiptText[i] === "\"") break;
    }
    let after = i + 1;
    while (/\s/.test(receiptText[after])) after += 1;
    if (depth === 1 && receiptText[after] === ":" && JSON.parse(receiptText.slice(start, i + 1)) === field) {
      return receiptText.slice(0, start).split("\n").length;
    }
  }
  return null;
}

function shownValue(value) {
  const text = typeof value === "string" ? JSON.stringify(value) : canonical(value);
  return text.length <= 240 ? text : `${text.slice(0, 237)}...`;
}

function fieldMismatch(code, field, value, receiptText) {
  if (value !== null && typeof value === "object") {
    return new Refusal(code, `cannot identify one changed receipt line: the ${field} commitment covers a structured value, so it establishes that the value changed but not which nested line changed (committed value withheld)`);
  }
  const line = lineForDirectField(receiptText, field);
  const where = line === null ? `field ${field} (source line unavailable)` : `receipt line ${line}, field ${field}`;
  return new Refusal(code, `${where}: recorded value ${shownValue(value)} does not match its sealed commitment (committed value withheld)`);
}

// The check. Returns { accepted, checks } or throws Refusal. Order matters:
// the per-field commitments are checked first so a single-field mutation is
// named specifically; the signature is the unforgeable backstop that also
// catches any field a commitment does not cover (e.g. a repaired commitment).
export function checkReceipt(receipt, pubKeyHex, receiptText) {
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
    throw new Refusal("decision_binding_mismatch", fieldMismatch("decision_binding_mismatch", "decision", receipt.decision, receiptText).message);
  }
  // 2. tool commitment
  if (sha256Hex(String(receipt.tool)) !== seal.tool_sha256) {
    throw new Refusal("tool_binding_mismatch", fieldMismatch("tool_binding_mismatch", "tool", receipt.tool, receiptText).message);
  }
  // 3. arguments commitment
  if (sha256Hex(canonical(receipt.arguments)) !== seal.args_sha256) {
    throw new Refusal("arguments_binding_mismatch", fieldMismatch("arguments_binding_mismatch", "arguments", receipt.arguments, receiptText).message);
  }
  // 4. combined effect commitment (defence in depth)
  if (sha256Hex(canonical({ args: receipt.arguments, tool: receipt.tool })) !== seal.effect_sha256) {
    throw new Refusal("effect_binding_mismatch", fieldMismatch("effect_binding_mismatch", "tool and arguments", { tool: receipt.tool, arguments: receipt.arguments }, receiptText).message);
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
  if (!ok) throw new Refusal("signature_invalid", "cannot identify one changed receipt line: every direct field commitment matched, but the signature does not verify. The changed byte may be the signature or any signed field without a direct commitment.");

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
  let receiptText;
  try {
    receiptText = readFileSync(receiptPath, "utf8");
    receipt = JSON.parse(receiptText);
  } catch (error) {
    process.stdout.write(`REFUSE unreadable_receipt: ${error.message}\n`);
    process.exit(1);
  }
  try {
    const pubKeyHex = resolvePubkey(args[keyIndex + 1]);
    const result = checkReceipt(receipt, pubKeyHex, receiptText);
    process.stdout.write(`ACCEPT ${result.decision} ${result.tool} — decision, tool, arguments and signature all match the sealed commitments. This shows the receipt has the same canonical parsed value that this key signed. Semantically irrelevant JSON formatting differences are not distinguished. It does not show the decision happened: anyone who could use that machine's Seal key could have signed a different story.\n`);
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
