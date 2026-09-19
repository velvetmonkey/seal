// SPDX-License-Identifier: Apache-2.0
"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const readline = require("node:readline");
const { spawn, spawnSync } = require("node:child_process");
const ACCEPT = { action: "accept", content: { approve: true } };

async function runTraces({
  candidateRoot,
  outputDir,
  corpusPath = path.join(
    __dirname,
    "authorization-correspondence-corpus.jsonl",
  ),
}) {
  const root = fs.realpathSync(candidateRoot),
    cli = path.join(root, "bin/seal");
  fs.mkdirSync(outputDir, { recursive: true });
  const dir = fs.mkdtempSync(path.join(outputDir, "child-traces-"));
  const effects = path.join(dir, "effects.jsonl"),
    store = path.join(dir, "approvals.journal"),
    receipts = path.join(dir, "receipts");
  fs.writeFileSync(effects, "");
  const init = spawnSync(
    process.execPath,
    [cli, "__proxy", "--init-store", "--store", store],
    { encoding: "utf8" },
  );
  assert.equal(init.status, 0, `trace-startup: ${init.stderr}`);
  const protection = require(path.join(root, "spine/protection.cjs"));
  const projectRoot = path.join(dir, "project");
  fs.mkdirSync(projectRoot);
  const projectFile = path.join(projectRoot, ".mcp.json");
  const projectConfig = {
    mcpServers: {
      demo: {
        command: process.execPath,
        args: [
          path.join(__dirname, "authorization-recording-child.cjs"),
          effects,
        ],
      },
    },
  };
  fs.writeFileSync(projectFile, JSON.stringify(projectConfig));
  const env = { ...process.env, XDG_DATA_HOME: path.join(dir, "data-home") };
  const project = protection.readProjectServer(projectRoot, "demo"),
    statePath = protection.statePathFor(projectRoot, env);
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(
    statePath,
    JSON.stringify({
      schema: "seal.protect/v1",
      state: protection.STATES.PENDING_RESTART,
      projectRoot,
      projectId: protection.projectId(projectRoot),
      serverName: "demo",
      projectServerDigest: project.serverDigest,
      guardTools: ["demo.mutate", "demo.other"],
      storePath: store,
      receiptsDir: receipts,
      childArgv: project.childArgv,
      childEnv: project.childEnv,
      lease: null,
    }),
    { mode: 0o600 },
  );
  const processes = [],
    transcripts = [],
    checks = [];
  let requestId = 100,
    run;
  function launch() {
    const child = spawn(
      process.execPath,
      [cli, "__proxy", "--protect-state", statePath],
      { env, stdio: ["pipe", "pipe", "pipe"] },
    );
    const state = { child, frames: [], stderr: "", exit: null };
    processes.push(state);
    state.closed = new Promise((resolve) =>
      child.once("close", (code, signal) => {
        state.exit = { code, signal };
        resolve();
      }),
    );
    child.stderr.on("data", (chunk) => {
      state.stderr += chunk;
    });
    readline.createInterface({ input: child.stdout }).on("line", (raw) => {
      transcripts.push({ direction: "proxy", raw });
      state.frames.push({ raw, frame: JSON.parse(raw), used: false });
    });
    state.send = (frame) => {
      const raw = typeof frame === "string" ? frame : JSON.stringify(frame);
      transcripts.push({ direction: "client", raw });
      child.stdin.write(raw + "\n");
    };
    state.wait = async (predicate) => {
      const deadline = Date.now() + 45000;
      while (Date.now() < deadline) {
        const found = state.frames.find((x) => !x.used && predicate(x.frame));
        if (found) {
          found.used = true;
          return found.frame;
        }
        if (state.exit)
          throw new Error(
            `trace-startup/exit: ${JSON.stringify(state.exit)} ${state.stderr}`,
          );
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      throw new Error(`trace-timeout: ${state.stderr}`);
    };
    return state;
  }
  async function initialize() {
    run = launch();
    const id = ++requestId;
    run.send({
      jsonrpc: "2.0",
      id,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: { elicitation: {} },
      },
    });
    await run.wait((f) => f.id === id);
  }
  async function barrier() {
    const id = ++requestId;
    run.send({ jsonrpc: "2.0", id, method: "tools/list" });
    await run.wait((f) => f.id === id);
  }
  async function begin(effect, id = ++requestId) {
    run.send({
      jsonrpc: "2.0",
      id,
      method: "tools/call",
      params: { name: effect.tool, arguments: effect.args },
    });
    const prompt = await run.wait((f) => f.method === "elicitation/create");
    return { id, prompt, effect };
  }
  async function answer(pending, result = ACCEPT) {
    run.send({ jsonrpc: "2.0", id: pending.prompt.id, result });
    return run.wait((f) => f.id === pending.id);
  }
  const observed = () =>
    fs
      .readFileSync(effects, "utf8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map(JSON.parse);
  function check(name, expected) {
    assert.deepEqual(
      observed().map(({ id, tool, args }) => ({ id, tool, args })),
      expected,
      `child-effects:${name}`,
    );
    checks.push({ name, expected, actual: observed() });
  }
  const op = (p) => ({ id: p.id, ...p.effect });
  const A = {
      tool: "demo.mutate",
      args: { value: "A", nested: [1, { yes: true }] },
    },
    B = { tool: "demo.other", args: { secret: "declined-B" } };
  try {
    await initialize();
    const parserCases = fs
      .readFileSync(corpusPath, "utf8")
      .trim()
      .split("\n")
      .flatMap((line) => JSON.parse(line).parser_refusals || []);
    assert.ok(parserCases.length >= 3, "parser-refusal-corpus");
    for (const parserCase of parserCases) {
      run.send(parserCase.wire);
      await barrier();
      check(parserCase.id, []);
    }
    const a = await begin(A);
    await barrier();
    check("call-before-answer", []);
    await answer(a);
    check("accept-A", [op(a)]);
    run.send({ jsonrpc: "2.0", id: a.prompt.id, result: ACCEPT });
    await barrier();
    check("accept-then-repeat", [op(a)]);
    const again = await begin(A);
    await answer(again);
    const expected = [op(a), op(again)];
    check("fresh-call-then-accept-again", expected);
    const b = await begin(B);
    await answer(b, { action: "decline" });
    check("decline-after-accept", expected);
    assert.ok(
      !fs.readFileSync(effects, "utf8").includes("declined-B"),
      "child-effects:declined-content",
    );
    const malformed = await begin(B);
    await answer(malformed, { action: "accept", content: { approve: "yes" } });
    check("malformed-answer", expected);
    const cancelled = await begin(B);
    await answer(cancelled, { action: "cancel" });
    check("cancelled-answer", expected);
    run.child.stdin.end();
    await run.closed;
    await initialize();
    run.send({ jsonrpc: "2.0", id: a.prompt.id, result: ACCEPT });
    await barrier();
    check("restart-then-replay", expected);
    const fresh = await begin({
      tool: "demo.other",
      args: { value: "fresh-after-restart" },
    });
    await answer(fresh);
    expected.push(op(fresh));
    check("restart-then-fresh-approval", expected);
    const bigId = "9007199254740993",
      bigEffect = {
        tool: "demo.mutate",
        args: { array: [false, null, { text: "😀" }], n: 1.25 },
      };
    run.send(
      `{"jsonrpc":"2.0","id":${bigId},"method":"tools/call","params":${JSON.stringify({ name: bigEffect.tool, arguments: bigEffect.args })}}`,
    );
    const prompt = await run.wait((f) => f.method === "elicitation/create");
    await answer({ id: Number(bigId), prompt }, ACCEPT);
    expected.push({ id: Number(bigId), ...bigEffect });
    check("large-request-id", expected);
    assert.match(
      observed().at(-1).raw,
      /"id"\s*:\s*9007199254740993\s*[,}]/,
      "child-effects:large-request-id-token",
    );
    // Change the actual configured child before the next approval. The product
    // must observe project drift before permitting another operation.
    const drift = await begin(B);
    projectConfig.mcpServers.demo.env = { CORRESPONDENCE_DRIFT: "1" };
    fs.writeFileSync(projectFile, JSON.stringify(projectConfig));
    await answer(drift);
    check("project-drift", expected);
    // Expiry/context are exercised at the direct contract seam with its real
    // adapter and an injected clock, rather than a fabricated wire continuation.
    const { createApprovalContract } = require(
      path.join(root, "contract/contract.cjs"),
    );
    let now = 1000;
    const contract = createApprovalContract({ now: () => now });
    const pending = () =>
      contract.begin({ tool: A.tool, args: A.args }).result.requestState;
    const retry = (requestState, overrides = {}) =>
      contract.retry({
        tool: A.tool,
        args: A.args,
        requestState,
        inputResponses: { approval: ACCEPT },
        ...overrides,
      });
    let state = pending();
    now += 120001;
    assert.equal(
      retry(state).refusal,
      "expired",
      "contract:expired-continuation",
    );
    checks.push({ name: "expired-continuation", result: "PASS" });
    state = pending();
    assert.equal(
      retry(state, { projectId: "wrong-project" }).refusal,
      "context_mismatch",
      "contract:project-mismatch",
    );
    state = pending();
    assert.equal(
      retry(state, { serverId: "wrong-server" }).refusal,
      "context_mismatch",
      "contract:server-mismatch",
    );
    state = pending();
    const first = retry(state),
      repeated = retry(state);
    assert.equal(first.kind, "allow", "contract:positive-control");
    const directEffects = path.join(dir, "direct-effects.jsonl");
    fs.writeFileSync(directEffects, "");
    const directCalls = [
      { id: "contract-once", decision: first },
      { id: "contract-replay", decision: repeated },
    ]
      .filter((x) => x.decision.kind === "allow")
      .map((x) => ({
        jsonrpc: "2.0",
        id: x.id,
        method: "tools/call",
        params: { name: A.tool, arguments: A.args },
      }));
    const recorder = spawnSync(
      process.execPath,
      [
        path.join(__dirname, "authorization-recording-child.cjs"),
        directEffects,
      ],
      {
        input: directCalls.map((x) => JSON.stringify(x)).join("\n") + "\n",
        encoding: "utf8",
      },
    );
    assert.equal(
      recorder.status,
      0,
      `direct-recorder-startup: ${recorder.stderr}`,
    );
    const directObserved = fs
      .readFileSync(directEffects, "utf8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map(JSON.parse)
      .map(({ id, tool, args }) => ({ id, tool, args }));
    const directExpected = [{ id: "contract-once", ...A }];
    checks.push({
      name: "direct-contract-consumed-and-context",
      expected: directExpected,
      actual: directObserved,
      effect_file: directEffects,
    });
    assert.deepEqual(
      directObserved,
      directExpected,
      "contract:consumed-state-check",
    );
    assert.equal(
      repeated.refusal,
      "already_consumed",
      "contract:consumed-refusal",
    );
    check("direct-contract-checks-added-no-child-effects", expected);
    return {
      result: "PASS",
      scope: "installed-proxy-and-direct-contract",
      checks,
      effect_file: effects,
      process_transcript: path.join(dir, "proxy.jsonl"),
    };
  } finally {
    for (const state of processes) {
      if (!state.exit) {
        state.child.stdin.end();
        const timer = setTimeout(() => state.child.kill("SIGKILL"), 5000);
        await state.closed;
        clearTimeout(timer);
      }
    }
    fs.writeFileSync(
      path.join(dir, "proxy.jsonl"),
      transcripts.map((x) => JSON.stringify(x)).join("\n") + "\n",
    );
    fs.writeFileSync(
      path.join(dir, "stderr.json"),
      JSON.stringify(
        processes.map((p) => p.stderr),
        null,
        2,
      ) + "\n",
    );
    fs.writeFileSync(
      path.join(dir, "checks.json"),
      JSON.stringify(checks, null, 2) + "\n",
    );
  }
}
module.exports = { runTraces };
if (require.main === module) {
  const { values } = require("node:util").parseArgs({
    options: {
      "candidate-root": { type: "string" },
      evidence: { type: "string" },
    },
  });
  runTraces({
    candidateRoot: values["candidate-root"],
    outputDir: path.dirname(path.resolve(values.evidence)),
  })
    .then((result) => {
      fs.writeFileSync(values.evidence, JSON.stringify(result, null, 2) + "\n");
      console.log("child traces PASS");
    })
    .catch((error) => {
      console.error(error.stack);
      process.exitCode = 1;
    });
}
