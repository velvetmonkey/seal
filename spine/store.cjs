// SPDX-License-Identifier: Apache-2.0
// Durable approval-state journal. Legacy NDJSON events remain readable; a
// checkpoint replaces the replay prefix with pending records and permanent
// terminal tombstones. All mutations share the approval transaction lock.
//
// Silence must fail: an ABSENT store is a refusal, not an empty store —
// creation is a deliberate separate act (createJournal), never something
// open does silently, so a deleted or substituted journal can never launder
// consumed approvals back to life. Unreadable or corrupt state throws; the
// caller exits non-zero and never approves over it.
const fs = require("node:fs");
const { writeCompleteSync } = require("./write.cjs");
const path = require("node:path");
const crypto = require("node:crypto");
const { ProtectionError, lockOwnerIsLive, processStartWitness } = require("./protection.cjs");

class StoreError extends Error {}

function createJournal(filePath) {
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
    fs.writeFileSync(filePath, "", { mode: 0o600, flag: "wx" });
  } catch (error) {
    throw new StoreError(`approval store could not be created: ${filePath}: ${error.message}`);
  }
}

function readEvents(filePath) {
  let raw;
  try {
    raw = fs.readFileSync(filePath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") {
      throw new StoreError(`approval store is absent: ${filePath}; initialise it deliberately before gating`);
    }
    throw new StoreError(`approval store is unreadable: ${filePath}: ${error.message}`);
  }
  const events = [];
  const lines = raw.split("\n");
  for (const [index, line] of lines.entries()) {
    if (line.trim() === "") continue;
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      throw new StoreError(`approval store is corrupt: ${filePath} line ${index + 1} is not JSON`);
    }
    if (typeof event.type !== "string") {
      throw new StoreError(`approval store is corrupt: ${filePath} line ${index + 1} has no event type`);
    }
    events.push(event);
  }
  return events;
}

const TERMINAL_STATUSES = new Set(["consumed", "declined", "cancelled", "expired", "restart_invalidated"]);
const CHECKPOINT_TYPE = "approval_checkpoint";
const COMPACT_BYTES = 4 * 1024 * 1024;
const COMPACT_EVENTS = 2048;

// This is also the contract's replay function: compaction cannot use a
// different interpretation of status transitions from authorization.
function replayApprovalEvents(events) {
  const records = new Map();
  const corrupt = (why) => { throw new StoreError(`approval store is inconsistent: ${why}`); };
  const insert = (record) => {
    if (!record || !/^[0-9a-f]{64}$/.test(record.handle_hash) || records.has(record.handle_hash)) {
      corrupt("invalid or duplicate handle hash");
    }
    records.set(record.handle_hash, record);
  };
  for (const [index, event] of events.entries()) {
    if (event.type === CHECKPOINT_TYPE) {
      if (index !== 0 || event.version !== 1 || !Array.isArray(event.records) ||
          event.count !== event.records.length || event.sha256 !== checkpointHash(event.records)) {
        corrupt("invalid checkpoint position, version, count or digest");
      }
      for (const record of event.records) {
        if (record?.status !== "pending" && !TERMINAL_STATUSES.has(record?.status)) corrupt("invalid checkpoint status");
        insert({ ...record });
      }
    } else if (event.type === "issued") {
      const { type, ...record } = event;
      insert({ ...record, status: "pending" });
    } else if (event.type === "status") {
      const record = records.get(event.handle_hash);
      if (!record) corrupt(`status for unknown handle hash ${event.handle_hash}`);
      if (!TERMINAL_STATUSES.has(event.status) ||
          (record.status !== "pending" && record.status !== event.status)) corrupt("non-monotonic status transition");
      // Terminal authorization depends only on identity and the refusal.
      // Retain those forever; the archived journal retains the full evidence.
      records.set(event.handle_hash, { handle_hash: event.handle_hash, status: event.status });
    } else {
      corrupt(`unknown event type ${event.type}`);
    }
  }
  return records;
}

function checkpointHash(records) {
  return crypto.createHash("sha256").update(JSON.stringify(records)).digest("hex");
}

function stateBytes(records) {
  return JSON.stringify([...records.values()].map(record => record.status === "pending"
    ? record : { handle_hash: record.handle_hash, status: record.status }));
}

