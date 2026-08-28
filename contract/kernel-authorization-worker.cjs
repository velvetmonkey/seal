#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Isolated CommonJS worker around the fixture's proven Node loader. Keeping
// Emscripten's globals here prevents them from entering the long-lived proxy.
const path = require("node:path");
const { pathToFileURL } = require("node:url");

function elapsedMs(started) {
  return Number(process.hrtime.bigint() - started) / 1e6;
}

async function main() {
  const kernelRoot = path.resolve(process.argv[2]);
  const request = JSON.parse(await new Promise((resolve, reject) => {
    let text = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => { text += chunk; });
    process.stdin.on("end", () => resolve(text));
    process.stdin.on("error", reject);
  }));
  const runner = require(path.join(kernelRoot, "runner.cjs"));
  const cfg = await import(pathToFileURL(path.join(kernelRoot, "seal-config.js")).href);
  const wasmLoadStarted = process.hrtime.bigint();
  await runner.load();
  const wasmLoadMs = elapsedMs(wasmLoadStarted);

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
  const decisionStarted = process.hrtime.bigint();
  const result = await runner.decide(config, {
    tool: request.retryTool,
    args: request.retryArgs,
    approvals,
    now: request.now,
  });
  const decisionExecutionMs = elapsedMs(decisionStarted);
  const responseStarted = process.hrtime.bigint();
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
    kernel_timing_ms: {
      wasm_load: wasmLoadMs,
      decision_execution: decisionExecutionMs,
      // This measures construction and serialization of the worker response.
      // The parent adds process creation/startup to the timing it publishes.
      response: 0,
    },
  };
  JSON.stringify(response);
  response.kernel_timing_ms.response = elapsedMs(responseStarted);
  // Re-encode after recording response construction. The extra serialization
  // remains part of the response phase seen by the parent.
  process.stdout.write(JSON.stringify(response));
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exit(1);
});
