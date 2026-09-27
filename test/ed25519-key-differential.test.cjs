// SPDX-License-Identifier: Apache-2.0
"use strict";

// Differential: the receipt checker (checker/seal-receipt-v2.mjs) and the
// shipped kernel (runtime/kernel/wasm/seal.wasm, whose Ed25519 leaf is
// kernel-source/c/seal_ed25519.c) must accept and refuse the same verification
// keys. Each weak key carries a forged signature (R = identity, S = 0) over a
// message whose challenge scalar is a multiple of 8, so any small-order point
// annihilates it and a verifier without the key guard accepts the forgery.
// The WASM sees it through seal_init's signed-config check.

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { canonical, generateSigner, publicKeyHex, sealReceipt } = require("../spine/receipt-v2.cjs");
const { noncanonicalKeys, signedZeroXKeys, torsionKeys } = require("../test-support/ed25519-weak-keys.cjs");

const L = (1n << 252n) + 27742317777372353535851937790883648493n;
const IDENTITY = "01" + "00".repeat(31);
const FORGED_SIGNATURE = IDENTITY + "00".repeat(32);
const template = JSON.parse(fs.readFileSync(path.join(__dirname, "../docs/public/examples/protect-block.receipt.json")));

const littleEndian = (bytes) => BigInt("0x" + Buffer.from(bytes).reverse().toString("hex"));
function challenge(keyHex, message) {
  const digest = crypto.createHash("sha512")
    .update(Buffer.concat([Buffer.from(IDENTITY, "hex"), Buffer.from(keyHex, "hex"), Buffer.from(message, "utf8")]))
    .digest();
  return littleEndian(digest) % L;
}
function forge(keyHex, messageFor) {
  for (let i = 1; i < 4096; i++) {
    const message = messageFor(i);
    if (challenge(keyHex, message) % 8n === 0n) return message;
  }
  throw new Error(`no forgeable message for ${keyHex}`);
}

const configPayload = (epoch) => JSON.stringify({
  epoch, safety: { approval: { control_file: "X", ttl_seconds: 120 }, tools: [] }, temporal: { policies: [] },
});
const unsignedReceipt = (now) => { const body = { ...template, now }; delete body.signature; return body; };

let kernel;
async function wasmAccepts(keyHex, payload, signatureHex) {
  if (!kernel) {
    const SealModule = require("../runtime/kernel/wasm/seal.js");
    kernel = await SealModule({ print: () => {}, printErr: () => {} });
  }
  const envelope = JSON.stringify({ payload, signature: signatureHex });
  const out = JSON.parse(kernel.ccall("seal_init", "string", ["string", "string"], [envelope, keyHex]));
  return out.ok === true;
}
async function checkerVerdict(receipt, keyHex) {
  const verifier = await import("../checker/seal-receipt-v2.mjs");
  try {
    const result = await verifier.verify(JSON.stringify(receipt), { publicKeyHex: keyHex });
    return { accepted: result.signature === true, code: result.signature === true ? "accepted" : "signature_false" };
  } catch (error) {
    return { accepted: false, code: error.code };
  }
}
function opensslAccepts(keyHex, message, signatureHex) {
  try {
    const key = crypto.createPublicKey({ key: Buffer.from("302a300506032b6570032100" + keyHex, "hex"), format: "der", type: "spki" });
    return crypto.verify(null, Buffer.from(message, "utf8"), key, Buffer.from(signatureHex, "hex"));
  } catch {
    return false;
  }
}

const weak = [
  ...torsionKeys().map((key) => ({ key, code: "public_key_small_order" })),
  ...signedZeroXKeys().map((key) => ({ key, code: "public_key_small_order" })),
  ...noncanonicalKeys().map((key) => ({ key, code: "public_key_noncanonical" })),
];

test("checker and WASM refuse every weak Ed25519 key, forged signature included", async (t) => {
  assert.equal(new Set(weak.map((v) => v.key)).size, 48, "8 torsion + 2 signed x=0 + 38 noncanonical encodings");
  let live = 0;
  for (const { key, code } of weak) await t.test(key, async () => {
    const payload = forge(key, configPayload);
    const receiptBody = unsignedReceipt(0);
    const receiptMessage = forge(key, (now) => canonical(Object.assign(receiptBody, { now })));
    const receipt = { ...receiptBody, signature: { algorithm: "ed25519", value: FORGED_SIGNATURE } };
    assert.equal(canonical(receiptBody), receiptMessage);

    const js = await checkerVerdict(receipt, key);
    const wasm = await wasmAccepts(key, payload, FORGED_SIGNATURE);
    assert.equal(js.code, code);
    assert.equal(wasm, js.accepted, `checker ${js.code}, WASM ${wasm ? "accepted" : "refused"}`);
    if (opensslAccepts(key, payload, FORGED_SIGNATURE)) live++;
  });
  // The forgeries are live: without a key guard these keys verify them.
  assert.equal(live, 14, "OpenSSL accepts the forged config signature under every key reducing to a torsion point");
});

// RFC 8032 section 7.1, TEST 1.
const RFC8032_SEED = "9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60";
const RFC8032_PUBLIC = "d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a";

function controls() {
  const privateKey = crypto.createPrivateKey({ key: Buffer.from("302e020100300506032b657004220420" + RFC8032_SEED, "hex"), format: "der", type: "pkcs8" });
  const rfc = { privateKey, publicKeyHex: publicKeyHex(crypto.createPublicKey(privateKey)) };
  assert.equal(rfc.publicKeyHex, RFC8032_PUBLIC);
  let signed;
  do { signed = generateSigner(); } while (!(parseInt(signed.publicKeyHex.slice(-2), 16) & 128));
  let unsigned;
  do { unsigned = generateSigner(); } while (parseInt(unsigned.publicKeyHex.slice(-2), 16) & 128);
  return [["RFC 8032 TEST 1", rfc], ["x sign set", signed], ["x sign clear", unsigned]];
}

test("checker and WASM accept ordinary keys and agree on a bad signature", async (t) => {
  for (const [name, signer] of controls()) await t.test(name, async () => {
    const payload = configPayload(1);
    const configSignature = crypto.sign(null, Buffer.from(payload, "utf8"), signer.privateKey).toString("hex");
    const receipt = sealReceipt(signer, unsignedReceipt(template.now), template.action);

    const js = await checkerVerdict(receipt, signer.publicKeyHex);
    assert.equal(js.accepted, true, js.code);
    assert.equal(await wasmAccepts(signer.publicKeyHex, payload, configSignature), true);

    const flip = (hex) => (hex[0] === "0" ? "1" : "0") + hex.slice(1);
    const badReceipt = { ...receipt, signature: { ...receipt.signature, value: flip(receipt.signature.value) } };
    const badJs = await checkerVerdict(badReceipt, signer.publicKeyHex);
    const badWasm = await wasmAccepts(signer.publicKeyHex, payload, flip(configSignature));
    assert.equal(badJs.accepted, false);
    assert.equal(badWasm, badJs.accepted);
  });
});
