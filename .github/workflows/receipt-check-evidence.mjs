// SPDX-License-Identifier: Apache-2.0

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

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
  if (!receipt.seal || typeof receipt.seal !== "object") return sha256("unsealed");
  return sha256(JSON.stringify(receipt.seal));
}

async function check([checkerPath, receiptPath, pubkeyPath, challenge, resultPath]) {
  if (!checkerPath || !receiptPath || !pubkeyPath || !challenge || !resultPath) {
    refuse("check requires CHECKER RECEIPT PUBKEY CHALLENGE RESULT");
  }
  if (!/^[0-9a-f]{64}$/.test(challenge)) refuse("challenge must be 32-byte lowercase hex");

  const receiptBytes = readFileSync(receiptPath);
  const receipt = parseJson(receiptBytes, "receipt");
  const pubkey = readFileSync(pubkeyPath, "utf8").trim();
  const { checkReceipt } = await import(pathToFileURL(checkerPath));

  let outcome = "accept";
  let code = "ok";
  let exitCode = 0;
  try {
    const checked = checkReceipt(receipt, pubkey);
    if (checked?.accepted !== true) refuse("checker returned without accepting or refusing");
  } catch (error) {
    outcome = "refuse";
    code = typeof error?.code === "string" ? error.code : "checker_error";
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
  if (rejected.outcome !== "refuse" || rejected.code !== "decision_binding_mismatch") {
    refuse("tampered receipt was not refused for decision_binding_mismatch");
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
