// SPDX-License-Identifier: Apache-2.0
// Shared human presentation for kernel deadline timing.
function printKernelTiming(error, writeLine = (line) => console.error(line)) {
  if (!error || typeof error !== "object" || !("kernel_timing_active_phase" in error)) return;
  const activePhase = error.kernel_timing_active_phase;
  if (activePhase) {
    writeLine(`seal: kernel timing active phase: ${activePhase}`);
  } else if (Number.isFinite(error.kernel_timing_deadline_ms)) {
    const completed = error.kernel_timing_ms && typeof error.kernel_timing_ms === "object"
      ? Object.keys(error.kernel_timing_ms).some((name) => name.startsWith("child_"))
      : false;
    const allSecurityPhases = error.kernel_timing_ms && typeof error.kernel_timing_ms === "object"
      && ["child_bootstrap_to_module_load", "child_request_read", "child_request_parse", "wasm_load", "decision_execution", "child_response_construction_and_serialization"].every((name) => name in error.kernel_timing_ms);
    if (allSecurityPhases) {
      writeLine(`seal: kernel_worker_exit_not_observed within its ${error.kernel_timing_deadline_ms} ms deadline.`);
      writeLine("seal: measured security-relevant phases complete.");
    } else if (completed) {
      writeLine(`seal: kernel worker did not answer within its ${error.kernel_timing_deadline_ms} ms deadline.`);
    } else {
      writeLine(`seal: kernel worker did not publish a child timing phase within its ${error.kernel_timing_deadline_ms} ms deadline.`);
    }
  }
  if (error.kernel_timing_lifecycle && typeof error.kernel_timing_lifecycle === "object") {
    const lifecycle = error.kernel_timing_lifecycle;
    const state = ["response_generated", "response_write_started", "stdout_write_callback_completed", "beforeExit", "exit"]
      .filter((name) => name in lifecycle)
      .join(", ") || "none observed";
    writeLine(`seal: response write state: ${state}.`);
    const resources = lifecycle.response_generated?.active_resources;
    if (resources) writeLine(`seal: active resources after response generation: ${JSON.stringify(resources)}.`);
  }
  if (error.kernel_timing_ms && typeof error.kernel_timing_ms === "object") {
    writeLine("seal: kernel timing completed phases:");
    for (const [phase, milliseconds] of Object.entries(error.kernel_timing_ms)) {
      writeLine(`seal:   ${phase}: ${milliseconds} ms`);
    }
  }
  if (error.kernel_timing_unmeasured && typeof error.kernel_timing_unmeasured === "object") {
    writeLine("seal: kernel timing unmeasured spans:");
    for (const [span, declaration] of Object.entries(error.kernel_timing_unmeasured)) {
      writeLine(`seal:   ${span}: ${declaration}`);
    }
  }
}

module.exports = { printKernelTiming };
