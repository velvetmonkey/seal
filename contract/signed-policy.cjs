// SPDX-License-Identifier: Apache-2.0
// Describe the two protect-time policies. This module never creates or reads a
// private key. The operator signs these exact payload bytes outside Seal.
const crypto = require("node:crypto");
const { kernelMatchFor, normalizeToolSelection } = require("../spine/tool-selection.cjs");

const guarded = (name, match) => ({ name, mode: "guarded", match, target: [{ full_arguments: true }] });
const base = (tools) => ({
  epoch: 1,
  safety: { approval: { control_file: "product-adapter", ttl_seconds: 120 }, tools },
  temporal: { policies: [] },
});

function policyPayloads(selections) {
  const normalized = selections.map(normalizeToolSelection);
  if (normalized.length === 0 || normalized.some((selection) => !selection.ok)) {
    throw new Error("a valid protected tool selection is required");
  }
  const names = [...new Set(normalized.map((selection) => selection.name))];
  const effective = names.flatMap((name) => {
    const forName = normalized.filter((selection) => selection.name === name);
    return forName.some((selection) => selection.predicate === null)
      ? [forName.find((selection) => selection.predicate === null)]
      : forName;
  });
  const guard = base(names.map((name) => guarded(name, { type: "always" })));
  const forward = base(names.flatMap((name) => [
    ...effective.filter((selection) => selection.name === name)
      .map(kernelMatchFor).filter(Boolean).map((match) => guarded(name, match)),
    { name, mode: "allow", match: { type: "always" }, target: [] },
  ]));
  return { guard: JSON.stringify(guard), forward: JSON.stringify(forward) };
}

function verifyEnvelope(envelopeText, publicKey, expectedPayload) {
  if (!/^[0-9a-f]{64}$/.test(publicKey || "")) throw new Error("kernel config public-key pin is absent or invalid");
  let envelope;
  try { envelope = JSON.parse(envelopeText); } catch { throw new Error("kernel config envelope is invalid JSON"); }
  if (!envelope || typeof envelope.payload !== "string" || !/^[0-9a-f]{128}$/.test(envelope.signature || "")) {
    throw new Error("kernel config envelope has no valid payload and signature");
  }
  if (envelope.payload !== expectedPayload) throw new Error("kernel config payload does not match the protect-time tool policy");
  const key = crypto.createPublicKey({
    key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), Buffer.from(publicKey, "hex")]),
    format: "der", type: "spki",
  });
  if (!crypto.verify(null, Buffer.from(envelope.payload, "utf8"), key, Buffer.from(envelope.signature, "hex"))) {
    throw new Error("kernel config signature does not match the public-key pin");
  }
}

function validatePolicy(policy, selections) {
  if (!policy || typeof policy !== "object") throw new Error("kernel config public-key pin is absent");
  const expected = policyPayloads(selections);
  verifyEnvelope(policy.guard, policy.publicKey, expected.guard);
  verifyEnvelope(policy.forward, policy.publicKey, expected.forward);
  return policy;
}

module.exports = { policyPayloads, validatePolicy };
