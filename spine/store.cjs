// SPDX-License-Identifier: Apache-2.0
// Durable approval-state journal. Append-only NDJSON of contract events,
// fsynced per append, replayed at open to rebuild the contract's state so
// one-use survives a process restart.
//
// Silence must fail: an ABSENT store is a refusal, not an empty store —
// creation is a deliberate separate act (createJournal), never something
// open does silently, so a deleted or substituted journal can never launder
// consumed approvals back to life. Unreadable or corrupt state throws; the
// caller exits non-zero and never approves over it.
const fs = require("node:fs");
const path = require("node:path");

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

function processStartWitness(pid) {
  if (!Number.isInteger(pid) || pid <= 0 || process.platform !== "linux") return null;
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, "utf8");
    const close = stat.lastIndexOf(")");
    if (close < 0) return null;
    return stat.slice(close + 2).trim().split(/\s+/)[19] || null;
  } catch {
    return null;
  }
}

function liveLockOwner(owner) {
  if (!owner || !Number.isInteger(owner.pid) || owner.pid <= 0) return false;
  try { process.kill(owner.pid, 0); } catch { return false; }
  return owner.startWitness === processStartWitness(owner.pid);
}

function withFileLock(filePath, callback) {
  const lockPath = `${filePath}.lock`;
  const owner = { pid: process.pid, startWitness: processStartWitness(process.pid) };
  for (;;) {
    try {
      const fd = fs.openSync(lockPath, "wx", 0o600);
      try {
        fs.writeSync(fd, JSON.stringify(owner) + "\n");
        fs.fsyncSync(fd);
      } finally {
        fs.closeSync(fd);
      }
      break;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      let existing;
      try { existing = JSON.parse(fs.readFileSync(lockPath, "utf8")); } catch { existing = null; }
      if (!liveLockOwner(existing)) {
        try { fs.unlinkSync(lockPath); } catch (unlinkError) {
          if (unlinkError.code !== "ENOENT") throw unlinkError;
        }
        continue;
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
    }
  }
  try {
    return callback();
  } finally {
    try { fs.unlinkSync(lockPath); } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
}

function openJournal(filePath) {
  let events = readEvents(filePath);
  const journal = {
    get events() { return events; },
    refresh() {
      events = readEvents(filePath);
      return events;
    },
    withLock(callback) {
      return withFileLock(filePath, () => {
        journal.refresh();
        return callback();
      });
    },
    append(event) {
      const fd = fs.openSync(filePath, "a", 0o600);
      try {
        fs.writeSync(fd, JSON.stringify(event) + "\n");
        fs.fsyncSync(fd);
        events.push(event);
      } finally {
        fs.closeSync(fd);
      }
    },
  };
  return journal;
}

module.exports = { createJournal, openJournal, StoreError };
