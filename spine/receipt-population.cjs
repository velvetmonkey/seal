// SPDX-License-Identifier: Apache-2.0
// Read the evidence available in receipt filenames. This can find gaps in a
// sequence, but cannot establish completeness because filenames are unsigned.
const fs = require("node:fs");

const RECEIPT_NAME = /^receipt-(\d+)-(\d+)-(\d+)-(.+)\.json$/;

function inspectReceiptDirectory(directory) {
  const entries = fs.readdirSync(directory, { withFileTypes: true });
  const receiptFiles = [];
  const nonMatchingFiles = [];
  for (const entry of entries) {
    if (!entry.isFile() && !entry.isSymbolicLink()) continue;
    const match = entry.name.match(RECEIPT_NAME);
    if (!match) {
      nonMatchingFiles.push(entry.name);
      continue;
    }
    receiptFiles.push({
      name: entry.name,
      timestamp: Number(match[1]),
      pid: Number(match[2]),
      sequence: Number(match[3]),
      action: match[4],
    });
  }
  const byPid = new Map();
  for (const receipt of receiptFiles) {
    const group = byPid.get(receipt.pid) || [];
    group.push(receipt);
    byPid.set(receipt.pid, group);
  }
  const gaps = [];
  for (const [pid, group] of byPid) {
    group.sort((a, b) => a.sequence - b.sequence);
    for (let index = 1; index < group.length; index += 1) {
      const previous = group[index - 1].sequence;
      const current = group[index].sequence;
      for (let sequence = previous + 1; sequence < current; sequence += 1) {
        gaps.push({ pid, sequence });
      }
    }
  }
  gaps.sort((a, b) => a.pid - b.pid || a.sequence - b.sequence);
  return { receiptFiles, nonMatchingFiles, gaps };
}

function unknownLine() {
  return "Receipt completeness: UNKNOWN (receipt filenames are not signed; deleted receipts can be renumbered)";
}

function formatPopulation(directory, population) {
  if (population.receiptFiles.length === 0 && population.nonMatchingFiles.length === 0) return [];
  const lines = [`Receipt files observed: ${population.receiptFiles.length} in ${directory}`];
  if (population.nonMatchingFiles.length > 0) {
    lines.push(`Non-receipt files ignored: ${population.nonMatchingFiles.length}`);
  }
  for (const gap of population.gaps) lines.push(`Receipt gap: pid ${gap.pid} missing sequence ${gap.sequence}`);
  lines.push(`Receipt gaps found: ${population.gaps.length}`);
  lines.push(unknownLine());
  return lines;
}

function run(directory) {
  const population = inspectReceiptDirectory(directory);
  for (const line of formatPopulation(directory, population)) console.log(line);
  if (population.gaps.length > 0) {
    console.error("Receipt reader exit 1: one or more sequence gaps were found");
    process.exitCode = 1;
  }
  return population;
}

module.exports = { RECEIPT_NAME, inspectReceiptDirectory, formatPopulation, unknownLine, run };
