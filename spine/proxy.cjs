// SPDX-License-Identifier: Apache-2.0
// The shared product spine on the RETRY protocol (roadmap step 2).
//
// One implementation serves both the demo and the protected path. The proxy
// owns effect extraction, `input_required` construction (via the merged
// approval contract), approval minting, durable replay state, forwarding to
// the child, and receipt emission. Renderers own display and the user's
// answer — nothing here asks a question or draws a line, and nothing
// outside the contract decides whether an effect executes. Deleting or
// bypassing the contract's transition must break every consumer at once;
// there is deliberately no second decision path.
//
// Transport (child spawn/lifecycle, line framing, passthrough) is harvested
// from the feat/spine1 proxy; that branch's held-protocol approval flow
// (Ed25519 token files, approvals NDJSON) is discarded — Claude Code
// rejects the held shape on a modern connection. Retry state lives in the
// contract; its authorization sub-question is delegated to the proved kernel.
const { spawn } = require("node:child_process");
const { randomBytes } = require("node:crypto");
const fs = require("node:fs");
const readline = require("node:readline");

const { createApprovalContract } = require("../contract/contract.cjs");
const { sha256Hex } = require("../contract/canonical.cjs");
const { openJournal, StoreError } = require("./store.cjs");
const { openReceiptEmitter } = require("./receipts.cjs");

const HANDLE_PATTERN = /^seal-rs1\.[0-9a-f]{64}$/;
const RECEIPT_CORRELATION_MISSING = "receipt_correlation_missing";
const TERMINAL_REFUSALS = new Set([
  "already_consumed",
  "terminally_declined",
  "cancelled",
  "expired",
  "restart_invalidated",
  "declined",
]);

