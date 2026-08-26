#!/usr/bin/env node
/**
 * The receipt writer for capture-complete-product-suite.sh.
 *
 * Receipts live outside the checkout: they are local observations, not source
 * artifacts.  The per-field MACs make accidental or casual edits detectable
 * and let the verifier identify the changed measured field.
 */
import { createHmac, createHash, randomBytes } from "node:crypto";
import { appendFileSync, chmodSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const FIELDS = ["at", "sha", "wrapper_exit", "runner_exit", "state", "tests", "pass", "fail", "cancelled", "skipped", "roster", "raw_sha256"];
const stateDir = process.env.SEAL_SUITE_CAPTURE_DIR || join(process.env.XDG_STATE_HOME || join(process.env.HOME || ".", ".local", "state"), "seal");
const receiptPath = process.env.SEAL_SUITE_RECEIPTS || join(stateDir, "product-suite-receipts.jsonl");
const keyPath = process.env.SEAL_SUITE_CAPTURE_KEY || join(stateDir, "product-suite-capture.key");

function usage() {
  console.error("usage: suitecapture-receipt.mjs record --raw FILE --sha SHA --runner-exit N --wrapper-exit N | verify RECEIPT_FILE");
  process.exitCode = 64;
}

function ensureKey() {
  mkdirSync(dirname(keyPath), { recursive: true, mode: 0o700 });
  if (!existsSync(keyPath)) writeFileSync(keyPath, randomBytes(32), { mode: 0o600, flag: "wx" });
  chmodSync(keyPath, 0o600);
  return readFileSync(keyPath);
}

function mac(key, field, value) {
  return createHmac("sha256", key).update(`${field}=${JSON.stringify(value)}\n`).digest("hex");
}

function lastCanonical(output, field) {
  const matches = [...output.matchAll(new RegExp(`^# ${field} ([0-9]+)$`, "gm"))];
  return matches.length === 1 ? Number(matches[0][1]) : null;
}

function lastRoster(output) {
  const matches = [...output.matchAll(/^ROSTER:.*$/gm)];
  return matches.length === 1 ? matches[0][0] : null;
}

function record(argv) {
  const option = (name) => {
    const index = argv.indexOf(name);
    return index >= 0 ? argv[index + 1] : undefined;
  };
  const rawPath = option("--raw");
  const sha = option("--sha");
  const runnerExit = Number(option("--runner-exit"));
  const wrapperExit = Number(option("--wrapper-exit"));
  if (!rawPath || !sha || !Number.isInteger(runnerExit) || !Number.isInteger(wrapperExit)) return usage();

  const output = readFileSync(rawPath, "utf8");
  const receipt = {
    v: 1,
    at: new Date().toISOString(),
    sha,
    wrapper_exit: wrapperExit,
    runner_exit: runnerExit,
    state: "INCOMPLETE",
    tests: null,
    pass: null,
    fail: null,
    cancelled: null,
    skipped: null,
    roster: lastRoster(output),
    raw_sha256: createHash("sha256").update(output).digest("hex"),
  };
  const totals = ["tests", "pass", "fail", "cancelled", "skipped"];
  const parsed = Object.fromEntries(totals.map((field) => [field, lastCanonical(output, field)]));
  const complete = runnerExit === 0 && receipt.roster !== null && totals.every((field) => parsed[field] !== null);
  if (complete) {
    receipt.state = "COMPLETE";
    Object.assign(receipt, parsed);
  }
  const key = ensureKey();
  receipt.macs = Object.fromEntries(FIELDS.map((field) => [field, mac(key, field, receipt[field])]));
  mkdirSync(dirname(receiptPath), { recursive: true, mode: 0o700 });
  appendFileSync(receiptPath, `${JSON.stringify(receipt)}\n`, { encoding: "utf8", mode: 0o600 });
  chmodSync(receiptPath, 0o600);
  process.stdout.write(`SUITECAPTURE RECEIPT: ${resolve(receiptPath)}\n`);
  process.stdout.write(`SUITECAPTURE STATE: ${receipt.state}\n`);
}

function verify(path) {
  /*
   * Scope: an accepted COMPLETE receipt establishes that recorded counts were not
   * altered after recording; named signed fields are at, sha, wrapper_exit,
   * runner_exit, state, tests, pass, fail, cancelled, skipped, roster, raw_sha256.
   * It does not establish that run-complete-product-suite.sh ran at all.
   * Accepted receipts can come from record --raw on hand-typed TAP, local-key HMAC
   * minting, or SEAL_SUITE_RUNNER pointing the wrapper at a green dummy.
   * The verifier authenticates the local key, not that the product suite ran.
   * This mechanism is INJECTED, not ENFORCED: violable while checks stay green.
   */
  const key = ensureKey();
  const lines = readFileSync(path, "utf8").split("\n").filter(Boolean);
  if (lines.length === 0) throw new Error("receipt is empty");
  for (const [index, line] of lines.entries()) {
    let receipt;
    try { receipt = JSON.parse(line); } catch { throw new Error(`receipt line ${index + 1} is not JSON`); }
    for (const field of FIELDS) {
      if (!(field in receipt)) throw new Error(`receipt line ${index + 1} is missing field: ${field}`);
      if (!receipt.macs || receipt.macs[field] !== mac(key, field, receipt[field])) {
        throw new Error(`TAMPERED FIELD: ${field} (receipt line ${index + 1})`);
      }
    }
  }
  process.stdout.write(`SUITECAPTURE: ${lines.length} receipt(s); recorded fields unchanged after recording; suite execution not established\n`);
}

try {
  if (process.argv[2] === "record") record(process.argv.slice(3));
  else if (process.argv[2] === "verify" && process.argv[3]) verify(process.argv[3]);
  else usage();
} catch (error) {
  console.error(`SUITECAPTURE REFUSED: ${error.message}`);
  process.exitCode = 1;
}
