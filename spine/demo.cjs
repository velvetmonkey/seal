// SPDX-License-Identifier: Apache-2.0
// `seal demo` — wired ON TOP of the shared retry-model spine. The demo is
// the proxy protecting this binary's own hidden MCP server; the demo process
// plays the CLIENT role of the retry protocol: it receives input_required,
// displays the contract's message, collects the answer, and sends the fresh
// retry call. That display-and-answer duty is the whole renderer role here —
// the effect, the scope, the approval record and the execute/refuse decision
// all live in the proxy and its contract.
// Every count printed is read back from the child's count file, never
// assumed from flow.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const readline = require("node:readline");

const { createProxy, StoreError } = require("./proxy.cjs");
const { createJournal } = require("./store.cjs");
const { requireSupportedPlatform } = require("./platform.cjs");
const { TOOL } = require("./demo-server.cjs");

const DEMO_LINE = process.env.SEAL_DEMO_LINE || "seal spine demo wrote this line";

function fail(message) {
  process.stderr.write(`seal: ${message}\n`);
  process.exit(1);
}

function readCount(countFile) {
  return fs.readFileSync(countFile, "utf8").trim();
}

async function waitForFile(filePath, ms = 5000) {
  const started = Date.now();
  while (!fs.existsSync(filePath)) {
    if (Date.now() - started > ms) fail(`the demo child never created ${filePath}; nothing to observe`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

function ask(question) {
  return new Promise((resolve) => {
    const input = readline.createInterface({ input: process.stdin, output: process.stdout });
    let answered = false;
    input.once("line", (line) => { answered = true; input.close(); resolve({ kind: "answer", value: line.trim().toLowerCase() }); });
    input.once("close", () => { if (!answered) resolve({ kind: "eof" }); });
    input.output.write(question);
  });
}

async function run(argv, sealBinPath) {
  requireSupportedPlatform();
  let dir;
  const dirIndex = argv.indexOf("--dir");
  if (dirIndex !== -1) {
    dir = argv[dirIndex + 1];
    if (!dir) fail("--dir needs a path");
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  } else {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "seal-demo-"));
  }
  const dataFile = path.join(dir, "child", "data.txt");
  const countFile = `${dataFile}.count`;
  const storePath = path.join(dir, "approvals.journal");

  const pendingById = new Map();
  const receiptPaths = [];

  let proxy;
  try {
    createJournal(storePath); // deliberate init: absent-at-gate-time is a refusal
    proxy = createProxy({
      guardTool: TOOL,
      storePath,
      receiptsDir: path.join(dir, "receipts"),
      childArgv: [process.execPath, sealBinPath, "__demo-server", dataFile],
      onClientLine: (line) => {
        const frame = JSON.parse(line);
        const resolve = pendingById.get(frame.id);
        if (resolve) { pendingById.delete(frame.id); resolve(frame); }
      },
      onDecision: ({ receiptPath }) => receiptPaths.push(receiptPath),
      onChildExit: (code) => { if (code !== 0 && code !== null) fail(`the demo child exited ${code} mid-run`); },
    });
  } catch (error) {
    if (error instanceof StoreError) fail(error.message);
    throw error;
  }

  let nextId = 0;
  function send(method, params) {
    nextId += 1;
    const id = nextId;
    const promise = new Promise((resolve) => pendingById.set(id, resolve));
    proxy.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
    return promise;
  }
  const baseParams = () => ({ name: TOOL, arguments: { line: DEMO_LINE } });
  const retryParams = (requestState, action, content) => ({
    ...baseParams(), requestState,
    inputResponses: { approval: content === undefined ? { action } : { action, content } },
  });

  async function stopAnd(exitCode) {
    await proxy.stop();
    process.exit(exitCode);
  }

  console.log("seal spine demo — one shared proxy, one hidden child, one real file");
  await waitForFile(countFile);

  await send("initialize", { protocolVersion: "2026-07-28" });
  const listed = await send("tools/list", {});
  for (const tool of listed.result?.tools || []) {
    // Dash rule: only the guarded tool earns a word; anything else is a dash.
    console.log(`tool      ${tool.name}  ${tool.name === TOOL ? "guarded" : "—"}`);
  }
  console.log(`child     seal __demo-server (this same binary) mutating ${dataFile}`);

  const before = readCount(countFile);
  if (before !== "0") fail(`expected a fresh child at 0 observed calls, count file reads ${before}`);
  console.log(`child calls observed: ${before} (read from ${countFile})`);

  const opened = await send("tools/call", baseParams());
  if (opened.result?.resultType !== "input_required") {
    fail(`expected input_required from the shared proxy, got: ${JSON.stringify(opened).slice(0, 200)}`);
  }
  const requestState = opened.result.requestState;
  const message = opened.result.inputRequests?.approval?.params?.message;
  if (typeof message !== "string") fail("input_required carried no approval message to display");
  console.log("INPUT REQUIRED  the proxy holds this call's approval; the contract's message:");
  console.log(message.split("\n").map((line) => `    ${line}`).join("\n"));

  const answer = await ask("Approve? [y/N] ");
  if (answer.kind === "eof") {
    process.stderr.write("seal: no approval response received (EOF); nothing was approved.\n");
    await proxy.stop();
    process.exit(1);
  }
  if (answer.value !== "y") {
    const declined = await send("tools/call", retryParams(requestState, "decline"));
    const text = declined.result?.content?.[0]?.text || "";
    const count = readCount(countFile);
    console.log(`DECLINED  the proxy refused the retry: "${text}"`);
    console.log(`demo stopped; nothing was approved and the child received ${count} calls (read from ${countFile})`);
    return stopAnd(count === "0" ? 0 : 1);
  }

  const flowed = await send("tools/call", retryParams(requestState, "accept", { approve: true }));
  if (flowed.result?.isError) fail(`the approved retry was refused: "${flowed.result.content[0].text}"`);
  console.log(`child replied through the shared proxy: "${flowed.result.content[0].text}"`);
  const after = readCount(countFile);
  if (after !== "1") fail(`the child's own count file reads ${after}, not 1; refusing to describe this as a single call`);
  console.log(`child calls observed: ${after} (read from ${countFile})`);

  console.log("replaying the identical retry with the same requestState…");
  const replayed = await send("tools/call", retryParams(requestState, "accept", { approve: true }));
  if (replayed.result?.isError !== true) fail("the replayed retry flowed; one-use was NOT enforced — this is a defect");
  const finalCount = readCount(countFile);
  if (finalCount !== "1") fail(`after the replay the child's count file reads ${finalCount}, not 1`);
  console.log(`BLOCKED   the shared proxy refused the replay: "${replayed.result.content[0].text}"`);
  console.log(`one-use enforced: the consumed approval admitted no second call; child calls observed: still ${finalCount} (read from ${countFile})`);

  await proxy.stop();
  for (const receiptPath of receiptPaths) console.log(`receipt written: ${receiptPath}`);
  console.log("receipts are claims, not proofs: checking them belongs in a separate tool, and this binary does not do it.");
  process.exit(0);
}

module.exports = { run };
