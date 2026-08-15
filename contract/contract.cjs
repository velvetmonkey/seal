// SPDX-License-Identifier: Apache-2.0
//
// The approval contract for the RETRY protocol (roadmap step 1, state layer
// re-specified by the spine2 addendum).
//
// `requestState` is an OPAQUE RANDOM HANDLE — `seal-rs1.<256-bit hex>` —
// and nothing else crosses the wire: no tool, no arguments, no expiry, no
// nonce, no phase. The client is made INCAPABLE of altering anything that
// matters, rather than merely detectable when it tries. A consequence,
// accepted by design: an altered handle and a never-issued handle are the
// same lookup miss (`unknown_state`); there is nothing meaningful in the
// handle to tamper with. The server stores only the HASH of the handle,
// never the raw value, and no state blob is signed or encrypted.
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
// Accept. A client holding the correct handle can still fabricate an
// acceptance. Form elicitation puts Claude Code inside our trusted
// approval-origin boundary — an assumption we declare, not a property we
// enforce. The allow evidence repeats this.
const crypto = require("node:crypto");
const { canonicalString, sha256Hex } = require("./canonical.cjs");
const { renderApprovalMessage } = require("./renderer.cjs");

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
});

function createApprovalContract({
  now = () => Date.now(),
  ttlMs = 120000,
  terminalWidth = 80,
  projectId = "default-project",
  serverId = "default-server",
  store,
} = {}) {
  // A fresh random epoch per construction: pendings from any earlier epoch
  // are invalid by definition — a restart forces a fresh call.
  const connectionEpoch = crypto.randomBytes(8).toString("hex");
  const recordsByHash = new Map(); // handle_hash -> the contract's OWN copy

  if (store) {
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

  function refuse(refusal, detail) {
    return { kind: "refuse", refusal, detail };
  }

  // Persist a status transition BEFORE it takes effect in memory: an append
  // that fails must fail the transition, never leave memory ahead of the
  // journal.
  function setStatus(record, status) {
    if (store) store.append({ type: "status", handle_hash: record.handle_hash, status, at: now() });
    record.status = status;
  }

  function begin({ tool, args }) {
    const rendered = renderApprovalMessage(tool, args, { terminalWidth, ttlMs });
    if (!rendered.ok) return refuse(REFUSALS.UNRENDERABLE, rendered.reason);

    let canonicalEffect;
    try {
      canonicalEffect = canonicalString({ args: args ?? {}, tool });
    } catch (error) {
      return refuse(REFUSALS.UNRENDERABLE, `effect has no canonical form: ${error.message}`);
    }

    // The raw handle exists in exactly two places: this return value and
    // the client. The server keeps only its hash.
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
      result: {
        resultType: "input_required",
        inputRequests: {
          [INPUT_REQUEST_KEY]: {
            method: "elicitation/create",
            params: {
              mode: "form",
              message: rendered.message,
              // Title-free on purpose: schema field titles consume message
              // lines inside the measured envelope.
              requestedSchema: {
                type: "object",
                properties: { approve: { type: "boolean" } },
                required: ["approve"],
              },
            },
          },
        },
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
  function retry({ tool, args, requestState, inputResponses, projectId: retryProject, serverId: retryServer }) {
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

    // 3. Require the same project, server and connection epoch.
    if ((retryProject ?? projectId) !== record.project_id || (retryServer ?? serverId) !== record.server_id) {
      return refuse(REFUSALS.CONTEXT_MISMATCH, "the retry arrived for a different project or server than the one bound at issue time");
    }
    if (record.connection_epoch !== connectionEpoch) {
      return refuse(REFUSALS.RESTART_INVALIDATED, "this continuation predates a restart; send a fresh call");
    }

    // 4-5. Recompute the canonical parsed effect and compare to the STORED bytes.
    if (tool !== record.tool) return refuse(REFUSALS.TOOL_ALTERED, "the retry names a different tool than the one bound at issue time");
    let canonicalEffect;
    try {
      canonicalEffect = canonicalString({ args: args ?? {}, tool });
    } catch (error) {
      return refuse(REFUSALS.ARGUMENTS_ALTERED, `retry arguments have no canonical form: ${error.message}`);
    }
    if (canonicalEffect !== record.canonical_effect_bytes) {
      return refuse(REFUSALS.ARGUMENTS_ALTERED, "the retry effect differs from the exact effect shown for approval");
    }

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

    // 7. Atomically consume BEFORE the caller may forward anything.
    setStatus(record, "consumed");
    record.consumed_at = now();

    return {
      kind: "allow",
      evidence: {
        handle_returned_unaltered: true,
        effect_matches_bound_bytes: true,
        within_expiry: true,
        same_connection_epoch: true,
        one_use_consumed_now: true,
        approval_nonce: record.approval_nonce,
        // The honest limit, verbatim in the evidence: the client is stopped
        // from altering the continuation; a human click is not proven.
        human_present: "unknown",
        human_present_detail:
          "a client holding the correct handle can fabricate an acceptance; form elicitation places the client inside the trusted approval-origin boundary — a declared assumption, not an enforced property",
      },
    };
  }

  return { begin, retry, REFUSALS, connectionEpoch };
}

module.exports = { createApprovalContract, REFUSALS };
