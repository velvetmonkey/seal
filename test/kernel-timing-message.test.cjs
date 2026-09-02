// SPDX-License-Identifier: Apache-2.0
const assert = require("node:assert/strict");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");
const { printKernelTiming } = require("../spine/presentation.cjs");

const ROOT = path.join(__dirname, "..");
const CONTROL = path.join(ROOT, "scripts", "check-kernel-timing-message.cjs");

function check(report) {
  return spawnSync(process.execPath, [CONTROL], { input: report, encoding: "utf8" });
}

function rendered(error) {
  const lines = [];
  printKernelTiming(error, (line) => lines.push(line));
  return `${lines.join("\n")}\n`;
}

test("kernel timing message control refuses a first-instruction claim with a completed child phase", () => {
  const run = check([
    "seal: kernel worker died before its first instruction.",
    "seal: kernel timing completed phases:",
    "seal:   child_bootstrap_to_module_load: 151.798726 ms",
  ].join("\n"));
  assert.equal(run.status, 1);
  assert.equal(run.stdout, "");
  assert.equal(run.stderr, "REFUSE kernel_timing_message_contradiction: first-instruction claim accompanies a completed child phase\n");
});

test("kernel timeout after all security phases reports the unobserved exit", () => {
  const output = rendered({
    kernel_timing_active_phase: null,
    kernel_timing_deadline_ms: 30000,
    kernel_timing_ms: {
      child_bootstrap_to_module_load: 151.798726,
      child_request_read: 5.818265,
      child_request_parse: 0.357778,
      wasm_load: 1351.453258,
      decision_execution: 2155.086679,
      child_response_construction_and_serialization: 0.462316,
    },
    kernel_timing_lifecycle: {
      response_generated: { active_resources: { handles: ["Socket"], requests: [] } },
      response_write_started: {},
    },
  });
  assert.equal(output, [
    "seal: kernel_worker_exit_not_observed within its 30000 ms deadline.",
    "seal: measured security-relevant phases complete.",
    "seal: response write state: response_generated, response_write_started.",
    "seal: active resources after response generation: {\"handles\":[\"Socket\"],\"requests\":[]}.",
    "seal: kernel timing completed phases:",
    "seal:   child_bootstrap_to_module_load: 151.798726 ms",
    "seal:   child_request_read: 5.818265 ms",
    "seal:   child_request_parse: 0.357778 ms",
    "seal:   wasm_load: 1351.453258 ms",
    "seal:   decision_execution: 2155.086679 ms",
    "seal:   child_response_construction_and_serialization: 0.462316 ms",
    "",
  ].join("\n"));
  const run = check(output);
  assert.equal(run.status, 0);
  assert.equal(run.stdout, "PASS kernel_timing_message_contradiction\n");
  assert.equal(run.stderr, "");
});

test("kernel timeout with no child timing reports the evidence limit", () => {
  const output = rendered({
    kernel_timing_active_phase: null,
    kernel_timing_deadline_ms: 30000,
    kernel_timing_ms: { parent_kernel_worker_wait: 5015.472308 },
  });
  assert.equal(output, [
    "seal: kernel worker did not publish a child timing phase within its 30000 ms deadline.",
    "seal: kernel timing completed phases:",
    "seal:   parent_kernel_worker_wait: 5015.472308 ms",
    "",
  ].join("\n"));
  const run = check("seal: kernel worker died before its first instruction.\nseal: kernel timing completed phases:\n");
  assert.equal(run.status, 0);
  assert.equal(run.stdout, "PASS kernel_timing_message_contradiction\n");
  assert.equal(run.stderr, "");
});
