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
const { testTmpdir } = require("../scripts/temp-root.cjs");

const { createApprovalContract, REFUSALS } = require("../contract/contract.cjs");
const { renderApprovalMessage, MESSAGE_LINE_CAP } = require("../contract/renderer.cjs");
const { canonicalString, sha256Hex } = require("../contract/canonical.cjs");
const { canonical, generateSigner, sealReceipt } = require("../spine/receipt-v2.cjs");

const CHILD = path.join(__dirname, "..", "contract", "fixtures", "counting-child.cjs");

// --- child harness ----------------------------------------------------------

async function startChild(t) {
  const dir = testTmpdir(path.join(os.tmpdir(), "seal-contract-"));
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
  assert.deepEqual(opened.result.content, [{
    type: "text",
    text: opened.elicitationParams.message,
  }]);
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
  const tampered = state.slice(0, -1) + (state.endsWith("0") ? "1" : "0"); // flip last handle char
  const decision = await attempt(contract, child, {
    tool: TOOL, args: ARGS, requestState: tampered, inputResponses: ACCEPT,
  });
  assert.equal(decision.kind, "refuse");
  // Opaque handle: an altered handle is a lookup miss, indistinguishable by
  // design from a never-issued one — the client is incapable, not detectable.
  assert.equal(decision.refusal, REFUSALS.UNKNOWN_STATE);
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
  const fabricated = `seal-rs1.${"ab".repeat(32)}`;
  const decision = await attempt(contract, child, {
    tool: TOOL, args: ARGS, requestState: fabricated, inputResponses: ACCEPT,
  });
  assert.equal(decision.kind, "refuse");
  assert.equal(decision.refusal, REFUSALS.UNKNOWN_STATE);
  assert.equal(child.count(), "0");
});

test("the refusal names are distinct; altered and never-issued deliberately share one", () => {
  // With an opaque random handle nothing meaningful crosses the wire, so an
  // altered handle IS an unknown handle: four distinct names cover the five
  // forgery fixtures, and the sharing is by design (spine2 addendum).
  const names = [REFUSALS.ARGUMENTS_ALTERED, REFUSALS.UNKNOWN_STATE, REFUSALS.ALREADY_CONSUMED, REFUSALS.EXPIRED];
  assert.equal(new Set(names).size, 4);
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
  assert.match(decision.evidence.human_present_detail, /can fabricate an accepting elicitation response/);
  assert.match(decision.evidence.human_present_detail, /declared assumption, not an enforced property/);
});

test("separate one-use grants for the same effect have distinct signed receipt bytes", () => {
  const contract = createApprovalContract({ now: () => 5_000_000 });
  const firstHandle = freshPending(contract);
  const first = contract.retry({
    tool: TOOL, args: ARGS, requestState: firstHandle, inputResponses: ACCEPT,
  });
  const secondHandle = freshPending(contract);
  const second = contract.retry({
    tool: TOOL, args: ARGS, requestState: secondHandle, inputResponses: ACCEPT,
  });
  assert.equal(first.kind, "allow");
  assert.equal(second.kind, "allow");
  assert.notEqual(firstHandle, secondHandle);
  assert.equal(first.receipt.kernel_inputs.approval_handle_sha256, sha256Hex(firstHandle));
  assert.equal(second.receipt.kernel_inputs.approval_handle_sha256, sha256Hex(secondHandle));

  const signer = generateSigner();
  const firstBytes = canonical(sealReceipt(signer, first.receipt, "ALLOW"));
  const secondBytes = canonical(sealReceipt(signer, second.receipt, "ALLOW"));
  assert.notEqual(sha256Hex(firstBytes), sha256Hex(secondBytes));
});

// --- the rendering envelope, measured --------------------------------------

