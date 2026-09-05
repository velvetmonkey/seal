// SPDX-License-Identifier: Apache-2.0

import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const EVIDENCE_DOMAIN = "seal.ci-receipt-check-evidence/v1\n";

function sha256(...parts) {
  const hash = createHash("sha256");
  for (const part of parts) hash.update(part);
  return hash.digest("hex");
}

function refuse(message) {
  process.stderr.write(`receipt evidence error: ${message}\n`);
  process.exit(2);
}

function parseJson(bytes, label) {
  try {
    return JSON.parse(bytes);
  } catch (error) {
    refuse(`${label} is not JSON: ${error.message}`);
  }
}

function readJsonFile(path, label) {
  try {
    return parseJson(readFileSync(path, "utf8"), label);
  } catch (error) {
    refuse(`${label} is missing or unreadable: ${error.message}`);
  }
}

function evidenceDigest(record) {
  return sha256(
    EVIDENCE_DOMAIN,
    record.challenge,
    "\n",
    record.outcome,
    "\n",
    record.code,
    "\n",
    record.input_sha256,
    "\n",
    record.signed_identity_sha256,
    "\n",
  );
}

function signedIdentity(receipt) {
  if (!receipt.signature || typeof receipt.signature !== "object") return sha256("unsigned");
  return sha256(JSON.stringify(receipt.signature));
}

async function check([checkerPath, receiptPath, pubkeyPath, challenge, resultPath]) {
  if (!checkerPath || !receiptPath || !pubkeyPath || !challenge || !resultPath) {
    refuse("check requires CHECKER RECEIPT PUBKEY CHALLENGE RESULT");
  }
  if (!/^[0-9a-f]{64}$/.test(challenge)) refuse("challenge must be 32-byte lowercase hex");

  const receiptBytes = readFileSync(receiptPath);
  const receipt = parseJson(receiptBytes, "receipt");
  const pubkey = readFileSync(pubkeyPath, "utf8").trim();

  let outcome = "accept";
  let code = "ok";
  let exitCode = 0;
  const checked = spawnSync(process.execPath, [checkerPath, receiptPath, "--pubkey", pubkey], { encoding: "utf8" });
  if (checked.error) refuse(`checker could not start: ${checked.error.message}`);
  if (checked.status === 0) {
    if (!/Document structure       VALID/.test(checked.stdout)
      || !/Signature and bindings   VALID/.test(checked.stdout)
      || !/Verifier-local verdict   REPRODUCED/.test(checked.stdout)
      || !/VERIFY    UNVERIFIED/.test(checked.stdout)) {
      refuse("checker returned success without the required v2 rows");
    }
  } else {
    outcome = "refuse";
    code = checked.stdout.match(/^REFUSE ([a-z_]+):/)?.[1] || "checker_error";
    exitCode = 1;
  }

  const record = {
    version: 1,
    challenge,
    outcome,
    code,
    input_sha256: sha256(receiptBytes),
    signed_identity_sha256: signedIdentity(receipt),
  };
  record.evidence_sha256 = evidenceDigest(record);
  writeFileSync(resultPath, `${JSON.stringify(record)}\n`, { flag: "wx", mode: 0o600 });
  process.exit(exitCode);
}

function validate([originalPath, tamperedPath, challenge, acceptPath, refusePath]) {
  if (!originalPath || !tamperedPath || !challenge || !acceptPath || !refusePath) {
    refuse("validate requires ORIGINAL TAMPERED CHALLENGE ACCEPT_RESULT REFUSE_RESULT");
  }

  const originalBytes = readFileSync(originalPath);
  const tamperedBytes = readFileSync(tamperedPath);
  const accept = readJsonFile(acceptPath, "ACCEPT evidence");
  const rejected = readJsonFile(refusePath, "REFUSE evidence");

  for (const [label, record] of [["ACCEPT", accept], ["REFUSE", rejected]]) {
    if (record.version !== 1) refuse(`${label} evidence has the wrong version`);
    if (record.challenge !== challenge) refuse(`${label} evidence has the wrong per-run challenge`);
    if (record.evidence_sha256 !== evidenceDigest(record)) {
      refuse(`${label} evidence digest does not match the checker-computed fields`);
    }
  }
  if (accept.outcome !== "accept" || accept.code !== "ok") refuse("live receipt was not accepted");
  if (rejected.outcome !== "refuse" || rejected.code !== "signature_mismatch") {
    refuse("tampered receipt was not refused for signature_mismatch");
  }
  if (accept.input_sha256 !== sha256(originalBytes)) refuse("ACCEPT evidence names different receipt bytes");
  if (rejected.input_sha256 !== sha256(tamperedBytes)) refuse("REFUSE evidence names different receipt bytes");
  if (accept.signed_identity_sha256 !== rejected.signed_identity_sha256) {
    refuse("ACCEPT and REFUSE evidence do not share one signed receipt identity");
  }
  process.stdout.write(`checker evidence ${accept.evidence_sha256} accepted and ${rejected.evidence_sha256} refused\n`);
}

const [mode, ...args] = process.argv.slice(2);
if (mode === "check") await check(args);
else if (mode === "validate") validate(args);
else refuse("mode must be check or validate");
