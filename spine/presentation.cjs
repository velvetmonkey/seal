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
    if (completed) {
      writeLine(`seal: kernel worker did not answer within its ${error.kernel_timing_deadline_ms} ms deadline.`);
    } else {
      writeLine(`seal: kernel worker did not publish a child timing phase within its ${error.kernel_timing_deadline_ms} ms deadline.`);
    }
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
