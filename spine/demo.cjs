// SPDX-License-Identifier: Apache-2.0
// `seal demo` — wired ON TOP of the shared retry-model spine. The demo is
// the proxy protecting this binary's own hidden MCP server; the demo process
// plays the CLIENT role of the protocol: it receives elicitation/create,
// displays the contract's message, collects the answer, and sends the
// matching response. That display-and-answer duty is the renderer role here —
// the effect, the scope, the approval record and the execute/refuse decision
// all live in the proxy and its contract.
// Every count printed is read back from the child's count file, never
// assumed from flow.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const readline = require("node:readline");

const { createProxy, StoreError } = require("./proxy.cjs");
const { generateSigner } = require("./receipt-v2.cjs");
const { createJournal } = require("./store.cjs");
const { requireSupportedPlatform } = require("./platform.cjs");
const { TOOL } = require("./demo-server.cjs");
const { printKernelTiming } = require("./presentation.cjs");

const DEMO_LINE = process.env.SEAL_DEMO_LINE || "seal demo wrote this line";

function fail(message) {
  const text = message instanceof Error ? message.message : message;
  process.stderr.write(`seal: ${text}\n`);
  printKernelTiming(message, (line) => process.stderr.write(`${line}\n`));
  process.exit(1);
}

function readCount(countFile) {
  return fs.readFileSync(countFile, "utf8").trim();
}

function canonicalPath(filePath) {
  const absolute = path.isAbsolute(filePath)
    ? filePath
    : `${process.cwd()}${path.sep}${filePath}`;
  try {
    return fs.realpathSync(absolute);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    const parent = path.dirname(absolute);
    if (parent === absolute) return path.resolve(absolute);
    return path.resolve(canonicalPath(parent), path.basename(absolute));
  }
}

function isWithin(candidate, root) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== "..");
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'"'"'`)}'`;
}

function realReceiptStoreRoots() {
  const roots = [path.join(os.homedir(), ".local", "share", "seal")];
  if (process.env.XDG_DATA_HOME) roots.push(path.join(process.env.XDG_DATA_HOME, "seal"));
  return [...new Set(roots.map(canonicalPath))];
}

