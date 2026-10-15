// SPDX-License-Identifier: Apache-2.0
// Test helper that emits the same v2 envelope as the product from a real
// invocation of the pinned authorization kernel.
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const { createKernelAuthorizationAdapter } = require("../contract/kernel-authorization.cjs");
const { policyPayloads } = require("../contract/signed-policy.cjs");
const { canonical, generateSigner, sealReceipt } = require("../spine/receipt-v2.cjs");

// Test setup signs outside the worker. Product Protect uses operator-signed
// bytes instead; no test key or signing fallback enters the shipped worker.
function keyPair() {
  const keys = crypto.generateKeyPairSync("ed25519");
  return {
    privateKey: keys.privateKey,
    publicKey: Buffer.from(keys.publicKey.export({ type: "spki", format: "der" })).subarray(-32).toString("hex"),
  };
}

function signedEnvelope(payload, privateKey) {
  return JSON.stringify({ payload, signature: crypto.sign(null, Buffer.from(payload, "utf8"), privateKey).toString("hex") });
}

function signedKernelPolicy(selections) {
  const keys = keyPair();
  const payloads = policyPayloads(selections);
  return {
    publicKey: keys.publicKey,
    guard: signedEnvelope(payloads.guard, keys.privateKey),
    forward: signedEnvelope(payloads.forward, keys.privateKey),
  };
}

function testKernelAdapter() {
  const keys = keyPair();
  return {
    authorize(input) {
      const forward = Array.isArray(input.forwardMatches);
      const tools = forward
        ? [
          ...input.forwardMatches.map((match) => ({ name: input.retryTool, mode: "guarded", match, target: [{ full_arguments: true }] })),
          { name: input.retryTool, mode: "allow", match: { type: "always" }, target: [] },
        ]
        : [{ name: input.retryTool, mode: "guarded", match: { type: "always" }, target: [{ full_arguments: true }] }];
      const payload = JSON.stringify({
        epoch: input.epoch,
        safety: { approval: { control_file: "product-adapter", ttl_seconds: 120 }, tools },
        temporal: { policies: [] },
      });
      const envelope = signedEnvelope(payload, keys.privateKey);
      return createKernelAuthorizationAdapter({ policy: { publicKey: keys.publicKey, guard: envelope, forward: envelope } }).authorize(input);
    },
  };
}

function protectArgsWithPolicy(args, directory) {
  if (args[0] !== "protect" || args.includes("--kernel-policy")) return args;
  const positional = [];
  for (let index = 1; index < args.length; index += 1) {
    if (args[index] === "--timeout-ms") { index += 1; continue; }
    if (args[index].startsWith("--")) return args;
    positional.push(args[index]);
  }
  if (positional.length < 2) return args;
  let policy;
  try { policy = signedKernelPolicy(positional.slice(1)); }
  catch { return args; }
  fs.mkdirSync(directory, { recursive: true });
  const file = path.join(directory, `kernel-policy-${crypto.randomBytes(8).toString("hex")}.json`);
  fs.writeFileSync(file, JSON.stringify({ guard: policy.guard, forward: policy.forward }), { mode: 0o600 });
  return ["protect", "--kernel-policy", file, "--kernel-pubkey", policy.publicKey, ...args.slice(1)];
}

async function writeKernelReceipt(_cacheRoot, dataHome) {
  const tool = "db.execute";
  const args = { database: "demo", sql: "drop table users" };
  const record = testKernelAdapter().authorize({
    epoch: 1,
    issuedTool: tool,
    issuedArgs: args,
    retryTool: tool,
    retryArgs: args,
    accepted: true,
    now: 1000,
  }).receipt_record;
  const receiptDir = path.join(dataHome, "seal", "receipts");
  fs.mkdirSync(receiptDir, { recursive: true, mode: 0o700 });
  const receipt = path.join(receiptDir, `receipt-${Date.now()}-${process.pid}-${crypto.randomBytes(4).toString("hex")}.json`);
  fs.writeFileSync(receipt, canonical(sealReceipt(generateSigner(), record, "ALLOW")), { mode: 0o600 });
  return receipt;
}

module.exports = { protectArgsWithPolicy, signedKernelPolicy, testKernelAdapter, writeKernelReceipt };
