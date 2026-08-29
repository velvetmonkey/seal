// SPDX-License-Identifier: Apache-2.0
// The shared product spine on the RETRY protocol (roadmap step 2).
//
// One implementation serves both the demo and the protected path. The proxy
// owns effect extraction, server-to-client elicitation, approval minting,
// durable replay state, forwarding to the child, and receipt emission.
// Clients own display and the user's answer. Nothing here draws a dialog.
// Nothing outside the contract decides whether an effect executes. Deleting
// or bypassing the contract's transition must break every consumer at once.
// There is deliberately no second decision path.
//
// Transport (child spawn/lifecycle, line framing, passthrough) is harvested
// from the feat/spine1 proxy; that branch's held-protocol approval flow
// (Ed25519 token files, approvals NDJSON) is discarded — Claude Code
// rejects the held shape on a modern connection. Retry state lives in the
// contract; its authorization sub-question is delegated to the kernel.
const { spawn } = require("node:child_process");
const { randomBytes } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const readline = require("node:readline");

const { createApprovalContract } = require("../contract/contract.cjs");
const { sha256Hex } = require("../contract/canonical.cjs");
const { KERNEL_SECURITY_PHASE_NAMES } = require("./presentation.cjs");
const { openJournal, StoreError } = require("./store.cjs");
const { openReceiptEmitter } = require("./receipts.cjs");

