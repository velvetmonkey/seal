// SPDX-License-Identifier: Apache-2.0
// Shared human presentation for kernel deadline timing.
function printKernelTiming(error, writeLine = (line) => console.error(line)) {
  if (!error || typeof error !== "object" || !("kernel_timing_active_phase" in error)) return;
  const activePhase = error.kernel_timing_active_phase;
  writeLine(`seal: kernel timing active phase: ${activePhase}`);
  if (activePhase === "child_died_before_first_instruction") {
    writeLine("seal: kernel worker died before its first instruction.");
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