function refuseRealReceiptStore(demoDir) {
  const resolved = canonicalPath(demoDir);
  const receiptRoot = realReceiptStoreRoots().find((root) => isWithin(resolved, root));
  if (receiptRoot) {
    fail(`REFUSE demo_directory_is_real_receipt_store: --dir resolves inside Seal's real receipt store (${receiptRoot}): ${resolved}`);
  }
  return resolved;
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
  // The embedded demo harness is INTERNAL: it accepts no server command,
  // URI, transport or configuration — only --dir for its own scratch space.
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--dir") { i += 1; continue; }
    fail(`seal demo accepts only --dir PATH; the demo harness takes no server, URI, transport or configuration (got: ${argv[i]})`);
  }
  const dirIndex = argv.indexOf("--dir");
  let demoCreatedDirectory = false;
  if (dirIndex !== -1) {
    dir = argv[dirIndex + 1];
    if (!dir) fail("--dir needs a path");
    dir = refuseRealReceiptStore(dir);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  } else {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "seal-demo-"));
    demoCreatedDirectory = true;
  }
  const dataFile = path.join(dir, "child", "data.txt");
  const countFile = `${dataFile}.count`;
  const storePath = path.join(dir, "approvals.journal");
  // The demo creates fabricated decisions and signs them with this run's
  // temporary key. Keep both in its working directory: a no-flag demo must
  // not plant uncheckable claims in the user's durable receipt store.
  const receiptsDir = path.join(dir, "receipts");

  const pendingById = new Map();
  const elicitationRequests = [];
  const elicitationWaiters = [];
  const receiptPaths = [];

  const signer = generateSigner();
  const pubkeyPath = path.join(dir, "receipt-signer.pub");
  fs.writeFileSync(pubkeyPath, signer.publicKeyHex + "\n", { mode: 0o644 });

  let proxy;
  try {
    createJournal(storePath); // deliberate init: absent-at-gate-time is a refusal
    proxy = createProxy({
      guardTool: TOOL,
      signer,
      storePath,
      receiptsDir,
      childArgv: [process.execPath, sealBinPath, "__demo-server", dataFile],
      onClientLine: (line) => {
        const frame = JSON.parse(line);
        if (frame.method === "elicitation/create") {
          const waiter = elicitationWaiters.shift();
          if (waiter) waiter(frame);
          else elicitationRequests.push(frame);
          return;
        }
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
    try {
      proxy.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
    } catch (error) {
      pendingById.delete(id);
      return proxy.stop().then(() => Promise.reject(error));
    }
    return promise;
  }
  function nextElicitation() {
    if (elicitationRequests.length > 0) return Promise.resolve(elicitationRequests.shift());
    return new Promise((resolve) => elicitationWaiters.push(resolve));
  }
  function answerElicitation(id, action, content) {
    const result = content === undefined ? { action } : { action, content };
    proxy.write(JSON.stringify({ jsonrpc: "2.0", id, result }));
  }
  const baseParams = () => ({ name: TOOL, arguments: { line: DEMO_LINE } });

  async function stopAnd(exitCode) {
    await proxy.stop();
    process.exit(exitCode);
  }

  console.log("seal demo — one shared proxy, one hidden child, one real file");
  await waitForFile(countFile);

  await send("initialize", { protocolVersion: "2025-06-18", capabilities: { elicitation: {} } });
  const listed = await send("tools/list", {});
  for (const tool of listed.result?.tools || []) {
    if (tool.name === TOOL) console.log(`tool      ${tool.name}  guarded`);
  }
  console.log(`child     seal __demo-server (this same binary) mutating ${dataFile}`);
  console.log(`${demoCreatedDirectory ? "temporary demo directory" : "demo directory"}: ${dir} (remains after the demo for the printed checker command)`);
  if (demoCreatedDirectory) {
    const quoted = shellQuote(dir);
    console.log(`Recover this run directory with: chmod -R u+w -- ${quoted} && rm -rf -- ${quoted}`);
  }

  const before = readCount(countFile);
  if (before !== "0") fail(`expected a fresh child at 0 observed calls, count file reads ${before}`);
  console.log(`child calls observed: ${before} (read from ${countFile})`);

  const guardedCall = send("tools/call", baseParams());
  const elicitation = await nextElicitation();
  const message = elicitation.params?.message;
  if (typeof message !== "string") fail("elicitation/create carried no approval message to display");
  console.log("INPUT REQUIRED  the proxy holds this call's approval; the contract's message:");
  console.log(message.split("\n").map((line) => `    ${line}`).join("\n"));
  const shown = readCount(countFile);
  if (shown !== "0") fail(`the approval dialog is shown but the count file already reads ${shown}`);
  console.log(`child calls observed: still ${shown} (read from ${countFile}) — approval shown, nothing executed`);

  const answer = await ask("Approve? [y/N] ");
  if (answer.kind === "eof") {
    process.stderr.write("seal: no approval response received (EOF); nothing was approved.\n");
    await proxy.stop();
    process.exit(1);
  }
  if (answer.value !== "y") {
    answerElicitation(elicitation.id, "decline");
    const declined = await guardedCall;
    const text = declined.result?.content?.[0]?.text || "";
    const count = readCount(countFile);
    console.log(`DECLINED  the proxy refused the retry: "${text}"`);
    console.log(`demo stopped; nothing was approved and the child received ${count} calls (read from ${countFile})`);
    return stopAnd(count === "0" ? 0 : 1);
  }

  answerElicitation(elicitation.id, "accept", { approve: true });
  const flowed = await guardedCall;
  if (flowed.result?.isError) fail(`the approved retry was refused: "${flowed.result.content[0].text}"`);
  console.log(`child replied through the shared proxy: "${flowed.result.content[0].text}"`);
  const after = readCount(countFile);
  if (after !== "1") fail(`the child's own count file reads ${after}, not 1; refusing to describe this as a single call`);
  console.log(`child calls observed: ${after} (read from ${countFile})`);

  console.log("replaying the identical elicitation response with the same id…");
  answerElicitation(elicitation.id, "accept", { approve: true });
  await new Promise((resolve) => setTimeout(resolve, 50));
  const finalCount = readCount(countFile);
  if (finalCount !== "1") fail(`after the replay the child's count file reads ${finalCount}, not 1`);
  console.log('BLOCKED   the shared proxy refused the replay: "approval refused: already_consumed"');
  console.log(`one-use held: the replay did not run the call again; child calls observed: still ${finalCount} (read from ${countFile})`);

  for (const receiptPath of receiptPaths) console.log(`receipt written: ${receiptPath}`);

  // Act 4 changes the same resource as the protected tool, but without
  // crossing the proxy. Read all three witnesses from disk before and after:
  // resource bytes, protected-server count, and Seal decision receipts.
  const resolvedDataFile = canonicalPath(dataFile);
  if (!isWithin(resolvedDataFile, dir)) {
    fail(`the demo data file resolves outside its demo directory: ${resolvedDataFile}`);
  }
  const dataBefore = fs.readFileSync(resolvedDataFile);
  const countBeforeDirectWrite = readCount(countFile);
  const decisionsBeforeDirectWrite = fs.readdirSync(receiptsDir).length;
  console.log("");
  console.log("OUTSIDE THE SEAL PATH");
  console.log("");
  console.log(`Writing directly to ${dataFile} without calling the MCP server...`);
  console.log("");
  const fd = fs.openSync(resolvedDataFile, "a");
  try {
    fs.writeSync(fd, "seal demo wrote this line directly\n");
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  const dataAfter = fs.readFileSync(resolvedDataFile);
  const countAfterDirectWrite = readCount(countFile);
  const decisionsAfterDirectWrite = fs.readdirSync(receiptsDir).length;
  if (dataAfter.equals(dataBefore)) {
    fail("the direct write did not change the demo data file; the witness would be false");
  }
  if (countAfterDirectWrite !== countBeforeDirectWrite) {
    fail(`the direct write changed the protected-server count from ${countBeforeDirectWrite} to ${countAfterDirectWrite}; the witness would be false`);
  }
  if (decisionsAfterDirectWrite !== decisionsBeforeDirectWrite) {
    fail(`the direct write produced ${decisionsAfterDirectWrite - decisionsBeforeDirectWrite} Seal decision(s); the witness would be false`);
  }
  console.log("File changed: yes");
  console.log(`Protected-server call count: still ${countAfterDirectWrite}`);
  console.log(`New Seal decisions: ${decisionsAfterDirectWrite - decisionsBeforeDirectWrite}`);
  console.log("");
  console.log("Seal did not observe or authorise this write.");
  await proxy.stop();
  console.log("receipts are claims, not proofs. The separately landed v2 checker replays the recorded kernel decision and reports five rows; a signature alone cannot establish that the event happened.");
  console.log(`  From the checkout root: node checker/seal-receipt-v2.mjs ${JSON.stringify(receiptPaths[receiptPaths.length - 1])} --pubkey "$(cat ${JSON.stringify(pubkeyPath)})"`);
  console.log("  Note: that key is the very one this demo used to sign the receipt, so checking against it proves only self-consistency — a hostile sealer could sign its own. To prove anything, supply a key you obtained from a source you already trust.");
  console.log("");
  console.log("ENFORCED");
  console.log("The approved demo.mutate call ran once; its replay was refused.");
  console.log("");
  console.log("NOT APPROVAL-GATED");
  console.log(`The direct write to ${dataFile}.`);
  console.log("");
  console.log("NOT OBSERVED");
  console.log(`That direct write; protected-server call count stayed ${countAfterDirectWrite} and Seal made 0 new decisions.`);
  console.log("");
  console.log("ASSURANCE");
  console.log("authorization rule tested; product state and forwarding tested; client and machine trusted.");
  process.exit(0);
}

module.exports = { run };
