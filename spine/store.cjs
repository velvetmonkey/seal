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

function openJournal(filePath) {
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
  return {
    events,
    append(event) {
      const fd = fs.openSync(filePath, "a", 0o600);
      try {
        fs.writeSync(fd, JSON.stringify(event) + "\n");
        fs.fsyncSync(fd);
      } finally {
        fs.closeSync(fd);
      }
    },
  };
}

module.exports = { createJournal, openJournal, StoreError };
