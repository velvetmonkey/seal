// SPDX-License-Identifier: Apache-2.0
// Receipt emission. One JSON file per decision, fsynced. Receipts are claims
// by this process about what it decided and observed; nothing here verifies
// anything, and no caller may print a verification claim on the back of one.
// Filenames carry timestamp, pid and sequence so a restarted proxy writing
// into the same directory can never collide with an earlier session.
const fs = require("node:fs");
const path = require("node:path");
const { canonical, sealReceipt } = require("./receipt-v2.cjs");

function openReceiptEmitter(directory, signer) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  let sequence = 0;
  return {
    emit(record, action) {
      sequence += 1;
      const name = `receipt-${Date.now()}-${process.pid}-${String(sequence).padStart(4, "0")}-${action}.json`;
      const target = path.join(directory, name);
      const body = sealReceipt(signer, record, action);
      const fd = fs.openSync(target, "wx", 0o600);
      try {
        fs.writeSync(fd, canonical(body));
        fs.fsyncSync(fd);
      } finally {
        fs.closeSync(fd);
      }
      return target;
    },
  };
}

module.exports = { openReceiptEmitter };
