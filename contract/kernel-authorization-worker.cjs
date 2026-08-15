#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Isolated CommonJS worker around the fixture's proven Node loader. Keeping
// Emscripten's globals here prevents them from entering the long-lived proxy.
const path = require("node:path");

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
  const cfg = await import(`file://${path.join(kernelRoot, "seal-config.js")}`);

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
  const result = await runner.decide(config, {
    tool: request.retryTool,
    args: request.retryArgs,
    approvals: request.accepted ? [issuedTarget] : [],
    now: request.now,
  });
  process.stdout.write(JSON.stringify({
    verdict: result.verdict,
    raw: result.raw,
    receipt: result.receipt,
    issued_target: issuedTarget,
  }));
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exit(1);
});
