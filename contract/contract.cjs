// SPDX-License-Identifier: Apache-2.0
//
// The approval contract for the RETRY protocol (roadmap step 1).
//
// Measured basis (/home/monkey/twomodels-report.md, Claude Code 2.1.232 on a
// modern 2026-07-28 connection): the client rejects a nested
// elicitation/create; approval happens as `resultType: "input_required"`
// followed by a FRESH tools/call carrying `requestState` and
// `inputResponses`. The model never receives a pending-approval tool result:
// this contract emits input_required, allow, or a refusal — nothing pending,
// no approval id for the model to carry or improvise around.
//
// THE SECURITY PROPERTY, which is the whole job:
// `requestState` and `inputResponses` arrive FROM THE CLIENT. A raw client
// with no dialog and no human can send `{"action":"accept","content":
// {"approve":true}}` with any state it likes — that was demonstrated, not
// hypothesised. Therefore `inputResponses` is NEVER proof that a human
// approved anything. This contract keeps its OWN record of every request it
// issues — tool, exact canonical arguments, expiry, a one-use record, and
// the exact state token — and on retry compares against ITS OWN copy only.
//
// WHAT THE CONTRACT CANNOT KNOW, stated rather than guessed: it cannot know
// a human was present, saw the dialog, or clicked anything. All it can know
// is that the state it issued came back byte-identical, within its expiry,
// bound to the identical tool and arguments, and unused. The allow evidence
// says exactly that and marks human presence "unknown".
const crypto = require("node:crypto");
const { canonicalString, sha256Hex } = require("./canonical.cjs");
const { renderApprovalMessage } = require("./renderer.cjs");

const STATE_PREFIX = "seal-approval-v1";
const STATE_PATTERN = /^seal-approval-v1:([0-9a-f]{16}):([0-9a-f]{32})$/;

// Every refusal is distinct (standing rule: absent, unreadable, malformed,
// expired and never-answered are findings, never approvals, each named).
const REFUSALS = Object.freeze({
  UNRENDERABLE: "unrenderable_effect",
  STATE_MALFORMED: "state_malformed",
  UNKNOWN_REQUEST: "unknown_request",
  STATE_ALTERED: "state_altered",
  ALREADY_CONSUMED: "already_consumed",
  TERMINALLY_DECLINED: "terminally_declined",
  CANCELLED: "cancelled",
  EXPIRED: "expired",
  TOOL_ALTERED: "tool_altered",
  ARGUMENTS_ALTERED: "arguments_altered",
  RESPONSE_MALFORMED: "response_malformed",
  DECLINED: "declined",
});

function createApprovalContract({ now = () => Date.now(), ttlMs = 120000, terminalWidth = 80 } = {}) {
  const pendingById = new Map(); // id -> the contract's OWN copy, the only source of truth

  function refuse(refusal, detail) {
    return { kind: "refuse", refusal, detail };
  }

  // First tools/call for a guarded effect: either offer approval through the
  // client's renderer, or refuse to offer because the complete effect cannot
  // be shown inside the measured envelope.
  function begin({ tool, args }) {
    const rendered = renderApprovalMessage(tool, args, { terminalWidth });
    if (!rendered.ok) return refuse(REFUSALS.UNRENDERABLE, rendered.reason);

    const id = crypto.randomBytes(8).toString("hex");
    const token = crypto.randomBytes(16).toString("hex");
    const issuedAt = now();
    const record = {
      id,
      token,
      tool,
      argsSha256: sha256Hex(canonicalString(args ?? {})),
      issuedAt,
      expiresAt: issuedAt + ttlMs,
      status: "pending", // pending | consumed | declined | cancelled | expired
    };
    pendingById.set(id, record);

    return {
      kind: "input_required",
      result: {
        resultType: "input_required",
        inputRequests: {
          approval: {
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
        requestState: `${STATE_PREFIX}:${id}:${token}`,
      },
    };
  }

  // The retry: a FRESH tools/call carrying client-supplied requestState and
  // inputResponses. Every binding below compares to the contract's own
  // record; nothing client-supplied is trusted on its own.
  function retry({ tool, args, requestState, inputResponses }) {
    const match = typeof requestState === "string" ? requestState.match(STATE_PATTERN) : null;
    if (!match) return refuse(REFUSALS.STATE_MALFORMED, "requestState is not a state this contract ever issues");
    const [, id, token] = match;

    const record = pendingById.get(id);
    if (!record) return refuse(REFUSALS.UNKNOWN_REQUEST, "no request with this id was ever issued by this contract");
    if (token !== record.token) return refuse(REFUSALS.STATE_ALTERED, "requestState does not match the state this contract issued");

    if (record.status === "consumed") return refuse(REFUSALS.ALREADY_CONSUMED, "this approval was one-use and has already admitted a call");
    if (record.status === "declined") return refuse(REFUSALS.TERMINALLY_DECLINED, "this request was declined; denial is terminal");
    if (record.status === "cancelled") return refuse(REFUSALS.CANCELLED, "this request was cancelled");
    if (now() > record.expiresAt) {
      record.status = "expired";
      return refuse(REFUSALS.EXPIRED, "the approval window closed before the retry arrived");
    }

    if (tool !== record.tool) return refuse(REFUSALS.TOOL_ALTERED, "the retry names a different tool than the one bound at issue time");
    let argsSha;
    try {
      argsSha = sha256Hex(canonicalString(args ?? {}));
    } catch (error) {
      return refuse(REFUSALS.ARGUMENTS_ALTERED, `retry arguments have no canonical form: ${error.message}`);
    }
    if (argsSha !== record.argsSha256) {
      return refuse(REFUSALS.ARGUMENTS_ALTERED, "the retry arguments differ from the exact arguments shown for approval");
    }

    const answer = inputResponses?.approval;
    if (!answer || typeof answer.action !== "string") {
      return refuse(REFUSALS.RESPONSE_MALFORMED, "inputResponses carries no readable approval answer");
    }
    if (answer.action === "decline") {
      record.status = "declined";
      return refuse(REFUSALS.DECLINED, "the answer was decline; denial is terminal for this request");
    }
    if (answer.action === "cancel") {
      record.status = "cancelled";
      return refuse(REFUSALS.CANCELLED, "the answer was cancel");
    }
    if (answer.action !== "accept" || answer.content?.approve !== true) {
      return refuse(REFUSALS.RESPONSE_MALFORMED, "the answer is neither accept, decline, nor cancel with a readable approve value");
    }

    // One-use consumption happens HERE, before the caller may forward
    // anything: a crash after this point loses an approval, never gains a
    // second call.
    record.status = "consumed";
    record.consumedAt = now();

    return {
      kind: "allow",
      evidence: {
        state_returned_unaltered: true,
        arguments_match_bound_copy: true,
        within_expiry: true,
        one_use_consumed_now: true,
        // The honest limit: the contract observed none of the client's UI.
        human_present: "unknown",
        human_present_detail:
          "the contract cannot observe the client's dialog; it knows only that the state it issued returned unaltered, in time, bound to the identical effect, and unused",
      },
    };
  }

  return { begin, retry, REFUSALS };
}

module.exports = { createApprovalContract, REFUSALS };
