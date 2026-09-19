// SPDX-License-Identifier: Apache-2.0
"use strict";
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const sha256 = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
// Frozen v2 encoding: JSON values; UTF-16 code-unit key order; ECMAScript
// finite binary64 number spelling; arrays retain order. All sibling keys stay.
// No candidate module is imported. This is the injectivity encoding ONLY.
function ordered(value) {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    assert.ok(Number.isFinite(value), "transcript: nonfinite JSON number");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return "[" + value.map(ordered).join(",") + "]";
  assert.ok(value && typeof value === "object", "transcript: non-JSON value");
  return "{" + Object.keys(value).sort().map(k => JSON.stringify(k) + ":" + ordered(value[k])).join(",") + "}";
}
const ENCODING = "seal-json-utf16-sorted-finite-binary64/v1";
function hop(bytes) { return {bytes, sha256: sha256(bytes === null ? "null" : bytes)}; }
function verifyTranscript(evidence, pack) {
  assert.equal(evidence.schema, "seal.authorization-correspondence/v2", "transcript:schema");
  assert.equal(evidence.encoding, ENCODING, "transcript:encoding");
  const rows = evidence.joined_transcript;
  assert.ok(Array.isArray(rows) && rows.length, "transcript:missing-rows");
  assert.equal(evidence.transcript_root_sha256, sha256(ordered(rows)), "transcript:root");
  assert.ok(Array.isArray(evidence.inbound_lines) && evidence.inbound_lines.length,
    "transcript:missing-harness-inventory");
  assert.ok(Array.isArray(evidence.child_lines), "transcript:missing-child-inventory");
  const inbound = new Set(), child = new Set(), targets = new Map();
  let guardedCount = 0, forwarded = 0, residual = 0;
  const covered = new Set();
  const guarded = f => f?.method === "tools/call" && pack.guardTools.includes(f.params?.name);
  for (const row of rows) {
    assert.equal(row.hops?.length, 8, "transcript:eight-hops");
    for (const h of row.hops) {
      assert.ok(h.bytes === null || typeof h.bytes === "string", "transcript:hop-bytes");
      assert.equal(h.sha256, hop(h.bytes).sha256, "transcript:hop-digest");
    }
    const bytes = row.hops.map(h => h.bytes);
    assert.ok(Number.isInteger(row.inbound_index) && row.inbound_index >= 0 &&
      row.inbound_index < evidence.inbound_lines.length, "transcript:orphan-child");
    assert.ok(!inbound.has(row.inbound_index), "transcript:duplicate-inbound");
    inbound.add(row.inbound_index);
    assert.equal(bytes[0], evidence.inbound_lines[row.inbound_index], "transcript:inbound-inventory");
    let frame;
    try { frame = JSON.parse(bytes[0]); } catch { frame = null; }
    const oracle = JSON.parse(bytes[2]);
    let observed = null;
    if (bytes[5] !== null) {
      assert.ok(Number.isInteger(row.child_index) && row.child_index >= 0 &&
        row.child_index < evidence.child_lines.length && !child.has(row.child_index),
        "transcript:child-inventory-index");
      child.add(row.child_index);
      assert.equal(bytes[5], evidence.child_lines[row.child_index], "transcript:child-inventory");
      observed = JSON.parse(bytes[5]);
    } else assert.equal(row.child_index, null, "transcript:absent-child-index");
    const received = observed?.method === "tools/call";
    if (received) {
      assert.deepEqual(JSON.parse(bytes[6]),
        {tool: observed.params.name, arguments: observed.params.arguments ?? {}}, "transcript:child-parsed");
      assert.equal(bytes[7], sha256(ordered(observed.params)), "transcript:full-params-digest");
    } else { assert.equal(bytes[6], null); assert.equal(bytes[7], null); }
    if (Array.isArray(frame) && frame.some(guarded)) {
      assert.notEqual(oracle.route, "passthrough", "transcript:guarded-batch");
      assert.equal(observed, null, "transcript:batch-forward");
    }
    if (bytes[4] === null) {
      assert.equal(bytes[3], null, "transcript:unanswered-kernel-input");
      assert.ok(["passthrough", "not-decided"].includes(oracle.route), "transcript:missing-kernel");
      assert.ok(!guarded(frame), "transcript:guarded-without-decision");
      assert.ok(!guarded(observed), "transcript:guarded-forward-without-decision");
      if (received) {
        assert.equal(row.residual, "residual:unguarded-forward", "transcript:unguarded-residual");
        residual++;
      }
      continue;
    }
    assert.equal(bytes[3], bytes[1], "transcript:kernel-wire-equality");
    const input = JSON.parse(JSON.parse(bytes[3]).line);
    if (guarded(frame)) assert.deepEqual(
      {tool:frame.params.name, arguments:frame.params.arguments ?? {}},
      {tool:input.params.name, arguments:input.params.arguments ?? {}}, "transcript:inbound-effect");
    const raw = JSON.parse(bytes[4]);
    const audit = JSON.parse(raw.audit);
    assert.equal(audit.tool, oracle.tool, "transcript:audit-tool");
    const safety = audit.certs.filter(c => c.kernel === "safety");
    assert.equal(safety.length, 1, "transcript:safety-certificate");
    assert.equal(safety[0].reason, oracle.target, "transcript:target");
    assert.equal(raw.route, oracle.route, "transcript:route");
    assert.deepEqual({tool:input.params.name, arguments:input.params.arguments ?? {}},
      {tool:oracle.tool, arguments:oracle.arguments}, "transcript:oracle-effect");
    assert.equal(received, raw.route === "forward", "transcript:route-iff");
    if (received) {
      assert.deepEqual(JSON.parse(bytes[6]), {tool:oracle.tool, arguments:oracle.arguments},
        "transcript:child-effect");
      const old = targets.get(oracle.target);
      if (old !== undefined) assert.equal(old, bytes[7], "transcript:injectivity");
      targets.set(oracle.target, bytes[7]);
      forwarded++;
    }
    if (guarded(input)) guardedCount++;
    if (row.corpus_id) covered.add(row.corpus_id);
  }
  assert.equal(inbound.size, evidence.inbound_lines.length, "transcript:inbound-coverage");
  assert.equal(child.size, evidence.child_lines.length, "transcript:child-coverage");
  assert.ok(guardedCount > 0 && forwarded > 0, "transcript:positive-control");
  assert.ok(residual > 0, "transcript:missing-unguarded-residual");
  assert.ok(Array.isArray(evidence.required_corpus_ids) && evidence.required_corpus_ids.length,
    "transcript:missing-corpus-inventory");
  for (const id of evidence.required_corpus_ids) assert.ok(covered.has(id), `transcript:corpus:${id}`);
  const table = [...targets].map(([target, params_sha256]) => ({target, params_sha256}));
  assert.deepEqual(evidence.injectivity_table, table, "transcript:injectivity-table");
  // Witness that siblings are retained: this encoding is finer than a target
  // projection which excludes _meta, independent of the candidate encoder.
  assert.notEqual(sha256(ordered({name:"t",arguments:{}})),
    sha256(ordered({name:"t",arguments:{},_meta:{x:1}})), "transcript:finer-encoding");
  return {rows:rows.length, guarded:guardedCount, forwarded, residual};
}
module.exports = {ordered, sha256, hop, ENCODING, verifyTranscript};
