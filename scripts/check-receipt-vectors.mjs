#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Thin runner for captured receipt facts. Canonicalisation, hashing, validation,
// signing and replay stay in the existing product modules; this file contains
// no replacement receipt-format implementation.
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const vectorPath = path.join(scriptRoot, "conformance", "receipt-vectors", "producer-baseline-610bf01d.json");
const vector = JSON.parse(fs.readFileSync(vectorPath, "utf8"));
const require = createRequire(import.meta.url);
const spineSeal = require(path.join(scriptRoot, "spine", "receipt-seal.cjs"));
const kernelRunner = require(path.join(scriptRoot, "runtime", "kernel", "runner.cjs"));
const kernelFormat = await import(pathToFileURL(path.join(scriptRoot, "runtime", "kernel", "receipt-format.js")));

function same(label, actual, expected) {
  if (actual !== expected) {
    throw new Error(`FAIL ${label}\nexpected: ${JSON.stringify(expected)}\nactual:   ${JSON.stringify(actual)}`);
  }
}

function sha256(text) {
  return crypto.createHash("sha256").update(Buffer.from(text, "utf8")).digest("hex");
}

function checkSpine() {
  const { body, expected } = vector.spine;
  const unsigned = structuredClone(body);
  delete unsigned.seal.sig;
  const canonical = spineSeal.canonical(unsigned);
  const preimage = `seal.receipt-seal/v1\n${canonical}`;

  same("Spine canonical bytes", canonical, expected.canonical_body_without_signature_utf8);
  same("Spine canonical hex", Buffer.from(canonical).toString("hex"), expected.canonical_body_without_signature_hex);
  same("Spine signature preimage", preimage, expected.signature_preimage_utf8);
  same("Spine signature preimage hex", Buffer.from(preimage).toString("hex"), expected.signature_preimage_hex);
  same("Spine decision commitment", sha256(String(body.decision)), expected.commitments.decision_sha256);
  same("Spine tool commitment", sha256(String(body.tool)), expected.commitments.tool_sha256);
  same("Spine arguments commitment", sha256(spineSeal.canonical(body.arguments)), expected.commitments.args_sha256);
  same("Spine effect commitment", sha256(spineSeal.canonical({ args: body.arguments, tool: body.tool })), expected.commitments.effect_sha256);
  same("Spine captured signature", body.seal.sig, expected.signature_hex);

  const spki = Buffer.concat([
    Buffer.from("302a300506032b6570032100", "hex"),
    Buffer.from(vector.spine.public_key_hex, "hex"),
  ]);
  const publicKey = crypto.createPublicKey({ key: spki, type: "spki", format: "der" });
  assert.equal(crypto.verify(null, Buffer.from(preimage), publicKey, Buffer.from(body.seal.sig, "hex")), true,
    "captured Spine signature must match its out-of-band key");

  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "seal-receipt-vector-check-"));
  try {
    const receiptPath = path.join(scratch, "receipt.json");
    fs.writeFileSync(receiptPath, JSON.stringify(body, null, 2) + "\n");
    const checked = spawnSync(process.execPath, [
      path.join(scriptRoot, "checker", "seal-receipt-check.mjs"), receiptPath,
      "--pubkey", vector.spine.public_key_hex,
    ], { encoding: "utf8", cwd: scriptRoot });
    same("Spine checker exit", checked.status, expected.checker.exit_code);
    same("Spine checker output", checked.stdout.trim(), expected.checker.stdout);
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }

  same("Spine signature row", expected.ruled_rows.signature, "MATCH");
  same("Spine replay ceiling", expected.ruled_rows.kernel_decision_replay, "NOT CHECKED");
  same("Spine authority ceiling", expected.ruled_rows.authority_key, "UNPINNED");
  same("Spine occurrence ceiling", expected.ruled_rows.event_occurrence, "NOT ESTABLISHED");
  console.log("PASS Spine captured body, canonical bytes, commitments, signature preimage and checker outcomes");
}

async function checkKernel() {
  const { input, body, expected } = vector.kernel;
  const validation = kernelFormat.validateReceiptDocument(JSON.stringify(body, null, 2) + "\n");
  assert.deepEqual({ ok: validation.ok, version: validation.version, errors: validation.errors },
    { ok: true, version: "v2", errors: [] });
  same("kernel arguments hash input", JSON.stringify(input.call.args), expected.request_and_hash_inputs.arguments_json_utf8);
  same("kernel request input", kernelFormat.canonicalRequest(input.call.tool, input.call.args), expected.request_and_hash_inputs.canonical_request_utf8);
  same("kernel config hash input", JSON.stringify(input.config), expected.request_and_hash_inputs.kernel_config_json_utf8);
  same("kernel arguments hash", kernelFormat.canonicalJsonSha256(input.call.args), expected.hashes.args_hash);
  same("kernel request hash", kernelFormat.canonicalRequestSha256(input.call.tool, input.call.args), expected.hashes.canonical_request_sha256);
  same("kernel policy hash", kernelFormat.canonicalJsonSha256(input.config), expected.hashes.approval_policy_hash);

  const replay = await kernelRunner.decide(input.config, input.call);
  same("kernel replay verdict", replay.verdict, body.verdict);
  same("kernel replay raw bytes", replay.raw, expected.raw_emitted_bytes);
  assert.deepEqual(replay.receipt, body, "kernel producer must reproduce the captured receipt body");
  assert.equal("signature" in body, false, "current kernel v2 receipt must remain unsigned in this baseline");
  same("kernel structure row", expected.outcomes.document_structure, "VALID");
  same("kernel signature ceiling", expected.outcomes.signature, "NOT CHECKED");
  same("kernel replay row", expected.outcomes.kernel_decision_replay, "REPRODUCED");
  same("kernel authority ceiling", expected.outcomes.authority_key, "NOT CHECKED");
  same("kernel occurrence ceiling", expected.outcomes.event_occurrence, "NOT ESTABLISHED");
  console.log("PASS kernel captured body, request/hash inputs, replay inputs and outcomes");
}

function checkDistinguishing() {
  const { body, expected } = vector.distinguishing;
  const spineCanonical = spineSeal.canonical(body);
  const spinePreimage = Buffer.from(`seal.receipt-seal/v1\n${spineCanonical}`);
  const kernelPreimage = Buffer.from(kernelFormat.receiptSignaturePreimage(body));
  const kernelUnsigned = JSON.stringify(body);
  same("distinguishing Spine canonical bytes", spineCanonical, expected.spine_canonical_utf8);
  same("distinguishing Spine preimage", spinePreimage.toString("hex"), expected.spine_signature_preimage_hex);
  same("distinguishing kernel unsigned bytes", kernelUnsigned, expected.kernel_unsigned_json_utf8);
  same("distinguishing kernel preimage", kernelPreimage.toString("hex"), expected.kernel_signature_preimage_hex);
  assert.notEqual(spinePreimage.toString("hex"), kernelPreimage.toString("hex"));
  console.log(`DISTINGUISHING_INPUT=${JSON.stringify(body)}`);
  console.log(`SPINE_CANONICAL=${spineCanonical}`);
  console.log(`SPINE_PREIMAGE_HEX=${spinePreimage.toString("hex")}`);
  console.log(`KERNEL_UNSIGNED=${kernelUnsigned}`);
  console.log(`KERNEL_PREIMAGE_HEX=${kernelPreimage.toString("hex")}`);
  console.log("PASS distinguishing vector proves the current canonicalisation rules disagree");
}

try {
  checkSpine();
  await checkKernel();
  checkDistinguishing();
  console.log(`PASS receipt conformance vectors (${vector.vector_set})`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
