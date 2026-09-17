// SPDX-License-Identifier: Apache-2.0
const assert = require("node:assert/strict");
const test = require("node:test");
const { createApprovalContract } = require("../contract/contract.cjs");
const { canonicalString } = require("../contract/canonical.cjs");
const { createKernelAuthorizationAdapter } = require("../contract/kernel-authorization.cjs");
const { generateSigner, sealReceipt, canonical } = require("../spine/receipt-v2.cjs");
const runner = require("../runtime/kernel/runner.cjs");
const vectors = require("../test-support/json-argument-vectors.cjs");

const TOOL = "write";
const ACCEPT = { approval: { action: "accept", content: { approve: true } } };
const CONFIG = { epoch: 1, safety: { approval: { control_file: "test", ttl_seconds: 120 },
  tools: [{ name: TOOL, mode: "guarded", match: { type: "always" }, target: [{ full_arguments: true }] }] },
  temporal: { policies: [] } };

test("decimal values survive canonicalization without rounding or string coercion", () => {
  for (const { name, args } of vectors) assert.deepEqual(JSON.parse(canonicalString(args)), args, name);
  assert.notEqual(canonicalString({ value: 0.3 }), canonicalString({ value: 0.1 + 0.2 }));
  assert.notEqual(canonicalString({ value: 1.5 }), canonicalString({ value: "1.5" }));
  assert.equal(canonicalString({ value: -0 }), canonicalString({ value: 0 }));
  for (const value of [NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1, -Number.MAX_SAFE_INTEGER - 1]) {
    assert.throws(() => canonicalString({ nested: [value] }));
  }
});

test("real approval and independent signed-receipt replay accept practical JSON values", async () => {
  const { verify } = await import("../checker/seal-receipt-v2.mjs");
  const signer = generateSigner();
  for (const { name, args } of vectors) {
    const contract = createApprovalContract();
    const pending = contract.begin({ tool: TOOL, args });
    assert.equal(pending.kind, "input_required", `${name}: ${JSON.stringify(pending)}`);
    const request = { tool: TOOL, args, requestState: pending.result.requestState, inputResponses: ACCEPT };
    const decision = contract.retry(request);
    assert.equal(decision.kind, "allow", `${name}: ${JSON.stringify(decision)}`);
    assert.deepEqual(decision.receipt.arguments, args, name);
    const receipt = sealReceipt(signer, decision.receipt, "ALLOW");
    const checked = await verify(canonical(receipt), { publicKeyHex: signer.publicKeyHex });
    assert.equal(checked.signature, true, name);
    assert.equal(checked.replay, true, name);
    assert.deepEqual(checked.receipt.arguments, args, name);
    assert.equal(contract.retry(request).refusal, "already_consumed", name);
    const changed = structuredClone(receipt);
    changed.arguments = { ...args, changed: true };
    await assert.rejects(() => verify(JSON.stringify(changed), { publicKeyHex: signer.publicKeyHex }),
      (error) => error.code === "commitment_mismatch", name);
  }
});

test("decimal changes and string substitution do not inherit an approval", () => {
  const adapter = createKernelAuthorizationAdapter();
  for (const [issuedArgs, retryArgs] of [
    [{ amount: 12.5 }, { amount: 12.6 }],
    [{ amount: 1.5 }, { amount: "1.5" }],
    [{ value: 0.3 }, { value: 0.1 + 0.2 }],
    [{ rate: Number.MIN_VALUE }, { rate: 0 }],
    [{ text: "a\tb" }, { text: "a\\tb" }],
  ]) {
    const result = adapter.authorize({ epoch: 1, issuedTool: TOOL, retryTool: TOOL,
      issuedArgs, retryArgs, accepted: true, now: 1000 });
    assert.equal(result.verdict, "BLOCK", JSON.stringify({ issuedArgs, retryArgs }));
  }
  assert.equal(adapter.authorize({ epoch: 1, issuedTool: TOOL, retryTool: TOOL,
    issuedArgs: { amount: 12.5 }, retryArgs: { amount: 12.5 }, accepted: false, now: 1000 }).verdict, "BLOCK");
});

test("target encoding agrees with actual WASM across number and string boundaries", async () => {
  const { M, cfg } = await runner.load();
  await runner.decide(CONFIG, { tool: TOOL, args: {}, approvals: [] });
  const argumentsToCheck = vectors.map(({ args }) => args);
  for (let code = 0; code < 32; code++) argumentsToCheck.push({ text: `a${String.fromCharCode(code)}b` });
  for (const number of [0, -0, 1, -1, Number.MAX_SAFE_INTEGER, -Number.MAX_SAFE_INTEGER,
    1e-9, 1e-10, 1e-11, -1e-11, 1e-308, 1e-323, 1.0000000000000002]) argumentsToCheck.push({ number });
  // Fixed seed: varied binary64 mantissas/scales without nondeterministic tests.
  let seed = 12345;
  for (let i = 0; i < 64; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    argumentsToCheck.push({ number: (seed / 4294967296) * 10 ** (-i * 5), nested: [i + 0.5] });
  }
  for (const args of argumentsToCheck) {
    const target = cfg.guardTarget(TOOL, args);
    const step = cfg.buildStepInput({ tool: TOOL, args, approvals: [target], now: 1000 });
    assert.deepEqual(JSON.parse(JSON.parse(step).line).params.arguments, JSON.parse(JSON.stringify(args)));
    const raw = JSON.parse(M.ccall("seal_decide", "string", ["string"], [step]));
    assert.equal(raw.route, "forward", `${JSON.stringify(args)}: ${JSON.stringify(raw)}`);
    assert.equal(JSON.parse(raw.audit).certs.find((cert) => cert.kernel === "safety").reason, target);
  }
});
