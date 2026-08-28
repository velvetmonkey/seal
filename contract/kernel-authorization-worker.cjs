#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Isolated CommonJS worker around the fixture's proven Node loader. Keeping
// Emscripten's globals here prevents them from entering the long-lived proxy.
const path = require("node:path");
const { pathToFileURL } = require("node:url");

function timestamp() {
  return process.hrtime.bigint();
}

function phase(started, finished) {
  return { started_ns: started.toString(), finished_ns: finished.toString() };
}

function emitPhase(name, started, finished) {
  process.stderr.write(`SEAL_KERNEL_TIMING_PHASE ${JSON.stringify({
    clock: "child_process_hrtime_ns",
    name,
    timestamps: phase(started, finished),
  })}\n`);
}

function emitPhaseStart(name, started) {
  process.stderr.write(`SEAL_KERNEL_TIMING_PHASE_START ${JSON.stringify({
    clock: "child_process_hrtime_ns",
    name,
    started_ns: started.toString(),
  })}\n`);
}

async function main() {
  const kernelRoot = path.resolve(process.argv[2]);
  const moduleLoadStarted = timestamp();
  emitPhaseStart("child_bootstrap_to_module_load", moduleLoadStarted);
  const runner = require(path.join(kernelRoot, "runner.cjs"));
  const cfg = await import(pathToFileURL(path.join(kernelRoot, "seal-config.js")).href);
  const moduleLoadFinished = timestamp();
  emitPhase("child_bootstrap_to_module_load", moduleLoadStarted, moduleLoadFinished);
  const requestReadStarted = timestamp();
  emitPhaseStart("child_request_read", requestReadStarted);
  const requestText = await new Promise((resolve, reject) => {
    let text = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => { text += chunk; });
    process.stdin.on("end", () => resolve(text));
    process.stdin.on("error", reject);
  });
  const requestReadFinished = timestamp();
  emitPhase("child_request_read", requestReadStarted, requestReadFinished);
  const requestParseStarted = timestamp();
  emitPhaseStart("child_request_parse", requestParseStarted);
  const request = JSON.parse(requestText);
  const requestParseFinished = timestamp();
  emitPhase("child_request_parse", requestParseStarted, requestParseFinished);
  const wasmLoadStarted = timestamp();
  emitPhaseStart("wasm_load", wasmLoadStarted);
  await runner.load();
  const wasmLoadFinished = timestamp();
  emitPhase("wasm_load", wasmLoadStarted, wasmLoadFinished);

  // The guarded entry follows the retry tool so even an altered tool is
  // mediated. Only the issue-time target is granted, so alteration denies.
  const config = {
    epoch: request.epoch,
    safety: {
      approval: { control_file: "product-adapter", ttl_seconds: 120 },
      tools: [{
        name: request.retryTool,
        mode: "guarded",
        match: { type: "always" },
        target: [{ full_arguments: true }],
      }],
    },
    temporal: { policies: [] },
  };
  const issuedTarget = cfg.guardTarget(request.issuedTool, request.issuedArgs);
  const approvals = request.accepted ? [issuedTarget] : [];
  const grantedCapabilities = approvals.map((target) => ({ target }));
  const kernelInputs = { approvals, votes: "", grants: "", forecasts: "" };
  const decisionStarted = timestamp();
  emitPhaseStart("decision_execution", decisionStarted);
  const result = await runner.decide(config, {
    tool: request.retryTool,
    args: request.retryArgs,
    approvals,
    now: request.now,
  });
  const decisionFinished = timestamp();
  emitPhase("decision_execution", decisionStarted, decisionFinished);
  const responseStarted = timestamp();
  emitPhaseStart("child_response_construction_and_serialization", responseStarted);
  const response = {
    verdict: result.verdict,
    raw: result.raw,
    receipt: result.receipt,
    receipt_record: {
      tool: request.retryTool,
      arguments: request.retryArgs,
      now: request.now,
      kernel_config: config,
      granted_capabilities: grantedCapabilities,
      kernel_inputs: kernelInputs,
      verdict: result.verdict,
      reason: result.receipt.reason,
    },
    issued_target: issuedTarget,
  };
  const serializedResponse = JSON.stringify(response);
  const responseFinished = timestamp();
  emitPhase("child_response_construction_and_serialization", responseStarted, responseFinished);
  process.stdout.write(serializedResponse);
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exit(1);
});
