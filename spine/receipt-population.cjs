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

function inspectReceiptDirectory(directory, { maxEntries = Infinity } = {}) {
  // Streaming enumeration lets bounded consumers use this same population rule.
  const entries = fs.opendirSync(directory);
  let scannedEntries = 0;
  let truncated = false;
  const receiptFiles = [];
  const nonMatchingFiles = [];
  const rejectedFiles = [];
  try {
    for (;;) {
      const entry = entries.readSync();
      if (!entry) break;
      if (scannedEntries >= maxEntries) { truncated = true; break; }
      scannedEntries += 1;
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
  } finally { entries.closeSync(); }
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
  return { receiptFiles, nonMatchingFiles, rejectedFiles, gaps, gapsTruncated, scannedEntries, truncated };
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

// Hard resource ceilings, independent of directory size and caller input.
const QUERY_ENTRIES = 10000;
const QUERY_FILE_BYTES = 65536;
const QUERY_TOTAL_BYTES = 16 * 1024 * 1024;

// seal.history-time/v1 for v2 receipts (docs/SEAL-RECEIPT-V2.md).
// The approval producer uses epoch seconds; legacy millisecond inputs remain
// readable. This compatibility rule is only a query projection, never a change
// to the signed kernel input or to replay. V2 has no signed unit discriminator.
function historyTimeMs(now) {
  return now < 1_000_000_000_000 ? now * 1000 : now;
}

async function query(directory, { limit = 20, since = 0, until = Date.now(), tool } = {}) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100 ||
      !Number.isSafeInteger(since) || since < 0 || !Number.isSafeInteger(until) || until < since ||
      (tool !== undefined && (typeof tool !== "string" || !tool.length || tool.length > 256))) {
    throw new Error("invalid receipt query options");
  }
  const population = inspectReceiptDirectory(directory, { maxEntries: QUERY_ENTRIES });
  const { read } = await import("../checker/seal-receipt-v2.mjs");
  const path = require("node:path");
  const observedAt = Date.now();
  const rows = [];
  let unknown = 0, future = 0, other = 0, matched = 0, allow = 0, block = 0, bytesRead = 0;
  for (const entry of population.receiptFiles) {
    let fd;
    try {
      if (bytesRead >= QUERY_TOTAL_BYTES) throw new Error("byte budget");
      // Never follow a symlink or block on a FIFO swapped in after enumeration.
      fd = fs.openSync(path.join(directory, entry.name), fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
      const stat = fs.fstatSync(fd);
      if (!stat.isFile() || stat.size > QUERY_FILE_BYTES) throw new Error("not a bounded regular file");
      const buffer = Buffer.alloc(Math.min(QUERY_FILE_BYTES + 1, QUERY_TOTAL_BYTES - bytesRead));
      let size = 0;
      while (size < buffer.length) {
        const count = fs.readSync(fd, buffer, size, buffer.length - size, null);
        if (!count) break;
        size += count;
      }
      bytesRead += size;
      if (size > QUERY_FILE_BYTES || size !== stat.size) throw new Error("oversized or changing file");
      const receipt = read(buffer.subarray(0, size));
      if (receipt?.seal_receipt !== "v2" || typeof receipt.tool !== "string" ||
          !receipt.tool.length || receipt.tool.length > 256 ||
          !Number.isSafeInteger(receipt.now) || receipt.now < 0 ||
          !["ALLOW", "BLOCK", "ERROR"].includes(receipt.verdict) ||
          (receipt.action !== undefined && typeof receipt.action !== "string")) throw new Error("unknown decision");
      const nowMs = historyTimeMs(receipt.now);
      if (nowMs > observedAt) { unknown += 1; future += 1; continue; }
      // action describes the proxy decision; verdict is the underlying kernel claim.
      const decision = receipt.action ?? receipt.verdict;
      if (decision !== "ALLOW" && decision !== "BLOCK") { other += 1; continue; }
      if (nowMs < since || nowMs > until || (tool !== undefined && receipt.tool !== tool)) continue;
      matched += 1;
      if (decision === "ALLOW") allow += 1; else block += 1;
      rows.push({ now: nowMs, decision, tool: receipt.tool, name: entry.name });
      rows.sort((a, b) => b.now - a.now || a.name.localeCompare(b.name));
      if (rows.length > limit) rows.pop();
    } catch { unknown += 1; }
    finally { if (fd !== undefined) fs.closeSync(fd); }
  }
  const lower = population.truncated ? "at least " : "";
  // Escape untrusted text, including the forbidden completeness word, so a tool
  // cannot inject a status line or manufacture a completeness claim.
  const quote = (value) => JSON.stringify(value).replaceAll("COMPLETE", "\\u0043OMPLETE");
  return [
    `Receipt files observed: ${lower}${population.receiptFiles.length} (filename-validated population; files, not unique events)`,
    `Receipt files rejected: ${lower}${population.rejectedFiles.length} (filenames)`,
    `Non-receipt files ignored: ${lower}${population.nonMatchingFiles.length}`,
    `Directory scan: ${population.truncated ? "LIMIT REACHED; total population/rejected/ignored counts UNKNOWN" : "enumeration ended; concurrent changes UNKNOWN"}; entries ${population.scannedEntries}/${QUERY_ENTRIES}`,
    `Receipt gaps found: ${population.gaps.length}${population.gapsTruncated ? " (additional gaps UNKNOWN)" : ""} (observed filename population only)`,
    unknownLine(),
    `Decision contents UNKNOWN: ${unknown}; future timestamps: ${future}; other actions: ${other}`,
    `Matching decision claims observed: ${matched}; ALLOW ${allow}; BLOCK ${block}; additional matches ${unknown || population.truncated ? "UNKNOWN" : "not observed"}`,
    `Signature, event occurrence, current route and server: UNKNOWN (claims only; use seal verify with a trusted key for signature checking)`,
    `Most recent observed claims: ${rows.length}/${limit}; history time in epoch milliseconds (seal.history-time/v1); inclusive window ${since}..${until}; read bytes ${bytesRead}/${QUERY_TOTAL_BYTES}`,
    ...rows.map((row) => `${row.now} ${row.decision} tool ${quote(row.tool)}`),
  ];
}

async function queryCommand(args) {
  try {
    if (!args.length || args.length % 2 !== 1) throw new Error("arguments");
    const options = {};
    for (let i = 1; i < args.length; i += 2) {
      const name = args[i].replace(/^--/, "");
      if (args[i] !== `--${name}` || !["limit", "since", "until", "tool"].includes(name) || Object.hasOwn(options, name)) throw new Error("arguments");
      if (name !== "tool" && !/^(0|[1-9][0-9]*)$/.test(args[i + 1])) throw new Error("arguments");
      options[name] = name === "tool" ? args[i + 1] : Number(args[i + 1]);
    }
    for (const line of await query(args[0], options)) console.log(line);
  } catch {
    console.error("Receipt query unavailable: UNKNOWN; usage: seal history DIRECTORY [--limit 1..100] [--since EPOCH_MS] [--until EPOCH_MS] [--tool NAME]");
    process.exitCode = 1;
  }
}
module.exports.query = query;
module.exports.queryCommand = queryCommand;
