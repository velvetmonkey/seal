// SPDX-License-Identifier: Apache-2.0
//
// The approval contract for the RETRY protocol (roadmap step 1, state layer
// re-specified by the spine2 addendum).
//
// `requestState` is an OPAQUE RANDOM HANDLE — `seal-rs1.<256-bit hex>`.
// The proxy keeps the raw handle inside the connection while this contract
// stores only its hash. The elicitation response carries no handle, tool,
// arguments, expiry, nonce, or phase for the client to alter.
//
// Two lifetimes, deliberately different:
//   - a CONSUMED approval survives a restart (journaled, fsynced), so
//     replay after restart is refused: one use that forgets is not one use;
//   - a PENDING continuation does NOT survive a restart: it is bound to a
//     connection epoch, and a new epoch invalidates it, forcing a fresh
//     call.
//
// THE HONEST LIMIT, stated where a reader will find it: this contract stops
// the CLIENT altering the continuation. It does NOT prove a human clicked
// Accept. A client can fabricate an accepting elicitation response. Form
// elicitation puts Claude Code inside our trusted approval-origin boundary —
// an assumption we declare, not a property we enforce. The allow evidence
// repeats this.
const crypto = require("node:crypto");
const { canonicalString, sha256Hex } = require("./canonical.cjs");
const { renderApprovalMessage } = require("./renderer.cjs");
const { createKernelAuthorizationAdapter, KernelAuthorizationError } = require("./kernel-authorization.cjs");

const HANDLE_PATTERN = /^seal-rs1\.[0-9a-f]{64}$/;
const INPUT_REQUEST_KEY = "approval";

const REFUSALS = Object.freeze({
  UNRENDERABLE: "unrenderable_effect",
  STATE_MALFORMED: "state_malformed",
  UNKNOWN_STATE: "unknown_state", // altered and never-issued alike: a lookup miss
  ALREADY_CONSUMED: "already_consumed",
  TERMINALLY_DECLINED: "terminally_declined",
  CANCELLED: "cancelled",
  EXPIRED: "expired",
  RESTART_INVALIDATED: "restart_invalidated",
  CONTEXT_MISMATCH: "context_mismatch",
  TOOL_ALTERED: "tool_altered",
  ARGUMENTS_ALTERED: "arguments_altered",
  RESPONSE_MALFORMED: "response_malformed",
  DECLINED: "declined",
  AUTHORIZATION_DISAGREEMENT: "authorization_disagreement",
  KERNEL_INTEGRITY_REFUSED: "kernel_integrity_refused",
  KERNEL_MANIFEST_REFUSED: "kernel_manifest_refused",
  KERNEL_EXECUTION_REFUSED: "kernel_execution_refused",
  KERNEL_OUTPUT_REFUSED: "kernel_output_refused",
  LEASE_GENERATION_MISMATCH: "lease_generation_mismatch",
});

