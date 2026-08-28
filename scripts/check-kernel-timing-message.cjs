#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Refuse a first-instruction claim when the same product report records that
// a child completed a named phase.
const fs = require("node:fs");

const report = fs.readFileSync(0, "utf8");
const firstInstructionClaim = /^seal: kernel worker died before its first instruction\.$/m.test(report);
const completedChildPhase = /^seal:\s+child_[a-z_]+:\s+[^\n]+\s+ms$/m.test(report);

if (firstInstructionClaim && completedChildPhase) {
  process.stderr.write("REFUSE kernel_timing_message_contradiction: first-instruction claim accompanies a completed child phase\n");
  process.exitCode = 1;
} else {
  process.stdout.write("PASS kernel_timing_message_contradiction\n");
}
