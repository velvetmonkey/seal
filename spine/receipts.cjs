// SPDX-License-Identifier: Apache-2.0
// Receipt emission. One JSON file per decision, fsynced. Receipts are claims
// by this process about what it decided and observed; nothing here verifies
// anything, and no caller may print a verification claim on the back of one.
// Filenames carry timestamp, pid and sequence so a restarted proxy writing
// into the same directory can never collide with an earlier session.
const fs = require("node:fs");
const path = require("node:path");

function openReceiptEmitter(directory) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  let sequence = 0;
  return {
    emit(record) {
      sequence += 1;
      const name = `receipt-${Date.now()}-${process.pid}-${String(sequence).padStart(4, "0")}-${record.decision}.json`;
      const target = path.join(directory, name);
      const fd = fs.openSync(target, "wx", 0o600);
      try {
        fs.writeSync(fd, JSON.stringify({ receipt: "seal.spine/v1", ...record }, null, 2) + "\n");
        fs.fsyncSync(fd);
      } finally {
        fs.closeSync(fd);
      }
      return target;
    },
  };
}

module.exports = { openReceiptEmitter };
