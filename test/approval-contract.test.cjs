// SPDX-License-Identifier: Apache-2.0
// Fixtures for the approval contract (roadmap step 1, brief contract1).
//
// Evidence rule, inherited from the spine acceptance test: whether the child
// received bytes is read from the CHILD'S OWN count file, never inferred
// from what the server-side code printed or returned. Every refusal fixture
// asserts the count file afterwards.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const readline = require("node:readline");
const { spawn } = require("node:child_process");
const test = require("node:test");

const { createApprovalContract, REFUSALS } = require("../contract/contract.cjs");
const { renderApprovalMessage, MESSAGE_LINE_CAP, WIDTH_MARGIN, displayWidth } = require("../contract/renderer.cjs");
const { canonicalString } = require("../contract/canonical.cjs");

const CHILD = path.join(__dirname, "..", "contract", "fixtures", "counting-child.cjs");

// --- child harness ----------------------------------------------------------

async function startChild(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "seal-contract-"));
  const dataFile = path.join(dir, "data.txt");
  const countFile = `${dataFile}.count`;
  const child = spawn(process.execPath, [CHILD, dataFile], { stdio: ["pipe", "pipe", "inherit"] });
  t.after(() => { try { child.kill("SIGKILL"); } catch {} });
  const replies = [];
  readline.createInterface({ input: child.stdout, terminal: false }).on("line", (line) => replies.push(line));
  // Wait for the child to have created its count file before any fixture reads it.
  const started = Date.now();
  while (!fs.existsSync(countFile)) {
    if (Date.now() - started > 5000) throw new Error("child never created its count file");
    await new Promise((r) => setTimeout(r, 20));
  }
  return {
    count: () => fs.readFileSync(countFile, "utf8").trim(),
    async deliver(text) {
      const before = replies.length;
      child.stdin.write(text + "\n");
      const t0 = Date.now();
      while (replies.length === before) {
        if (Date.now() - t0 > 5000) throw new Error("child never answered");
        await new Promise((r) => setTimeout(r, 10));
      }
      return replies[replies.length - 1];
    },
  };
}

// The server side of a fixture: decide with the contract; forward to the
// child ONLY on allow. This is the exact consumption pattern step 2 wires
// into the proxy.
async function attempt(contract, child, { tool, args, requestState, inputResponses }) {
  const decision = requestState === undefined && inputResponses === undefined
    ? contract.begin({ tool, args })
    : contract.retry({ tool, args, requestState, inputResponses });
  if (decision.kind === "allow") {
    await child.deliver(JSON.stringify({ tool, args }));
  }
  return decision;
}

const TOOL = "demo.mutate";
const ARGS = { line: "contract fixture line" };
const ACCEPT = { approval: { action: "accept", content: { approve: true } } };

function freshPending(contract) {
  const opened = contract.begin({ tool: TOOL, args: ARGS });
  assert.equal(opened.kind, "input_required");
  assert.equal(opened.result.resultType, "input_required");
  return opened.result.requestState;
}

// --- the five refusals ------------------------------------------------------

test("refusal 1: altered arguments on the retry; child receives nothing", async (t) => {
  const child = await startChild(t);
  const contract = createApprovalContract();
  const state = freshPending(contract);
  const decision = await attempt(contract, child, {
    tool: TOOL, args: { line: "a different effect entirely" },
    requestState: state, inputResponses: ACCEPT,
  });
  assert.equal(decision.kind, "refuse");
  assert.equal(decision.refusal, REFUSALS.ARGUMENTS_ALTERED);
  assert.equal(child.count(), "0");
});

test("refusal 2: altered requestState; child receives nothing", async (t) => {
  const child = await startChild(t);
  const contract = createApprovalContract();
  const state = freshPending(contract);
  const tampered = state.slice(0, -1) + (state.endsWith("0") ? "1" : "0"); // flip last token char
  const decision = await attempt(contract, child, {
    tool: TOOL, args: ARGS, requestState: tampered, inputResponses: ACCEPT,
  });
  assert.equal(decision.kind, "refuse");
  assert.equal(decision.refusal, REFUSALS.STATE_ALTERED);
  assert.equal(child.count(), "0");
});

test("refusal 3: replayed approval already consumed; child stays at exactly 1", async (t) => {
  const child = await startChild(t);
  const contract = createApprovalContract();
  const state = freshPending(contract);
  const first = await attempt(contract, child, { tool: TOOL, args: ARGS, requestState: state, inputResponses: ACCEPT });
  assert.equal(first.kind, "allow");
  assert.equal(child.count(), "1");
  const replay = await attempt(contract, child, { tool: TOOL, args: ARGS, requestState: state, inputResponses: ACCEPT });
  assert.equal(replay.kind, "refuse");
  assert.equal(replay.refusal, REFUSALS.ALREADY_CONSUMED);
  assert.equal(child.count(), "1", "the one-use approval must not admit a second delivery");
});

test("refusal 4: expired approval; child receives nothing", async (t) => {
  const child = await startChild(t);
  let clock = 1_000_000;
  const contract = createApprovalContract({ now: () => clock, ttlMs: 120_000 });
  const state = freshPending(contract);
  clock += 120_001; // one millisecond past the window
  const decision = await attempt(contract, child, { tool: TOOL, args: ARGS, requestState: state, inputResponses: ACCEPT });
  assert.equal(decision.kind, "refuse");
  assert.equal(decision.refusal, REFUSALS.EXPIRED);
  assert.equal(child.count(), "0");
});