const RECEIPT_CORRELATION_CAPACITY_EXCEEDED = "receipt_correlation_capacity_exceeded";
const CLIENT_ELICITATION_UNSUPPORTED = "client_elicitation_unsupported";
const DEFAULT_RECEIPT_CORRELATION_CAPACITY = 1024;
const DEFAULT_ELICITATION_TIMEOUT_MS = 120000;
const ELICITATION_ID_PATTERN = /^seal-elicitation\/v1\.[0-9a-f]{64}$/;
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
    childCwd,         // project directory for relative stdio server commands
    beforeForward,    // optional fail-closed live drift check
    leaseFence,       // optional durable lease-generation fence
    onClientLine,     // (line) => void — what the MCP client receives
    onDecision,       // ({decision, refusal?, receiptPath}) => void
    onChildExit,      // (code, signal) => void
    now, ttlMs, terminalWidth, // forwarded to the contract (tests inject clocks)
    elicitationTimeoutMs = ttlMs ?? DEFAULT_ELICITATION_TIMEOUT_MS,
    receiptCorrelationCapacity = DEFAULT_RECEIPT_CORRELATION_CAPACITY,
  } = options;
  const selectedTools = Array.isArray(guardTools) ? guardTools : (guardTool ? [guardTool] : []);
  if (selectedTools.length === 0 || selectedTools.some((name) => typeof name !== "string" || name.length === 0)) {
    throw new Error("guardTools is required");
  }
  if (!Number.isSafeInteger(receiptCorrelationCapacity) || receiptCorrelationCapacity < 1) {
    throw new Error("receiptCorrelationCapacity must be a positive safe integer");
  }
  if (!Number.isSafeInteger(elicitationTimeoutMs) || elicitationTimeoutMs < 1) {
    throw new Error("elicitationTimeoutMs must be a positive safe integer");
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
  const pendingElicitations = new Map();
  const completedElicitations = new Map();
  let clientCapabilities = null;

  function mintReceiptCorrelation(requestState) {
    const correlation = `seal-receipt-correlation/v1.${randomBytes(32).toString("hex")}`;
    receiptCorrelations.set(sha256Hex(requestState), correlation);
    return correlation;
  }

  function discardReceiptCorrelation(requestState) {
    receiptCorrelations.delete(sha256Hex(requestState));
  }

  function newElicitationId() {
    let id;
    do {
      id = `seal-elicitation/v1.${randomBytes(32).toString("hex")}`;
    } while (pendingElicitations.has(id) || completedElicitations.has(id));
    return id;
  }

  function rememberCompletedElicitation(id, pending) {
    completedElicitations.set(id, pending);
    if (completedElicitations.size <= receiptCorrelationCapacity) return;
    completedElicitations.delete(completedElicitations.keys().next().value);
  }

  function isTerminalDecision(decision) {
    return decision.kind === "allow" || (decision.kind === "refuse" && TERMINAL_REFUSALS.has(decision.refusal));
  }

  const childCommand = childArgv[0];
  const spawnCwd = childCwd || process.cwd();
  const childCommandPath = path.isAbsolute(childCommand) ? childCommand : path.resolve(spawnCwd, childCommand);
  if ((childCommand.includes("/") || childCommand.startsWith(".")) && !fs.existsSync(childCommandPath)) {
    const error = new Error(`protected server command is missing: ${childCommand}`);
    error.code = "protected_server_missing";
    throw error;
  }

  const child = spawn(childCommand, childArgv.slice(1), {
    cwd: spawnCwd,
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

  function emitReceipt(action, frame, extra, kernelReceipt) {
    const receipt = kernelReceipt || contract.receiptFor({
      tool: frame.params?.name,
      args: frame.params?.arguments ?? {},
      accepted: false,
    });
    const receiptPath = receipts.emit(receipt, action);
    decisionSink({ decision: action, refusal: extra?.refusal, receiptPath });
    return receiptPath;
  }

  function respond(id, result) {
    onClientLine(JSON.stringify({ jsonrpc: "2.0", id, result }));
  }

  function requestElicitation(id, params) {
    onClientLine(JSON.stringify({ jsonrpc: "2.0", id, method: "elicitation/create", params }));
  }

  function refusalResult(refusal, detail, timing) {
    const phase = timing?.kernel_timing_active_phase;
    const completed = timing?.kernel_timing_ms && typeof timing.kernel_timing_ms === "object"
      ? Object.keys(timing.kernel_timing_ms).some((name) => name.startsWith("child_"))
      : false;
    const allSecurityPhases = timing?.kernel_timing_ms && typeof timing.kernel_timing_ms === "object"
      && KERNEL_SECURITY_PHASE_NAMES.every((name) => name in timing.kernel_timing_ms);
    const phaseDetail = typeof phase === "string" && phase.length > 0
      ? ` (kernel deadline while running ${phase})`
      : timing === undefined
        ? ""
        : allSecurityPhases
          ? " (kernel worker exit was not observed after all measured phases completed)"
          : completed
            ? ` (kernel worker did not answer within its ${timing.kernel_timing_deadline_ms} ms deadline)`
            : ` (kernel worker did not publish a child timing phase within its ${timing.kernel_timing_deadline_ms} ms deadline)`;
    return { content: [{ type: "text", text: `approval refused: ${refusal} — ${detail}${phaseDetail}` }], isError: true };
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

  function finishGuarded(frame, requestState, correlation, inputResponses, detailOverride) {
    const params = frame.params || {};
    const tool = params.name;
    const args = params.arguments ?? {};
    const decision = contract.retry({ tool, args, requestState, inputResponses });
    const approvalRequest = { correlation };
    if (isTerminalDecision(decision)) discardReceiptCorrelation(requestState);
    if (decision.kind === "refuse") {
      // The elapsed timeout callback represents an unanswered elicitation.
      // The approval TTL can expire before this callback runs. The durable
      // contract state remains expired in that case, but the client must see
      // the deterministic reason for this callback: cancellation.
      const timeoutCancellation = detailOverride !== undefined
        && inputResponses?.approval?.action === "cancel"
        && decision.refusal === "expired";
      const refusal = timeoutCancellation ? "cancelled" : decision.refusal;
      const detail = detailOverride || decision.detail;
      const receiptExtra = { refusal, detail };
      receiptExtra.approvalRequest = approvalRequest;
      emitReceipt("BLOCK", frame, receiptExtra, decision.receipt);
      respond(frame.id, refusalResult(refusal, detail, decision.timing));
      if (decision.timing) {
        const error = new Error(detail);
        error.code = refusal;
        Object.assign(error, decision.timing);
        throw error;
      }
      return decision;
    }
    // The contract has already journaled the one-use consumption (fsynced)
    // before we forward: a crash here loses an approval, never gains a call.
    if (!canForward(frame)) return;
    const receiptExtra = { evidence: decision.evidence };
    receiptExtra.approvalRequest = approvalRequest;
    emitReceipt("ALLOW", frame, receiptExtra, decision.receipt);
    child.stdin.write(JSON.stringify({
      jsonrpc: "2.0", id: frame.id, method: frame.method,
      params: { name: tool, arguments: args },
    }) + "\n");
    return decision;
  }

  function completeElicitation(frame) {
    const pending = pendingElicitations.get(frame.id);
    if (!pending) return false;
    pendingElicitations.delete(frame.id);
    clearTimeout(pending.timer);
    const answer = frame.result && typeof frame.result === "object"
      ? frame.result
      : { action: "cancel" };
    const detail = frame.error
      ? `the client rejected elicitation/create: ${frame.error.message || "no error message"}`
      : undefined;
    finishGuarded(
      pending.frame,
      pending.requestState,
      pending.correlation,
      { approval: answer },
      detail,
    );
    rememberCompletedElicitation(frame.id, pending);
    return true;
  }

  function refuseDuplicateElicitation(frame) {
    const completed = completedElicitations.get(frame.id);
    if (!completed) return false;
    completedElicitations.delete(frame.id);
    const answer = frame.result && typeof frame.result === "object"
      ? frame.result
      : { action: "cancel" };
    const params = completed.frame.params || {};
    const decision = contract.retry({
      tool: params.name,
      args: params.arguments ?? {},
      requestState: completed.requestState,
      inputResponses: { approval: answer },
    });
    const refusal = decision.kind === "refuse" ? decision.refusal : "response_malformed";
    const detail = decision.kind === "refuse"
      ? decision.detail
      : "a duplicate elicitation response cannot authorize another execution";
    emitReceipt("BLOCK", completed.frame, {
      refusal,
      detail,
      approvalRequest: { correlation: completed.correlation },
    }, decision.receipt);
    return true;
  }

  function decideGuarded(frame) {
    const params = frame.params || {};
    if (params.requestState !== undefined || params.inputResponses !== undefined) {
      blockForward(frame, "response_malformed", "client-supplied approval continuations are not accepted; answer the elicitation/create request");
      return;
    }
    if (!clientCapabilities || !Object.hasOwn(clientCapabilities, "elicitation")) {
      blockForward(frame, CLIENT_ELICITATION_UNSUPPORTED, "the client did not declare the elicitation capability and cannot present an approval");
      return;
    }
    if (receiptCorrelations.size >= receiptCorrelationCapacity) {
      const detail = `receipt correlation capacity ${receiptCorrelationCapacity} is full; answer an existing approval before opening another`;
      blockForward(frame, RECEIPT_CORRELATION_CAPACITY_EXCEEDED, detail);
      return;
    }
    const decision = contract.begin({ tool: params.name, args: params.arguments ?? {} });
    if (decision.kind === "refuse") {
      emitReceipt("BLOCK", frame, { refusal: decision.refusal, detail: decision.detail }, decision.receipt);
      respond(frame.id, refusalResult(decision.refusal, decision.detail, decision.timing));
      return;
    }
    const requestState = decision.result.requestState;
    const correlation = mintReceiptCorrelation(requestState);
    emitReceipt("INPUT_REQUIRED", frame, { approvalRequest: { correlation } });
    const elicitationId = newElicitationId();
    const timer = setTimeout(() => {
      const pending = pendingElicitations.get(elicitationId);
      if (!pending) return;
      pendingElicitations.delete(elicitationId);
      finishGuarded(
        frame,
        requestState,
        correlation,
        { approval: { action: "cancel" } },
        `the client did not answer elicitation/create within ${elicitationTimeoutMs} ms; approval cancelled`,
      );
    }, elicitationTimeoutMs);
    timer.unref();
    pendingElicitations.set(elicitationId, { frame, requestState, correlation, timer });
    requestElicitation(elicitationId, decision.elicitationParams);
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
      if (!frame.method && Object.hasOwn(frame, "id")) {
        if (completeElicitation(frame)) return;
        if (refuseDuplicateElicitation(frame)) return;
        if (typeof frame.id === "string" && ELICITATION_ID_PATTERN.test(frame.id)) return;
      }
      if (frame.method === "initialize") {
        const capabilities = frame.params?.capabilities;
        clientCapabilities = capabilities && typeof capabilities === "object" && !Array.isArray(capabilities)
          ? capabilities
          : {};
      }
      if (frame.method === "tools/call" && guardedToolNames.has(frame.params?.name)) {
        decideGuarded(frame);
        return;
      }
      if (canForward(frame)) child.stdin.write(line + "\n");
    },
    stop() {
      stopping = true;
      for (const pending of pendingElicitations.values()) clearTimeout(pending.timer);
      pendingElicitations.clear();
      completedElicitations.clear();
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