function withFileLock(filePath, callback) {
  const lockPath = `${filePath}.lock`;
  const owner = { pid: process.pid, startWitness: processStartWitness(process.pid) };
  if (owner.startWitness === null) {
    throw new ProtectionError(
      "process_witness_unavailable",
      `cannot establish process-start witness for approval-journal-lock owner pid ${owner.pid}; fix the local process-start witness source and retry`,
    );
  }
  // Keep the private inode linked until release so its identity cannot be
  // recycled. Only fully written, synced owner records become public.
  const temporary = `${lockPath}.${process.pid}.${crypto.randomBytes(16).toString("hex")}`;
  const fd = fs.openSync(temporary, "wx", 0o600);
  const identity = fs.fstatSync(fd);
  const same = (a, b) => a.dev === b.dev && a.ino === b.ino;
  const stat = (file) => {
    try { return fs.lstatSync(file); }
    catch (error) { if (error.code === "ENOENT") return null; throw error; }
  };
  let acquired = false;
  try {
    writeCompleteSync(fd, JSON.stringify(owner) + "\n");
    fs.fsyncSync(fd);
    for (;;) {
      try {
        fs.linkSync(temporary, lockPath);
        acquired = true;
        break;
      } catch (error) {
        if (error.code !== "EEXIST") throw error;
      }
      let existing, observed;
      let reader;
      try {
        reader = fs.openSync(lockPath, "r");
        observed = fs.fstatSync(reader);
        existing = JSON.parse(fs.readFileSync(reader, "utf8"));
        if (!observed.isFile() || !Number.isSafeInteger(existing?.pid) || existing.pid <= 0 ||
            (existing.startWitness !== null &&
             (typeof existing.startWitness !== "string" || !existing.startWitness))) {
          throw new StoreError("invalid approval journal lock owner");
        }
        // A complete legacy record with an explicit null witness is stale:
        // acquisition has always refused to create such an owner. Missing or
        // truncated records above cannot authorize recovery.
        if (!lockOwnerIsLive(existing, "approval-journal-lock owner")) {
          // Elect exactly one reaper per stale inode. Retain this hard link:
          // deleting it would let a delayed reaper win again and unlink a new
          // acquisition (and retaining it prevents inode-number reuse).
          const recovery = `${lockPath}.reaped.${observed.dev}.${observed.ino}`;
          try { fs.linkSync(lockPath, recovery); }
          catch (error) {
            if (error.code === "ENOENT") continue;
            if (error.code === "EEXIST") {
              const current = stat(lockPath);
              if (!current || !same(current, observed)) continue;
              throw new StoreError("approval journal lock recovery is in progress or interrupted; retry, then inspect if persistent");
            }
            throw error;
          }
          const claimed = stat(recovery);
          const current = stat(lockPath);
          if (claimed && current && same(claimed, observed) && same(current, observed)) fs.unlinkSync(lockPath);
          continue;
        }
      } catch (error) {
        if (error.code === "ENOENT") continue;
        if (error instanceof SyntaxError) throw new StoreError("incomplete or invalid approval journal lock owner; inspect before retrying");
        throw error;
      } finally {
        if (reader !== undefined) fs.closeSync(reader);
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
    }
    return callback();
  } finally {
    try {
      const current = stat(lockPath);
      if (acquired && current && same(current, identity)) fs.unlinkSync(lockPath);
    } finally {
      try { fs.closeSync(fd); } finally { fs.unlinkSync(temporary); }
    }
  }
}

function openJournal(filePath) {
  let events = readEvents(filePath);
  let locked = false;
  function compactLocked() {
    const before = replayApprovalEvents(events);
    const records = JSON.parse(stateBytes(before));
    const checkpoint = { type: CHECKPOINT_TYPE, version: 1, count: records.length,
      records, sha256: checkpointHash(records) };
    const suffix = crypto.randomBytes(16).toString("hex");
    const temporary = `${filePath}.checkpoint.${suffix}`;
    const archive = `${filePath}.history.${suffix}`;
    let fd, directory;
    try {
      directory = fs.openSync(path.dirname(filePath), "r");
      // Make the source durable, then retain its inode as historical evidence
      // before publishing a replacement. Archives are never replayed or pruned.
      fd = fs.openSync(filePath, "r");
      fs.fsyncSync(fd);
      fs.closeSync(fd); fd = undefined;
      fs.linkSync(filePath, archive);
      fs.fsyncSync(directory);
      fd = fs.openSync(temporary, "wx", 0o600);
      writeCompleteSync(fd, JSON.stringify(checkpoint) + "\n");
      fs.fsyncSync(fd);
      fs.closeSync(fd); fd = undefined;
      const candidate = readEvents(temporary);
      if (stateBytes(replayApprovalEvents(candidate)) !== stateBytes(before)) {
        throw new StoreError("approval checkpoint changes authorization state; refusing publication");
      }
      // A reader sees either complete inode. A writer must refresh after
      // acquiring this same lock, and therefore appends only to the new one.
      fs.renameSync(temporary, filePath);
      fs.fsyncSync(directory);
      events = candidate;
      return { archive, records: records.length };
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
      if (directory !== undefined) fs.closeSync(directory);
      try { fs.unlinkSync(temporary); } catch (error) { if (error.code !== "ENOENT") throw error; }
    }
  }
  function transact(callback, automatic) {
    if (locked) return callback();
    return withFileLock(filePath, () => {
      locked = true;
      try {
        // Also finish a previous publisher's rename if its directory fsync
        // failed. No subsequent decision may depend on an unsynced name.
        const directory = fs.openSync(path.dirname(filePath), "r");
        try { fs.fsyncSync(directory); } finally { fs.closeSync(directory); }
        journal.refresh();
        // Bound replay of verbose events, not the number of permanent
        // tombstones. Never discard identities to satisfy a size cap.
        if (automatic && events.length >= COMPACT_EVENTS && fs.statSync(filePath).size >= COMPACT_BYTES) compactLocked();
        return callback();
      } finally { locked = false; }
    });
  }
  const journal = {
    get events() { return events; },
    refresh() {
      events = readEvents(filePath);
      return events;
    },
    withLock(callback) { return transact(callback, true); },
    compact() { return transact(compactLocked, false); },
    append(event) {
      if (!locked) return journal.withLock(() => journal.append(event));
      const fd = fs.openSync(filePath, "a", 0o600);
      const before = fs.fstatSync(fd).size;
      try {
        writeCompleteSync(fd, JSON.stringify(event) + "\n");
        fs.fsyncSync(fd);
        events.push(event);
      } catch (error) {
        // A failed append must not leave a torn final line that bricks replay.
        // Callers serialize approval transactions with withLock.
        try {
          fs.ftruncateSync(fd, before);
          fs.fsyncSync(fd);
        } catch (rollbackError) {
          throw new AggregateError([error, rollbackError], "approval append and rollback failed");
        }
        throw error;
      } finally {
        fs.closeSync(fd);
      }
    },
  };
  return journal;
}

module.exports = { createJournal, openJournal, replayApprovalEvents, StoreError };
