// SPDX-License-Identifier: Apache-2.0
// Conformance vectors are executable negative controls: each goes RED, then
// the same envelope repaired goes GREEN. The vectors exercise the v2 verifier.
import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { test } from "node:test";
import { canonical, format, read, sha256, verify } from "../checker/seal-receipt-v2.mjs";
import { validateReceipt } from "../runtime/kernel/receipt-format.js";
import { CFG_STANDARD, guardTarget } from "../runtime/kernel/seal-config.js";

const cfg = { epoch: 1, safety: { approval: { control_file: "X", ttl_seconds: 120 }, tools: [{ name: "db.execute", mode: "guarded", match: { type: "contains_any_ci", arg: "sql", needles: ["drop"] }, target: [{ full_arguments: true }] }] }, temporal: { policies: [] } };
const keys = generateKeyPairSync("ed25519");
const pub = Buffer.from(keys.publicKey.export({ type: "spki", format: "der" })).subarray(-32).toString("hex");

function envelope(verdict = "BLOCK", action) {
  const r = { seal_receipt: "v2", tool: "db.execute" };
  if (action !== undefined) r.action = action;
  Object.assign(r, { arguments: { database: "prod", sql: "drop table users" }, now: 1000, kernel_config: cfg, granted_capabilities: [], kernel_inputs: { approvals: [], votes: "", grants: "", forecasts: "" }, verdict, reason: "safety kernel denied", replay: { args_sha256: "", config_sha256: "" } });
  r.replay.args_sha256 = sha256(canonical(r.arguments));
  r.replay.config_sha256 = sha256(canonical(r.kernel_config));
  r.signature = { algorithm: "ed25519", value: sign(null, Buffer.from(canonical(r)), keys.privateKey).toString("hex") };
  return r;
}
const text = (r) => JSON.stringify(r);
function resign(r) {
  const unsigned = { ...r }; delete unsigned.signature;
  return { ...unsigned, signature: { algorithm: "ed25519", value: sign(null, Buffer.from(canonical(unsigned)), keys.privateKey).toString("hex") } };
}
const expectRed = async (label, input, code) => { await assert.rejects(() => verify(input, { publicKeyHex: pub }), (e) => e.code === code, label); };

function approvalIdentityReceipt(approvalIdentity) {
  return {
    seal_receipt: "v2", tool: "db.execute", arguments: {}, now: 0,
    canonical_request_sha256: "0".repeat(64), bypass: false, verdict: "ALLOW",
    reason: "approval control", kernel_identity: { wasm_sha256: "0".repeat(64), self_verified: false },
    kernel_config: {}, certs: [], emitted_bytes: "", granted_capabilities: [], deny_kernel: null,
    args_hash: sha256(canonical({})), authorization: "approval",
    approval: {
      approval_identity: approvalIdentity, nonce: "control", issued_at: 0, expiry: 1,
      policy_hash: sha256(canonical({})),
    },
  };
}

test("v2 positive signed receipt and all five rows", async () => {
  const out = await verify(text(envelope()), { publicKeyHex: pub });
  assert.equal(out.verify, false, "signature without occurrence is not VERIFY");
  assert.equal(out.authority, "UNPINNED / CALLER-SUPPLIED");
  assert.equal(out.occurrence, "NOT ESTABLISHED");
  assert.match(format(out), /Document structure       VALID/);
  assert.match(format(out), /Signature and bindings   VALID/);
  assert.match(format(out), /Kernel decision          REPRODUCED/);
  assert.match(format(out), /Authority key            UNPINNED \/ CALLER-SUPPLIED/);
  assert.match(format(out), /Event occurrence         NOT ESTABLISHED/);
  assert.match(format(out), /VERIFY    UNVERIFIED/);
});

test("ALLOW action refuses when replayed verdict is not ALLOW, while pending approval remains valid", async () => {
  const blockedResult = resign(envelope("BLOCK", "ALLOW"));
  await assert.rejects(
    () => verify(text(blockedResult), { publicKeyHex: pub }),
    (error) => error.code === "action_verdict_mismatch"
      && error.message === "signed action ALLOW requires replayed verdict ALLOW",
  );

  const pendingResult = await verify(text(resign(envelope("BLOCK", "INPUT_REQUIRED"))), { publicKeyHex: pub });
  assert.equal(pendingResult.replay, true);
  assert.equal(pendingResult.receipt.action, "INPUT_REQUIRED");
  assert.equal(pendingResult.receipt.verdict, "BLOCK");
});