function assertInsideEnvelope(rendered) {
  assert.ok(rendered.ok, rendered.reason);
  assert.deepEqual(rendered.lines, rendered.message.split("\n"));
  assert.ok(rendered.lines.length <= MESSAGE_LINE_CAP,
    `rendered message has ${rendered.lines.length} lines; the envelope is ${MESSAGE_LINE_CAP}`);
}

test("the approval message is the fixed dialog and fits the envelope", () => {
  const rendered = renderApprovalMessage(TOOL, ARGS);
  assertInsideEnvelope(rendered);
  assert.deepEqual(rendered.lines, [
    "Tool: demo.mutate; Approval required",
    `  line: ${canonicalString(ARGS.line)}`,
    "Scope: this parsed call (key order, 1/1.0 match); at most one run; 2 min.",
    "Outside Seal: Bash, network, subprocesses, other tools and servers.",
  ]);
  assert.equal(rendered.lines.length, 4);
});

test("the envelope promises logical message lines, not client-specific visible rows", () => {
  const rendered = renderApprovalMessage(TOOL, { line: "x".repeat(400) });
  assertInsideEnvelope(rendered);
  for (const width of [80, 60, 40, 120]) {
    assert.equal(renderApprovalMessage(TOOL, { line: "x".repeat(400) }, { terminalWidth: width }).ok, true);
  }
});

test("the approval schema description derives from the actual argument lines", () => {
  const args = { zeta: 7, alpha: "value with space" };
  const rendered = renderApprovalMessage(TOOL, args);
  const opened = createApprovalContract().begin({ tool: TOOL, args });
  assert.deepEqual(rendered.argLines, ["  alpha: \"value with space\"", "  zeta: 7"]);
  assert.equal(
    opened.elicitationParams.requestedSchema.properties.approve.description,
    "Arguments: alpha: \"value with space\"; zeta: 7. Scope: this parsed call (key order, 1/1.0 match); at most one run; 2 min. Outside Seal: Bash, network, subprocesses, other tools and servers.",
  );
  const customTtl = createApprovalContract({ ttlMs: 90000 }).begin({ tool: TOOL, args });
  assert.equal(customTtl.elicitationParams.requestedSchema.properties.approve.description,
    opened.elicitationParams.requestedSchema.properties.approve.description.replace("2 min.", "90 s."));
});

test("the approval schema description ignores non-argument message lines", () => {
  const rendererPath = require.resolve("../contract/renderer.cjs");
  const contractPath = require.resolve("../contract/contract.cjs");
  const originalRenderer = require(rendererPath);
  const shiftedRenderer = {
    ...originalRenderer,
    renderApprovalMessage(...args) {
      const rendered = originalRenderer.renderApprovalMessage(...args);
      if (!rendered.ok) return rendered;
      const lines = ["Review context", ...rendered.lines];
      return { ...rendered, message: lines.join("\n"), lines };
    },
  };
  let createShiftedApprovalContract;
  try {
    require.cache[rendererPath].exports = shiftedRenderer;
    delete require.cache[contractPath];
    ({ createApprovalContract: createShiftedApprovalContract } = require(contractPath));
  } finally {
    require.cache[rendererPath].exports = originalRenderer;
    delete require.cache[contractPath];
  }

  const args = { line: "shifted shape" };
  const rendered = shiftedRenderer.renderApprovalMessage(TOOL, args);
  const opened = createShiftedApprovalContract().begin({ tool: TOOL, args });
  const description = `Arguments: ${rendered.argLines.map((line) => line.trim()).join("; ")}. Scope: this parsed call (key order, 1/1.0 match); at most one run; 2 min. Outside Seal: Bash, network, subprocesses, other tools and servers.`;
  assert.equal(opened.elicitationParams.requestedSchema.properties.approve.description, description);
});

test("a CHANGED first line replaces, never adds", () => {
  const rendered = renderApprovalMessage(TOOL, ARGS, { firstLine: "CHANGED: line fixture → other" });
  assertInsideEnvelope(rendered);
  assert.equal(rendered.lines[0], "Tool: demo.mutate; CHANGED: line fixture → other");
  assert.equal(rendered.lines.length, 4);
});

