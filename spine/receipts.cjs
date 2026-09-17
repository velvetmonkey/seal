// SPDX-License-Identifier: Apache-2.0
// Receipt emission. One JSON file per decision, atomically published and
// directory-fsynced. Receipts are claims
// by this process about what it decided and observed; nothing here verifies
// anything, and no caller may print a verification claim on the back of one.
// Filenames carry timestamp, pid and sequence so a restarted proxy writing
// into the same directory can never collide with an earlier session.
const fs = require("node:fs");
const { writeCompleteSync } = require("./write.cjs");
const path = require("node:path");
const { canonical, sealReceipt } = require("./receipt-v2.cjs");

function openReceiptEmitter(directory, signer) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  let sequence = 0;
  return {
    emit(record, action) {
      const name = `receipt-${Date.now()}-${process.pid}-${String(sequence + 1).padStart(4, "0")}-${action}.json`;
      const target = path.join(directory, name);
      const body = sealReceipt(signer, record, action);
      // Reserve this final name across emitters, including ones whose clocks
      // and sequences coincide. Hidden .tmp files are not receipt filenames.
      const temporary = path.join(directory, `.${name}.tmp`);
      const fd = fs.openSync(temporary, "wx", 0o600);
      try {
        try {
          // rename replaces destinations: check while holding the exclusive
          // temp reservation so an existing receipt (or symlink) is never lost.
          let exists = false;
          try {
            fs.lstatSync(target);
            exists = true;
          } catch (error) {
            if (error.code !== "ENOENT") throw error;
          }
          if (exists) {
            const error = new Error(`receipt already exists: ${target}`);
            error.code = "EEXIST";
            throw error;
          }
          writeCompleteSync(fd, canonical(body));
          fs.fsyncSync(fd);
        } finally {
          fs.closeSync(fd);
        }
        fs.renameSync(temporary, target);
      } catch (error) {
        // Never remove the final receipt, even if rename completed before an
        // error was reported. Preserve the original failure if cleanup fails.
        try { fs.unlinkSync(temporary); } catch (cleanupError) {
          if (cleanupError.code !== "ENOENT") error.cleanupError = cleanupError;
        }
        throw error;
      }
      const directoryFd = fs.openSync(directory, "r");
      try {
        fs.fsyncSync(directoryFd);
      } finally {
        fs.closeSync(directoryFd);
      }
      sequence += 1;
      return target;
    },
  };
}

module.exports = { openReceiptEmitter };
