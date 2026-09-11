// SPDX-License-Identifier: Apache-2.0
// Read the evidence available in receipt filenames. This can find gaps in a
// sequence, but cannot establish completeness because filenames are unsigned.
const fs = require("node:fs");

const RECEIPT_NAME = /^receipt-(\d+)-(\d+)-(\d+)-(.+)\.json$/;
const RECEIPT_PREFIX = "receipt-";
const MAX_GAP_INTERVALS = 1024;

function parseFilenameNumber(raw, allowSequencePadding = false) {
  if (raw.length > 1 && raw.startsWith("0") && !(allowSequencePadding && raw.length === 4)) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function inspectReceiptDirectory(directory) {
  const entries = fs.readdirSync(directory, { withFileTypes: true });
  const receiptFiles = [];
  const nonMatchingFiles = [];
  const rejectedFiles = [];
  for (const entry of entries) {
    if (!entry.isFile() && !entry.isSymbolicLink()) continue;
    const match = entry.name.match(RECEIPT_NAME);
    if (!match) {
      if (entry.name.startsWith(RECEIPT_PREFIX)) {
        rejectedFiles.push({
          name: entry.name,
          reason: "timestamp and pid must be safe non-negative integers; sequence must be safe and use no non-canonical leading zeroes",
        });
        continue;
      }
      nonMatchingFiles.push(entry.name);
      continue;
    }
    const timestamp = parseFilenameNumber(match[1]);
    const pid = parseFilenameNumber(match[2]);
    const sequence = parseFilenameNumber(match[3], true);
    if (timestamp === null || pid === null || sequence === null) {
      rejectedFiles.push({
        name: entry.name,
        reason: "timestamp and pid must be safe non-negative integers; sequence must be safe and use no non-canonical leading zeroes",
      });
      continue;
    }
    receiptFiles.push({
      name: entry.name,
      timestamp,
      pid,
      sequence,
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
  let gapsTruncated = false;
  for (const [pid, group] of byPid) {
    group.sort((a, b) => a.sequence - b.sequence);
    for (let index = 1; index < group.length; index += 1) {
      const previous = group[index - 1].sequence;
      const current = group[index].sequence;
      if (current <= previous + 1) continue;
      if (gaps.length >= MAX_GAP_INTERVALS) {
        gapsTruncated = true;
        break;
      }
      gaps.push({ pid, start: previous + 1, end: current - 1 });
    }
    if (gapsTruncated) break;
  }
  gaps.sort((a, b) => a.pid - b.pid || a.start - b.start);
  return { receiptFiles, nonMatchingFiles, rejectedFiles, gaps, gapsTruncated };
}

function unknownLine() {
  return "Receipt completeness: UNKNOWN (receipt filenames are not signed; deleted receipts can be renumbered)";
}

function formatPopulation(directory, population) {
  if (population.receiptFiles.length === 0 && population.nonMatchingFiles.length === 0 && population.rejectedFiles.length === 0) return [];
  const lines = [`Receipt files observed: ${population.receiptFiles.length} in ${directory}`];
  if (population.nonMatchingFiles.length > 0) {
    lines.push(`Non-receipt files ignored: ${population.nonMatchingFiles.length}`);
  }
  if (population.rejectedFiles.length > 0) {
    lines.push(`Receipt files rejected: ${population.rejectedFiles.length}`);
    for (const file of population.rejectedFiles) lines.push(`Receipt file rejected: ${file.name} (${file.reason})`);
  }
  for (const gap of population.gaps) lines.push(`Receipt gap: pid ${gap.pid} missing sequences ${gap.start} through ${gap.end}`);
  if (population.gapsTruncated) lines.push(`Receipt gaps truncated after ${MAX_GAP_INTERVALS} intervals; additional gaps may exist`);
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
  if (population.rejectedFiles.length > 0) {
    console.error("Receipt reader exit 1: rejected receipt filenames were found");
    process.exitCode = 1;
  }
  return population;
}

module.exports = { RECEIPT_NAME, inspectReceiptDirectory, formatPopulation, unknownLine, run };
