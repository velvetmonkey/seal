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
            typeof existing.startWitness !== "string" || !existing.startWitness) {
          throw new StoreError("invalid approval journal lock owner");
        }
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

module.exports = { createJournal, openJournal, StoreError };