test("unchecked trust inputs are refused rather than counted as evidence", async () => {
  await assert.rejects(
    () => verify(text(envelope()), { publicKeyHex: pub, authorityRoot: "the wombat certified this" }),
    (e) => e.code === "invalid_receipt" && /authority roots cannot be checked/.test(e.message),
  );
  await assert.rejects(
    () => verify(text(envelope()), { publicKeyHex: pub, occurrenceWitness: "a pineapple saw it happen" }),
    (e) => e.code === "invalid_receipt" && /occurrence witnesses cannot be checked/.test(e.message),
  );
});

test("authority row varies with what the verifier actually checked", async () => {
  const withoutKey = await verify(text(envelope()));
  const withCheckedCallerKey = await verify(text(envelope()), { publicKeyHex: pub });
  assert.equal(withoutKey.authority, "NOT ESTABLISHED");
  assert.equal(withCheckedCallerKey.authority, "UNPINNED / CALLER-SUPPLIED");
  assert.match(format(withoutKey), /Authority key            NOT ESTABLISHED/);
  assert.match(format(withCheckedCallerKey), /Authority key            UNPINNED \/ CALLER-SUPPLIED/);
  assert.equal(withoutKey.verify, false);
  assert.equal(withCheckedCallerKey.verify, false);
});

test("removed signature key_id and approval identity controls refuse as specified", async () => {
  const good = envelope();
  const withRemovedMember = { ...good, signature: { ...good.signature, key_id: "phase-a-test" } };
  await assert.rejects(
    () => verify(text(withRemovedMember), { publicKeyHex: pub }),
    (error) => error.code === "unexpected_member" && error.message === "signature.key_id: unexpected member",
  );
  console.log("CONTROL signature.key_id present: REFUSE unexpected_member: signature.key_id: unexpected member");
  const verified = await verify(text(good), { publicKeyHex: pub });
  assert.equal(verified.signature, true);
  console.log("CONTROL signature.key_id absent: GREEN signature valid");

  const withTwoRemovedMembers = { ...good, signature: { ...good.signature, key_id: "phase-a-test", legacy: true } };
  await assert.rejects(
    () => verify(text(withTwoRemovedMembers), { publicKeyHex: pub }),
    (error) => error.code === "unexpected_member" && error.message === "signature: exactly the members algorithm,value required; unexpected members: key_id,legacy",
  );
  console.log("CONTROL signature.key_id and legacy present: REFUSE unexpected_member: signature: exactly the members algorithm,value required; unexpected members: key_id,legacy");

  const missingEd25519KeyId = validateReceipt(approvalIdentityReceipt({ channel: "ed25519" }));
  assert.equal(missingEd25519KeyId.ok, false);
  assert.ok(missingEd25519KeyId.errors.includes("approval.approval_identity.key_id: required on the ed25519 channel"));
  console.log("CONTROL approval ed25519 key_id absent: REFUSE approval.approval_identity.key_id: required on the ed25519 channel");
  const interactiveWithKeyId = validateReceipt(approvalIdentityReceipt({ channel: "interactive", key_id: "control" }));
  assert.equal(interactiveWithKeyId.ok, false);
  assert.ok(interactiveWithKeyId.errors.includes("approval.approval_identity.key_id: only the ed25519 channel carries a key_id"));
  console.log("CONTROL approval interactive key_id present: REFUSE approval.approval_identity.key_id: only the ed25519 channel carries a key_id");
});

test("negative controls each go RED and the repaired envelope goes GREEN", async () => {
  const good = envelope();
  const vectors = [
    ["duplicate member", `{"seal_receipt":"v2","seal_receipt":"v2",${text(good).slice(text(good).indexOf("\"tool\""))}`, "duplicate_member"],
    ["commitment mismatch", text({ ...good, replay: { ...good.replay, args_sha256: "0".repeat(64) } }), "commitment_mismatch"],
    ["signature mismatch", text({ ...good, signature: { ...good.signature, value: "0".repeat(128) } }), "signature_mismatch"],
    ["reordered member", JSON.stringify(Object.fromEntries(Object.entries(good).reverse())), "member_order"],
    ["truncated envelope", text(good).slice(0, -4), "read_failed"],
    ["recorded verdict mismatch", text(envelope("ALLOW")), "verdict_mismatch"],
  ];
  for (const [label, bad, code] of vectors) {
    await expectRed(label, bad, code);
    const repaired = await verify(text(good), { publicKeyHex: pub });
    assert.equal(repaired.replay, true, `${label}: repaired envelope GREEN`);
    console.log(`VECTOR ${label}: RED (${code}) -> GREEN`);
  }
});