test("refusal 5: approval claimed for a request the contract never issued; child receives nothing", async (t) => {
  const child = await startChild(t);
  const contract = createApprovalContract();
  freshPending(contract); // a real pending request exists, but the claim names another
  const fabricated = `seal-approval-v1:${"ab".repeat(8)}:${"cd".repeat(16)}`;
  const decision = await attempt(contract, child, {
    tool: TOOL, args: ARGS, requestState: fabricated, inputResponses: ACCEPT,
  });
  assert.equal(decision.kind, "refuse");
  assert.equal(decision.refusal, REFUSALS.UNKNOWN_REQUEST);
  assert.equal(child.count(), "0");
});

test("the five refusals are five distinct names", () => {
  const five = [REFUSALS.ARGUMENTS_ALTERED, REFUSALS.STATE_ALTERED, REFUSALS.ALREADY_CONSUMED, REFUSALS.EXPIRED, REFUSALS.UNKNOWN_REQUEST];
  assert.equal(new Set(five).size, 5);
});

// --- terminal denial, cancel, malformed ------------------------------------

test("decline is terminal: a later accept on the same state is refused distinctly", async (t) => {
  const child = await startChild(t);
  const contract = createApprovalContract();
  const state = freshPending(contract);
  const declined = await attempt(contract, child, {
    tool: TOOL, args: ARGS, requestState: state,
    inputResponses: { approval: { action: "decline" } },
  });
  assert.equal(declined.refusal, REFUSALS.DECLINED);
  const afterDecline = await attempt(contract, child, { tool: TOOL, args: ARGS, requestState: state, inputResponses: ACCEPT });
  assert.equal(afterDecline.refusal, REFUSALS.TERMINALLY_DECLINED);
  assert.equal(child.count(), "0");
});

test("malformed state and malformed answer refuse with their own names", async (t) => {
  const child = await startChild(t);
  const contract = createApprovalContract();
  const state = freshPending(contract);
  const malformedState = await attempt(contract, child, { tool: TOOL, args: ARGS, requestState: "not-a-state", inputResponses: ACCEPT });
  assert.equal(malformedState.refusal, REFUSALS.STATE_MALFORMED);
  const malformedAnswer = await attempt(contract, child, { tool: TOOL, args: ARGS, requestState: state, inputResponses: { approval: {} } });
  assert.equal(malformedAnswer.refusal, REFUSALS.RESPONSE_MALFORMED);
  // A claimed accept without approve=true is not an approval either.
  const hollowAccept = await attempt(contract, child, {
    tool: TOOL, args: ARGS, requestState: state,
    inputResponses: { approval: { action: "accept", content: {} } },
  });
  assert.equal(hollowAccept.refusal, REFUSALS.RESPONSE_MALFORMED);
  assert.equal(child.count(), "0");
});

test("allow evidence states the limit: human presence is unknown", async (t) => {
  const child = await startChild(t);
  const contract = createApprovalContract();
  const state = freshPending(contract);
  const decision = await attempt(contract, child, { tool: TOOL, args: ARGS, requestState: state, inputResponses: ACCEPT });
  assert.equal(decision.kind, "allow");
  assert.equal(decision.evidence.human_present, "unknown");
  assert.match(decision.evidence.human_present_detail, /cannot observe the client's dialog/);
});

// --- the rendering envelope, measured --------------------------------------

function assertInsideEnvelope(rendered, terminalWidth = 80) {
  assert.ok(rendered.ok, rendered.reason);
  assert.ok(rendered.lines.length <= MESSAGE_LINE_CAP,
    `rendered message has ${rendered.lines.length} lines; the envelope is ${MESSAGE_LINE_CAP}`);
  for (const line of rendered.lines) {
    assert.ok(displayWidth(line) <= terminalWidth - WIDTH_MARGIN,
      `line exceeds usable width ${terminalWidth - WIDTH_MARGIN}: ${line}`);
  }
}

test("the approval message fits seven lines at 80 columns and carries the required content", () => {
  const rendered = renderApprovalMessage(TOOL, ARGS);
  assertInsideEnvelope(rendered);
  assert.match(rendered.message, /demo\.mutate/);
  assert.ok(rendered.message.includes(canonicalString(ARGS)), "the EXACT canonical arguments must appear");
  assert.match(rendered.message, /once/);
  assert.match(rendered.message, /outside Seal/);
});

test("an effect that cannot be shown completely is refused, not truncated — and begin() refuses to offer it", async (t) => {
  const child = await startChild(t);
  const bigArgs = { line: "x".repeat(400) };
  const rendered = renderApprovalMessage(TOOL, bigArgs);
  assert.equal(rendered.ok, false);
  assert.match(rendered.reason, /hides the rest without any indicator/);
  const contract = createApprovalContract();
  const decision = contract.begin({ tool: TOOL, args: bigArgs });
  assert.equal(decision.kind, "refuse");
  assert.equal(decision.refusal, REFUSALS.UNRENDERABLE);
  assert.equal(child.count(), "0");
});

test("a terminal too narrow for the fixed lines refuses instead of overflowing", () => {
  const rendered = renderApprovalMessage(TOOL, ARGS, { terminalWidth: 40 });
  assert.equal(rendered.ok, false);
});

test("every offered message obeys the envelope across argument sizes", () => {
  for (let n = 1; n <= 300; n += 7) {
    const rendered = renderApprovalMessage(TOOL, { line: "y".repeat(n) });
    if (rendered.ok) assertInsideEnvelope(rendered);
    else assert.match(rendered.reason, /lines|columns/);
  }
});