function createApprovalContract({
  now = () => Date.now(),
  ttlMs = 120000,
  terminalWidth = 80,
  projectId = "default-project",
  serverId = "default-server",
  store,
  kernelAdapter = createKernelAuthorizationAdapter(),
  leaseFence,
} = {}) {
  // A fresh random epoch per construction: pendings from any earlier epoch
  // are invalid by definition — a restart forces a fresh call.
  const connectionEpoch = crypto.randomBytes(8).toString("hex");
  const recordsByHash = new Map(); // handle_hash -> the contract's OWN copy

  function loadStore() {
    if (!store) return;
    recordsByHash.clear();
    for (const event of store.events) {
      if (event.type === "issued") {
        recordsByHash.set(event.handle_hash, {
          handle_hash: event.handle_hash,
          status: "pending",
          project_id: event.project_id,
          server_id: event.server_id,
          tool: event.tool,
          canonical_effect_bytes: event.canonical_effect_bytes,
          connection_epoch: event.connection_epoch,
          input_request_key: event.input_request_key,
          created_at: event.created_at,
          expires_at: event.expires_at,
          approval_nonce: event.approval_nonce,
        });
      } else if (event.type === "status") {
        const record = recordsByHash.get(event.handle_hash);
        if (!record) throw new Error(`approval store is inconsistent: status for unknown handle hash ${event.handle_hash}`);
        record.status = event.status;
      } else {
        throw new Error(`approval store is inconsistent: unknown event type ${event.type}`);
      }
    }
    // The correction's second lifetime: any continuation still pending from
    // an earlier connection epoch is invalidated here, and the journal
    // records that so the invalidation itself survives.
    for (const record of recordsByHash.values()) {
      if (record.status === "pending" && record.connection_epoch !== connectionEpoch) {
        store.append({ type: "status", handle_hash: record.handle_hash, status: "restart_invalidated", at: now() });
        record.status = "restart_invalidated";
      }
    }
  }

  loadStore();

  function refuse(refusal, detail, timing) {
    return { kind: "refuse", refusal, detail, ...(timing === undefined ? {} : { timing }) };
  }

  function receiptFor({ tool, args, accepted = false }) {
    const kernelNow = Math.floor(now() / 1000);
    try {
      return kernelAdapter.authorize({
        epoch: 1,
        issuedTool: tool,
        issuedArgs: args ?? {},
        retryTool: tool,
        retryArgs: args ?? {},
        accepted,
        now: kernelNow,
      }).receipt_record;
    } catch (error) {
      // The kernel produced no result. retryUnlocked already returns a
      // Node-side refusal with no receipt for this failure; minting a
      // signed BLOCK here would claim a decision the kernel did not make.
      if (error instanceof KernelAuthorizationError || typeof error?.code === "string") {
        const timing = error.kernel_timing_timestamps === undefined ? undefined : {
          kernel_timing_timestamps: error.kernel_timing_timestamps,
          kernel_timing_ms: error.kernel_timing_ms,
          kernel_timing_active_phase: error.kernel_timing_active_phase,
          kernel_timing_deadline_ms: error.kernel_timing_deadline_ms,
          kernel_timing_lifecycle: error.kernel_timing_lifecycle,
          kernel_timing_unmeasured: error.kernel_timing_unmeasured,
        };
        return refuse(error.code, error.message, timing);
      }
      return refuse(REFUSALS.KERNEL_EXECUTION_REFUSED, error.message);
    }
  }

  // Persist a status transition BEFORE it takes effect in memory: an append
  // that fails must fail the transition, never leave memory ahead of the
  // journal.
  function setStatus(record, status) {
    if (store) store.append({ type: "status", handle_hash: record.handle_hash, status, at: now() });
    record.status = status;
  }

  function bindApprovalIdentity(receipt, record) {
    if (!receipt) return receipt;
    return {
      ...receipt,
      kernel_inputs: {
        ...receipt.kernel_inputs,
        approval_handle_sha256: record.handle_hash,
      },
    };
  }

  function beginUnlocked({ tool, args }) {
    const rendered = renderApprovalMessage(tool, args, { terminalWidth, ttlMs });
    if (!rendered.ok) return refuse(REFUSALS.UNRENDERABLE, rendered.reason);

    let canonicalEffect;
    try {
      canonicalEffect = canonicalString({ args: args ?? {}, tool });
    } catch (error) {
      return refuse(REFUSALS.UNRENDERABLE, `effect has no canonical form: ${error.message}`);
    }

    // The raw handle leaves this contract only in the return value. The
    // proxy retains it until the matching elicitation response arrives.
    // This contract keeps only its hash.
    const handle = `seal-rs1.${crypto.randomBytes(32).toString("hex")}`;
    const createdAt = now();
    const record = {
      handle_hash: sha256Hex(handle),
      status: "pending",
      project_id: projectId,
      server_id: serverId,
      tool,
      canonical_effect_bytes: canonicalEffect,
      connection_epoch: connectionEpoch,
      input_request_key: INPUT_REQUEST_KEY,
      created_at: createdAt,
      expires_at: createdAt + ttlMs,
      approval_nonce: crypto.randomBytes(16).toString("hex"),
    };
    if (store) store.append({ type: "issued", ...record, status: undefined });
    recordsByHash.set(record.handle_hash, record);

    return {
      kind: "input_required",
      elicitationParams: {
        message: rendered.message,
        requestedSchema: {
          type: "object",
          properties: {
            approve: {
              type: "boolean",
              title: `Approve one run: ${tool}`,
              description: `Arguments: ${rendered.argLines.map((line) => line.trim()).join("; ")}. Scope: at most one run.`,
            },
          },
          required: ["approve"],
        },
      },
      result: {
        resultType: "input_required",
        content: [{ type: "text", text: rendered.message }],
        requestState: handle,
      },
    };
  }

  // The retry transaction — the addendum's eight steps, in order, judged
  // only against the contract's own record. Steps 1-6 reject without any
  // caller-visible side effect; step 7 consumes atomically (journal append
  // + fsync before the in-memory transition, and before any forwarding by
  // the caller); step 8 is the shape of every refusal here: the child is
  // never touched.
  function retryUnlocked({ tool, args, requestState, inputResponses, projectId: retryProject, serverId: retryServer }) {
    // 1. Look up the handle by hash.
    if (typeof requestState !== "string" || !HANDLE_PATTERN.test(requestState)) {
      return refuse(REFUSALS.STATE_MALFORMED, "requestState is not a handle this contract ever issues");
    }
    const record = recordsByHash.get(sha256Hex(requestState));
    if (!record) return refuse(REFUSALS.UNKNOWN_STATE, "no continuation matches this handle; altered and never-issued are the same miss");

    // 2. Require pending and unexpired.
    if (record.status === "consumed") return refuse(REFUSALS.ALREADY_CONSUMED, "this one-use approval has already been consumed");
    if (record.status === "declined") return refuse(REFUSALS.TERMINALLY_DECLINED, "this request was declined; denial is terminal");
    if (record.status === "cancelled") return refuse(REFUSALS.CANCELLED, "this request was cancelled");
    if (record.status === "restart_invalidated") {
      return refuse(REFUSALS.RESTART_INVALIDATED, "this continuation predates a restart; send a fresh call");
    }
    if (record.status === "expired" || now() > record.expires_at) {
      if (record.status !== "expired") setStatus(record, "expired");
      return refuse(REFUSALS.EXPIRED, "the approval window closed before the retry arrived");
    }

    // 3. Connection currency is Node state. Project/server binding is retained
    // for the authorization adapter below.
    const contextMatches = (retryProject ?? projectId) === record.project_id &&
      (retryServer ?? serverId) === record.server_id;
    if (record.connection_epoch !== connectionEpoch) {
      return refuse(REFUSALS.RESTART_INVALIDATED, "this continuation predates a restart; send a fresh call");
    }

    // 4-5. Retain the exact issue-time and retry effects. Node computes its
    // side of the authorization comparison; the kernel must separately
    // agree before this transaction may consume or forward.
    const toolMatches = tool === record.tool;
    let canonicalEffect;
    try {
      canonicalEffect = canonicalString({ args: args ?? {}, tool });
    } catch (error) {
      return refuse(REFUSALS.ARGUMENTS_ALTERED, `retry arguments have no canonical form: ${error.message}`);
    }
    const argumentsMatch = canonicalEffect === record.canonical_effect_bytes;

    // 6. Require exactly the expected inputResponses entry.
    if (inputResponses === null || typeof inputResponses !== "object") {
      return refuse(REFUSALS.RESPONSE_MALFORMED, "inputResponses is not an object");
    }
    const keys = Object.keys(inputResponses);
    if (keys.length !== 1 || keys[0] !== record.input_request_key) {
      return refuse(REFUSALS.RESPONSE_MALFORMED, `inputResponses must carry exactly the "${record.input_request_key}" entry`);
    }
    const answer = inputResponses[record.input_request_key];
    if (!answer || typeof answer.action !== "string") {
      return refuse(REFUSALS.RESPONSE_MALFORMED, "the approval answer has no readable action");
    }
    if (answer.action === "decline") {
      setStatus(record, "declined");
      return refuse(REFUSALS.DECLINED, "the answer was decline; denial is terminal for this request");
    }
    if (answer.action === "cancel") {
      setStatus(record, "cancelled");
      return refuse(REFUSALS.CANCELLED, "the answer was cancel");
    }
    if (answer.action !== "accept" || answer.content?.approve !== true) {
      return refuse(REFUSALS.RESPONSE_MALFORMED, "the answer is neither accept, decline, nor cancel with a readable approve value");
    }

    const nodeAuthorized = contextMatches && toolMatches && argumentsMatch;
    if (leaseFence) {
      const fence = leaseFence();
      if (!fence?.ok) return refuse(REFUSALS.LEASE_GENERATION_MISMATCH, fence?.detail || "this proxy no longer owns the active lease generation");
    }
    let kernel;
    const kernelNow = Math.floor(now() / 1000);
    try {
      kernel = kernelAdapter.authorize({
        epoch: 1,
        issuedTool: record.tool,
        issuedArgs: JSON.parse(record.canonical_effect_bytes).args,
        retryTool: tool,
        retryArgs: args ?? {},
        accepted: nodeAuthorized,
        now: kernelNow,
      });
    } catch (error) {
      if (error instanceof KernelAuthorizationError || typeof error?.code === "string") {
        const timing = error.kernel_timing_timestamps === undefined ? undefined : {
          kernel_timing_timestamps: error.kernel_timing_timestamps,
          kernel_timing_ms: error.kernel_timing_ms,
          kernel_timing_active_phase: error.kernel_timing_active_phase,
          kernel_timing_deadline_ms: error.kernel_timing_deadline_ms,
          kernel_timing_lifecycle: error.kernel_timing_lifecycle,
          kernel_timing_unmeasured: error.kernel_timing_unmeasured,
        };
        return refuse(error.code, `${error.message}; Node authorization did not override the kernel refusal`, timing);
      }
      return refuse(REFUSALS.KERNEL_EXECUTION_REFUSED, `${error.message}; Node authorization did not override the kernel refusal`);
    }
    const kernelAuthorized = kernel.verdict === "ALLOW";
    const receipt = bindApprovalIdentity(kernel.receipt_record, record);
    if (nodeAuthorized !== kernelAuthorized) {
      const side = nodeAuthorized ? "kernel" : "Node";
      return { ...refuse(
        REFUSALS.AUTHORIZATION_DISAGREEMENT,
        `${side} refused while ${side === "kernel" ? "Node" : "kernel"} allowed; authorization disagreement fails closed`,
      ), receipt };
    }
    if (!nodeAuthorized) {
      if (!contextMatches) return { ...refuse(REFUSALS.CONTEXT_MISMATCH, "Node and kernel refused: retry context differs from the issue-time binding"), receipt };
      if (!toolMatches) return { ...refuse(REFUSALS.TOOL_ALTERED, "Node and kernel refused: retry tool differs from the issue-time tool"), receipt };
      return { ...refuse(REFUSALS.ARGUMENTS_ALTERED, "Node and kernel refused: retry effect differs from the exact issue-time effect"), receipt };
    }

    // 7. Atomically consume BEFORE the caller may forward anything.
    // Re-check the durable lease after authorization and immediately before
    // consumption. A stale process may evaluate, but it may never consume.
    if (leaseFence) {
      const fence = leaseFence();
      if (!fence?.ok) return refuse(REFUSALS.LEASE_GENERATION_MISMATCH, fence?.detail || "this proxy no longer owns the active lease generation");
    }

    setStatus(record, "consumed");
    record.consumed_at = now();

    return {
      kind: "allow",
      receipt,
      evidence: {
        handle_returned_unaltered: true,
        effect_matches_bound_bytes: true,
        within_expiry: true,
        same_connection_epoch: true,
        one_use_consumed_now: true,
        approval_nonce: record.approval_nonce,
        authorization_rule: "TESTED",
        state_machine: "TESTED",
        kernel: {
          verdict: kernel.verdict,
          raw: kernel.raw,
          issued_target: kernel.issued_target,
          wasm_sha256: kernel.wasm_sha256,
        },
        // The honest limit, verbatim in the evidence: the client is stopped
        // from altering the continuation; a human click is not proven.
        human_present: "unknown",
        human_present_detail:
          "a client can fabricate an accepting elicitation response; form elicitation places the client inside the trusted approval-origin boundary — a declared assumption, not an enforced property",
      },
    };
  }

  function begin(input) {
    if (!store) return beginUnlocked(input);
    return store.withLock(() => {
      loadStore();
      return beginUnlocked(input);
    });
  }

  function retry(input) {
    if (!store) return retryUnlocked(input);
    return store.withLock(() => {
      loadStore();
      return retryUnlocked(input);
    });
  }

  return { begin, retry, receiptFor, REFUSALS, connectionEpoch };
}

module.exports = { createApprovalContract, REFUSALS };
