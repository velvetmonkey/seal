// SPDX-License-Identifier: Apache-2.0
// Conformance vectors are executable negative controls: each goes RED, then
// the same envelope repaired goes GREEN.
import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { test } from "node:test";
import { canonical, format, sha256, verify } from "../checker/seal-receipt-v2.mjs";

const cfg = { epoch: 1, safety: { approval: { control_file: "X", ttl_seconds: 120 }, tools: [{ name: "db.execute", mode: "guarded", match: { type: "contains_any_ci", arg: "sql", needles: ["drop"] }, target: [{ full_arguments: true }] }] }, temporal: { policies: [] } };
const keys = generateKeyPairSync("ed25519");
const pub = Buffer.from(keys.publicKey.export({ type: "spki", format: "der" })).subarray(-32).toString("hex");

function envelope(verdict = "BLOCK") {
  const r = { seal_receipt: "v2", tool: "db.execute", arguments: { database: "prod", sql: "drop table users" }, now: 1000, kernel_config: cfg, granted_capabilities: [], kernel_inputs: { approvals: [], votes: "", grants: "", forecasts: "" }, verdict, reason: "safety kernel denied", replay: { args_sha256: "", config_sha256: "" } };
  r.replay.args_sha256 = sha256(canonical(r.arguments));
  r.replay.config_sha256 = sha256(canonical(r.kernel_config));
  r.signature = { algorithm: "ed25519", key_id: "phase-a-test", value: sign(null, Buffer.from(canonical(r)), keys.privateKey).toString("hex") };
  return r;
}
const text = (r) => JSON.stringify(r);
const expectRed = async (label, input, code) => { await assert.rejects(() => verify(input, { publicKeyHex: pub }), (e) => e.code === code, label); };

test("v2 positive signed receipt and all five rows", async () => {
  const out = await verify(text(envelope()), { publicKeyHex: pub });
  assert.equal(out.verify, false, "signature without occurrence is not VERIFY");
  assert.match(format(out), /Document structure       VALID/);
  assert.match(format(out), /Signature and bindings   VALID/);
  assert.match(format(out), /Kernel decision          REPRODUCED/);
  assert.match(format(out), /Authority key            UNPINNED \/ CALLER-SUPPLIED/);
  assert.match(format(out), /Event occurrence         NOT ESTABLISHED/);
  assert.match(format(out), /VERIFY    UNVERIFIED/);
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