test("an effect that cannot be shown completely is refused, not truncated — and begin() refuses to offer it", async (t) => {
  const child = await startChild(t);
  const bigArgs = { line: "x".repeat(400) };
  const rendered = renderApprovalMessage(TOOL, bigArgs);
  assert.equal(rendered.ok, true, rendered.reason);
  const contract = createApprovalContract();
  const decision = contract.begin({ tool: TOOL, args: bigArgs });
  assert.equal(decision.kind, "input_required");
  assert.equal(child.count(), "0");
  const atLimit = renderApprovalMessage(TOOL, { a: 1, b: 2, c: 3, d: 4 });
  assertInsideEnvelope(atLimit);
  assert.equal(atLimit.lines.length, MESSAGE_LINE_CAP);
  const overLimit = contract.begin({ tool: TOOL, args: { a: 1, b: 2, c: 3, d: 4, e: 5 } });
  assert.equal(overLimit.kind, "refuse");
  assert.equal(overLimit.refusal, REFUSALS.UNRENDERABLE);
  assert.match(overLimit.detail, /need 8 lines; Seal permits 7/);
  assert.equal(overLimit.elicitationParams, undefined);
  assert.equal(child.count(), "0");
});

test("every offered message obeys the envelope across argument sizes", () => {
  for (let n = 1; n <= 300; n += 7) {
    const rendered = renderApprovalMessage(TOOL, { line: "y".repeat(n) });
    if (rendered.ok) assertInsideEnvelope(rendered);
    else assert.match(rendered.reason, /lines/);
  }
});

// --- the two lifetimes and the hash-only journal (spine2 addendum) ----------

const { createJournal, openJournal } = require("../spine/store.cjs");

test("the journal stores the handle hash, never the raw handle", () => {
  const dir = testTmpdir(path.join(os.tmpdir(), "seal-contract-journal-"));
  const storePath = path.join(dir, "approvals.journal");
  createJournal(storePath);
  const contract = createApprovalContract({ store: openJournal(storePath) });
  const opened = contract.begin({ tool: TOOL, args: ARGS });
  const handle = opened.result.requestState;
  const journalText = fs.readFileSync(storePath, "utf8");
  assert.ok(!journalText.includes(handle), "the raw handle must never be persisted");
  assert.ok(!journalText.includes(handle.slice("seal-rs1.".length)), "nor its hex body");
  const { sha256Hex } = require("../contract/canonical.cjs");
  assert.ok(journalText.includes(sha256Hex(handle)), "the handle hash must be persisted");
});

test("consumed survives a restart; pending does not (connection epoch)", async (t) => {
  const child = await startChild(t);
  const dir = testTmpdir(path.join(os.tmpdir(), "seal-contract-epoch-"));
  const storePath = path.join(dir, "approvals.journal");
  createJournal(storePath);

  // "Process" A: one continuation consumed, one left pending.
  const a = createApprovalContract({ store: openJournal(storePath) });
  const consumedState = a.begin({ tool: TOOL, args: ARGS }).result.requestState;
  const consumed = await attempt(a, child, { tool: TOOL, args: ARGS, requestState: consumedState, inputResponses: ACCEPT });
  assert.equal(consumed.kind, "allow");
  assert.equal(child.count(), "1");
  const pendingState = a.begin({ tool: TOOL, args: ARGS }).result.requestState;

  // "Process" B: a fresh contract (new connection epoch) on the SAME journal.
  const b = createApprovalContract({ store: openJournal(storePath) });
  const replay = await attempt(b, child, { tool: TOOL, args: ARGS, requestState: consumedState, inputResponses: ACCEPT });
  assert.equal(replay.refusal, REFUSALS.ALREADY_CONSUMED, "a one-use rule that forgets on restart is not one use");
  const stale = await attempt(b, child, { tool: TOOL, args: ARGS, requestState: pendingState, inputResponses: ACCEPT });
  assert.equal(stale.refusal, REFUSALS.RESTART_INVALIDATED, "a pending continuation must not survive a restart");
  assert.equal(child.count(), "1", "neither refusal may touch the child");
});

