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
import { spawn } from "node:child_process";
import { dirname, join, resolve } from "node:path";

const FIELDS = ["at", "sha", "commit_identity", "runner", "observation", "capture_complete", "raw_status", "raw_bytes", "wrapper_exit", "runner_exit", "state", "tests", "pass", "fail", "cancelled", "skipped", "roster", "raw_sha256"];
const stateDir = process.env.SEAL_SUITE_CAPTURE_DIR || join(process.env.XDG_STATE_HOME || join(process.env.HOME || ".", ".local", "state"), "seal");
const receiptPath = process.env.SEAL_SUITE_RECEIPTS || join(stateDir, "product-suite-receipts.jsonl");
const keyPath = process.env.SEAL_SUITE_CAPTURE_KEY || join(stateDir, "product-suite-capture.key");

function usage() {
  console.error("usage: suitecapture-receipt.mjs observe --sha SHA --runner PATH [-- ARGS...] | record --raw FILE --sha SHA --runner PATH --capture-complete 0|1 --runner-exit N --wrapper-exit N | verify RECEIPT_FILE");
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

function rawFromPath(rawPath) {
  let output = "";
  let rawStatus = "WHOLE";
  try {
    const raw = statSync(rawPath);
    if (!raw.isFile()) rawStatus = "UNREADABLE";
    else {
      output = readFileSync(rawPath, "utf8");
      if (output.length === 0) rawStatus = "EMPTY";
      else if (!output.endsWith("\n")) rawStatus = "TRUNCATED";
    }
  } catch (error) {
    rawStatus = error?.code === "ENOENT" ? "MISSING" : "UNREADABLE";
  }
  return { output, rawStatus };
}

/*
 * Property: COMPLETE is possible only for bytes this process captured directly
 * from the named runner it spawned. Bytes merely handed to `record`, however
 * well formed or caller-labelled, are recorded as HANDED and cannot attest to
 * that runner because this writer did not observe that runner produce them.
 */
function writeReceipt({ output, rawStatus, sha, runner, observation, captureComplete, runnerExit, wrapperExit }) {
  const commitIdentity = /^[0-9a-f]{40}([0-9a-f]{24})?$/i.test(sha) ? "REAL" : "MISSING";
  const receipt = {
    v: 2, at: new Date().toISOString(), sha: commitIdentity === "REAL" ? sha : null, commit_identity: commitIdentity,
    runner, observation, capture_complete: captureComplete, raw_status: rawStatus,
    raw_bytes: rawStatus === "WHOLE" ? Buffer.byteLength(output) : null, wrapper_exit: wrapperExit, runner_exit: runnerExit,
    // REFUSED deliberately does not contain the success token COMPLETE: a substring scan cannot confuse a refused capture for a pass.
    state: "REFUSED", tests: null, pass: null, fail: null, cancelled: null, skipped: null,
    roster: lastRoster(output), raw_sha256: rawStatus === "WHOLE" ? createHash("sha256").update(output).digest("hex") : null,
  };
  const totals = ["tests", "pass", "fail", "cancelled", "skipped"];
  const parsed = Object.fromEntries(totals.map((field) => [field, lastCanonical(output, field)]));
  const complete = observation === "OBSERVED" && captureComplete && rawStatus === "WHOLE" && commitIdentity === "REAL" && runnerExit === 0 && wrapperExit === 0 && receipt.roster !== null && totals.every((field) => parsed[field] !== null);
  if (complete) { receipt.state = "COMPLETE"; Object.assign(receipt, parsed); }
  const key = ensureKey();
  receipt.macs = Object.fromEntries(FIELDS.map((field) => [field, mac(key, field, receipt[field])]));
  mkdirSync(dirname(receiptPath), { recursive: true, mode: 0o700 });
  appendFileSync(receiptPath, `${JSON.stringify(receipt)}\n`, { encoding: "utf8", mode: 0o600 });
  chmodSync(receiptPath, 0o600);
  process.stdout.write(`SUITECAPTURE RECEIPT: ${resolve(receiptPath)}\n`);
  process.stdout.write(`SUITECAPTURE STATE: ${receipt.state}\n`);
}

function record(argv) {
  const option = (name) => { const index = argv.indexOf(name); return index >= 0 ? argv[index + 1] : undefined; };
  const rawPath = option("--raw"); const sha = option("--sha"); const runner = option("--runner");
  const captureComplete = option("--capture-complete") === "1"; const runnerExit = Number(option("--runner-exit")); const wrapperExit = Number(option("--wrapper-exit"));
  if (!rawPath || runner === undefined || sha === undefined || !Number.isInteger(runnerExit) || !Number.isInteger(wrapperExit)) return usage();
  const { output, rawStatus } = rawFromPath(rawPath);
  writeReceipt({ output, rawStatus, sha, runner, observation: "HANDED", captureComplete, runnerExit, wrapperExit });
}

function observe(argv) {
  const option = (name) => { const index = argv.indexOf(name); return index >= 0 ? argv[index + 1] : undefined; };
  const sha = option("--sha"); const runner = option("--runner"); const separator = argv.indexOf("--");
  const runnerArgs = separator >= 0 ? argv.slice(separator + 1) : [];
  if (sha === undefined || !runner) return usage();
  const child = spawn(runner, runnerArgs, { stdio: ["inherit", "pipe", "pipe"] });
  const chunks = []; let streamError = false; let receivedSignal = null;
  const capture = (stream, destination) => {
    stream.on("data", (chunk) => { const bytes = Buffer.from(chunk); chunks.push(bytes); destination.write(bytes); });
    stream.on("error", () => { streamError = true; });
  };
  capture(child.stdout, process.stdout); capture(child.stderr, process.stderr);
  const signalStatus = { SIGHUP: 129, SIGINT: 130, SIGTERM: 143 };
  for (const signal of Object.keys(signalStatus)) process.on(signal, () => { if (!receivedSignal) receivedSignal = signal; child.kill(signal); });
  child.on("error", (error) => { streamError = true; process.stderr.write(`SUITECAPTURE REFUSED: cannot execute runner: ${error.message}\n`); });
  child.on("close", (code, signal) => {
    const runnerExit = receivedSignal ? signalStatus[receivedSignal] : (Number.isInteger(code) ? code : (signalStatus[signal] || 1));
    const output = Buffer.concat(chunks).toString("utf8");
    const rawStatus = streamError ? "UNREADABLE" : (output.length === 0 ? "EMPTY" : (output.endsWith("\n") ? "WHOLE" : "TRUNCATED"));
    const totals = ["tests", "pass", "fail", "cancelled", "skipped"];
    // Preserve the wrapper's round-1 meaning of a clean exit: a runner that
    // omitted any canonical footer field is not a successful wrapper run.
    const completeFooter = lastRoster(output) !== null && totals.every((field) => lastCanonical(output, field) !== null);
    const wrapperExit = runnerExit === 0 && !streamError && completeFooter ? 0 : runnerExit || 1;
    writeReceipt({ output, rawStatus, sha, runner, observation: "OBSERVED", captureComplete: !streamError, runnerExit, wrapperExit });
    process.exitCode = wrapperExit;
  });
}

function verify(path) {
  const key = ensureKey(); const lines = readFileSync(path, "utf8").split("\n").filter(Boolean);
  if (lines.length === 0) throw new Error("receipt is empty");
  for (const [index, line] of lines.entries()) {
    let receipt; try { receipt = JSON.parse(line); } catch { throw new Error(`receipt line ${index + 1} is not JSON`); }
    for (const field of FIELDS) {
      if (!(field in receipt)) throw new Error(`receipt line ${index + 1} is missing field: ${field}`);
      if (!receipt.macs || receipt.macs[field] !== mac(key, field, receipt[field])) throw new Error(`TAMPERED FIELD: ${field} (receipt line ${index + 1})`);
    }
  }
  process.stdout.write(`SUITECAPTURE: ${lines.length} receipt(s); recorded fields unchanged after recording; COMPLETE receipts are writer-observed runner output\n`);
}

try {
  if (process.argv[2] === "observe") observe(process.argv.slice(3));
  else if (process.argv[2] === "record") record(process.argv.slice(3));
  else if (process.argv[2] === "verify" && process.argv[3]) verify(process.argv[3]);
  else usage();
} catch (error) { console.error(`SUITECAPTURE REFUSED: ${error.message}`); process.exitCode = 1; }