function createProxy(options) {
  const {
    guardTools,       // the selected literal tool names
    guardTool,        // legacy direct-call spelling for one selected tool
    storePath,        // durable approval journal (absent/corrupt is fatal)
    receiptsDir,      // receipt per decision
    signer,           // optional receipt-sealing keypair (V11-RECEIPT-01)
    childArgv,        // [command, ...args] for the protected server
    childEnv,         // optional environment overlay from the project server
    beforeForward,    // optional fail-closed live drift check
    leaseFence,       // optional durable lease-generation fence
    onClientLine,     // (line) => void — what the MCP client receives
    onDecision,       // ({decision, refusal?, receiptPath}) => void
    onChildExit,      // (code, signal) => void
    now, ttlMs, terminalWidth, // forwarded to the contract (tests inject clocks)
  } = options;
  const selectedTools = Array.isArray(guardTools) ? guardTools : (guardTool ? [guardTool] : []);
  if (selectedTools.length === 0 || selectedTools.some((name) => typeof name !== "string" || name.length === 0)) {
    throw new Error("guardTools is required");
  }
  const guardedToolNames = new Set(selectedTools);
  if (!Array.isArray(childArgv) || childArgv.length === 0) throw new Error("childArgv is required");

  const journal = openJournal(storePath); // throws StoreError: absent, unreadable, corrupt
  const contract = createApprovalContract({ store: journal, now, ttlMs, terminalWidth, leaseFence });
  const receipts = openReceiptEmitter(receiptsDir, signer);
  const decisionSink = onDecision || (() => {});
  // This identifier exists only to join receipt records from this proxy
  // session. It is random, is not derived from the approval handle, and is
  // discarded at process exit (where pending approvals are refused anyway).
  const receiptCorrelations = new Map();

  function receiptCorrelation(requestState) {
    return receiptCorrelations.get(sha256Hex(requestState));
  }

  function mintReceiptCorrelation(requestState) {
    const correlation = `seal-receipt-correlation/v1.${randomBytes(32).toString("hex")}`;
    receiptCorrelations.set(sha256Hex(requestState), correlation);
    return correlation;
  }

  function discardReceiptCorrelation(requestState) {
    receiptCorrelations.delete(sha256Hex(requestState));
  }

  function isTerminalDecision(decision) {
    return decision.kind === "allow" || (decision.kind === "refuse" && TERMINAL_REFUSALS.has(decision.refusal));
  }

  const childCommand = childArgv[0];
  if ((childCommand.includes("/") || childCommand.startsWith(".")) && !fs.existsSync(childCommand)) {
    const error = new Error(`protected server command is missing: ${childCommand}`);
    error.code = "protected_server_missing";
    throw error;
  }

  const child = spawn(childCommand, childArgv.slice(1), {
    stdio: ["pipe", "pipe", "inherit"],
    env: childEnv ? { ...process.env, ...childEnv } : process.env,
  });
  let stopping = false;
  let childSpawnError = null;
  child.once("error", (error) => {
    childSpawnError = error.code === "ENOENT" ? "protected_server_missing" : "protected_server_failed";
  });
  child.once("close", (code, signal) => {
    if (onChildExit) onChildExit(stopping ? 0 : code, signal);
  });
  const childOut = readline.createInterface({ input: child.stdout, terminal: false });
  childOut.on("line", (line) => onClientLine(line));

  function emitReceipt(decision, frame, extra) {
    const receiptPath = receipts.emit({
      at: Date.now(),
      decision,
      tool: frame.params?.name,
      arguments: frame.params?.arguments ?? {},
      child: { argv: childArgv },
      ...extra,
    });
    decisionSink({ decision, refusal: extra?.refusal, receiptPath });
    return receiptPath;
  }

  function respond(id, result) {
    onClientLine(JSON.stringify({ jsonrpc: "2.0", id, result }));
  }

  function refusalResult(refusal, detail) {
    return { content: [{ type: "text", text: `approval refused: ${refusal} — ${detail}` }], isError: true };
  }

  function blockForward(frame, refusal, detail) {
    emitReceipt("BLOCK", frame, { refusal, detail });
    if (frame && Object.hasOwn(frame, "id")) respond(frame.id, refusalResult(refusal, detail));
  }

  function canForward(frame) {
    if (childSpawnError) {
      blockForward(frame, childSpawnError, `protected server command failed to start: ${childArgv[0]}`);
      return false;
    }
    if (beforeForward) {
      const check = beforeForward();
      if (!check?.ok) {
        blockForward(frame, check.refusal || "forward_refused", check.detail || "protected server forwarding refused");
        return false;
      }
    }
    return true;
  }

  function decideGuarded(frame) {
    const params = frame.params || {};
    const tool = params.name;
    const args = params.arguments ?? {};
    const { requestState, inputResponses } = params;

    if (requestState === undefined && inputResponses === undefined) {
      // First call for the guarded effect: offer approval through the
      // client's renderer, or refuse to offer at all.
      const decision = contract.begin({ tool, args });
      if (decision.kind === "refuse") {
        emitReceipt("BLOCK", frame, { refusal: decision.refusal, detail: decision.detail });
        respond(frame.id, refusalResult(decision.refusal, decision.detail));
        return;
      }
      emitReceipt("INPUT_REQUIRED", frame, {
        approvalRequest: { correlation: mintReceiptCorrelation(decision.result.requestState) },
      });
      respond(frame.id, decision.result);
      return;
    }

    // The retry: client-supplied state and answer, judged only against the
    // contract's own record.
    // A malformed state is contract-owned and has no map key. For every
    // handle-shaped retry, the proxy must also have its correlation before
    // the retry may reach the child.
    const correlation = typeof requestState === "string" && HANDLE_PATTERN.test(requestState)
      ? receiptCorrelation(requestState)
      : undefined;
    const decision = contract.retry({ tool, args, requestState, inputResponses });
    if (correlation === undefined) {
      if (decision.kind === "refuse") {
        emitReceipt("BLOCK", frame, { refusal: decision.refusal, detail: decision.detail });
        respond(frame.id, refusalResult(decision.refusal, decision.detail));
        return;
      }
      const detail = "no receipt correlation matches this continuation; retry refused before forwarding";
      emitReceipt("BLOCK", frame, { refusal: RECEIPT_CORRELATION_MISSING, detail });
      respond(frame.id, refusalResult(RECEIPT_CORRELATION_MISSING, detail));
      return;
    }
    const approvalRequest = { correlation };
    if (isTerminalDecision(decision)) discardReceiptCorrelation(requestState);
    if (decision.kind === "refuse") {
      const receiptExtra = { refusal: decision.refusal, detail: decision.detail };
      receiptExtra.approvalRequest = approvalRequest;
      emitReceipt("BLOCK", frame, receiptExtra);
      respond(frame.id, refusalResult(decision.refusal, decision.detail));
      return;
    }
    // The contract has already journaled the one-use consumption (fsynced)
    // before we forward: a crash here loses an approval, never gains a call.
    if (!canForward(frame)) return;
    const receiptExtra = { evidence: decision.evidence };
    receiptExtra.approvalRequest = approvalRequest;
    emitReceipt("ALLOW", frame, receiptExtra);
    child.stdin.write(JSON.stringify({
      jsonrpc: "2.0", id: frame.id, method: frame.method,
      params: { name: tool, arguments: args },
    }) + "\n");
  }

  return {
    write(line) {
      if (line.trim() === "") return;
      let frame;
      try {
        frame = JSON.parse(line);
      } catch {
        onClientLine(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "seal proxy: unparseable frame refused" } }));
        return;
      }
      if (frame.method === "tools/call" && guardedToolNames.has(frame.params?.name)) {
        decideGuarded(frame);
        return;
      }
      if (canForward(frame)) child.stdin.write(line + "\n");
    },
    stop() {
      stopping = true;
      return new Promise((resolve) => {
        if (child.exitCode !== null || child.signalCode !== null) return resolve();
        child.once("close", () => resolve());
        try { child.stdin.end(); } catch {}
        child.kill("SIGTERM");
        setTimeout(() => { try { child.kill("SIGKILL"); } catch {} }, 2000).unref();
      });
    },
  };
}

module.exports = { createProxy, StoreError };