test("unsigned receipt still replays, and a valid signature without a key is not VERIFY", async () => {
  const unsigned = { ...envelope() }; delete unsigned.signature;
  const replayed = await verify(text(unsigned));
  assert.equal(replayed.replay, true);
  assert.equal(replayed.verify, false);
  const noKey = await verify(text(envelope()));
  assert.equal(noKey.signature, false);
  assert.equal(noKey.verify, false);
  console.log("UNSIGNED REPLAY: available");
  console.log(format(noKey));
});

test("every recorded input channel is consumed or refuses tampering", async () => {
  const args = { amount: 40000, to: "supplier-77" };
  const target = guardTarget("payments.send", args);
  const quorum = '{"acceptor":1,"value":"payments.send"}\n{"acceptor":2,"value":"payments.send"}\n';
  const base = { seal_receipt: "v2", tool: "payments.send", arguments: args, now: 1000,
    kernel_config: CFG_STANDARD, granted_capabilities: [{ target }],
    kernel_inputs: { approvals: [target], votes: quorum, grants: "", forecasts: "" },
    verdict: "ALLOW", reason: "consensus satisfied", replay: { args_sha256: sha256(canonical(args)), config_sha256: sha256(canonical(CFG_STANDARD)) } };
  assert.equal((await verify(text(resign(base)))).replay, true);
  const cases = [
    ["votes", { ...base, kernel_inputs: { ...base.kernel_inputs, votes: "" } }, "verdict_mismatch"],
    ["grants", { ...base, kernel_inputs: { ...base.kernel_inputs, grants: "tampered" } }, "inert_input"],
    ["forecasts", { ...base, kernel_inputs: { ...base.kernel_inputs, forecasts: "tampered" } }, "inert_input"],
    ["granted_capabilities", { ...base, granted_capabilities: [{ target: "0".repeat(64) }] }, "input_mismatch"],
  ];
  for (const [channel, altered, code] of cases) {
    await expectRed(channel, text(resign(altered)), code);
    console.log(`CHANNEL ${channel}: REFUSE (${code})`);
  }
  console.log("CHANNEL approvals: consumed by decision input");
});

test("optional approval handle identity is checked without rejecting earlier v2 receipts", async () => {
  const earlier = envelope();
  assert.equal((await verify(text(earlier), { publicKeyHex: pub })).replay, true);

  const identified = resign({
    ...earlier,
    kernel_inputs: { ...earlier.kernel_inputs, approval_handle_sha256: "a".repeat(64) },
  });
  assert.equal((await verify(text(identified), { publicKeyHex: pub })).replay, true);

  const malformed = resign({
    ...earlier,
    kernel_inputs: { ...earlier.kernel_inputs, approval_handle_sha256: "not-a-sha256" },
  });
  await expectRed("malformed approval handle identity", text(malformed), "invalid_receipt");
});

test("duplicates are rejected at every depth after name unescaping", async () => {
  const good = text(envelope());
  const nested = good.replace('"arguments":{"database":"prod","sql":"drop table users"}',
    '"arguments":{"database":"prod","nested":{"x":1,"x":2},"sql":"drop table users"}');
  const escaped = good.replace('"arguments":{"database":"prod","sql":"drop table users"}',
    '"arguments":{"database":"prod","\\u0064atabase":"prod","sql":"drop table users"}');
  for (const [label, bad] of [["nested", nested], ["escaped-name", escaped]]) {
    assert.throws(() => read(bad), (e) => e.code === "duplicate_member");
    assert.doesNotThrow(() => read(good));
    console.log(`VECTOR ${label} duplicate: RED (duplicate_member) -> GREEN`);
  }
});

test("number token and parsed-value controls match the specification", () => {
  for (const token of ["1000.0", "1e3"]) {
    const parsed = read(`{"now":${token}}`);
    assert.equal(parsed.now, 1000);
    console.log(`NUMBER ${token}: READ GREEN -> parsed 1000`);
  }
  assert.doesNotThrow(() => read('{"now":1.5}'));
  assert.throws(() => canonical({ now: 1.5 }), (e) => e.code === "number_not_canonical");
  console.log("NUMBER 1.5: READ GREEN -> canonical REFUSE (number_not_canonical)");
});

test("Unicode boundary controls match the specification", () => {
  assert.equal(canonical("\ud800"), '"\\ud800"');
  assert.throws(() => read(new Uint8Array([0x7b, 0x22, 0x78, 0x22, 0x3a, 0xc3, 0x28, 0x7d])), (e) => e.code === "read_failed");
  console.log('SURROGATE emission: GREEN ("\\ud800")');
  console.log("ILL-FORMED UTF-8 receive: REFUSE (read_failed)");
});