test("presentation measurement counts physical rows, including hidden line separators", () => {
  const { measureApprovalMessage } = require('../contract/renderer.cjs');
  for (const separator of ['\n', '\r', '\r\n', '\u0085', '\u2028', '\u2029']) {
    const measured = measureApprovalMessage(Array(8).fill('a').join(separator));
    assert.equal(measured.ok, false, `8 physical rows separated by ${JSON.stringify(separator)}`);
    assert.match(measured.reason, /need 8 lines/);
  }
});

test("presentation preserves JSON scalar types while keeping ordinary strings readable", () => {
  for (const value of [100, 0, -1, true, false, null]) {
    const string = createApprovalContract().begin({ tool: TOOL, args: { amount: String(value) } });
    const scalar = createApprovalContract().begin({ tool: TOOL, args: { amount: value } });
    assert.notEqual(string.elicitationParams.message, scalar.elicitationParams.message);
    assert.notEqual(string.elicitationParams.requestedSchema.properties.approve.description,
      scalar.elicitationParams.requestedSchema.properties.approve.description);
  }
  for (const value of ['100', '1e2', '-0', 'true', 'false', 'null']) {
    assert.equal(renderApprovalMessage(TOOL, { amount: value }).argLines[0], `  amount: ${JSON.stringify(value)}`);
  }
  assert.equal(renderApprovalMessage(TOOL, { table: 'customers' }).argLines[0], '  table: customers');
});

test("presentation escapes bidi controls but preserves shaping characters", () => {
  const { renderName } = require('../contract/renderer.cjs');
  for (const ch of ['\n', '\r', '\t', '\x1b', '\x7f', '\u0085', '\u061c', '\u200e', '\u202e', '\u2066', '\u2028', '\u2029']) {
    const name = `a${ch}b`;
    const opened = createApprovalContract().begin({ tool: name, args: { [name]: ch } });
    assert.equal(opened.kind, 'input_required');
    const params = opened.elicitationParams;
    assert.ok(!params.message.includes(name), JSON.stringify(ch));
    assert.ok(params.message.includes(renderName(name)));
    assert.equal(params.requestedSchema.properties.approve.title, `Approve one run: ${renderName(name)}`);
    assert.ok(!params.requestedSchema.properties.approve.description.includes(ch));
    assert.notEqual(renderName(name), renderName(`a\\u${ch.codePointAt(0).toString(16).padStart(4, '0')}b`));
  }
  const args = { café: 'first\nsecond', 客户: 'customers', c: 3, d: 4 };
  const rendered = renderApprovalMessage('工具', args);
  assertInsideEnvelope(rendered);
  assert.ok(rendered.message.includes('café: "first\\nsecond"'));
  assert.ok(rendered.message.includes('客户: customers'));
  assert.equal(createApprovalContract().begin({ tool: '工具', args }).kind, 'input_required');
  const persian = 'می‌روم';
  const indic = 'क्‍ष';
  const emoji = '👩‍💻';
  for (const name of [persian, indic]) {
    assert.equal(renderName(name), name);
    assert.ok(renderApprovalMessage(name, { name }).message.includes(name));
  }
  assert.ok(renderApprovalMessage(TOOL, { emoji }).message.includes(emoji));
  for (const ch of ['\u061c', '\u200e', '\u200f', '\u202a', '\u202b', '\u202c', '\u202d', '\u202e', '\u2066', '\u2067', '\u2068', '\u2069']) {
    assert.ok(!renderName(`a${ch}b`).includes(ch), `bidi control ${JSON.stringify(ch)} must be escaped`);
  }
});
