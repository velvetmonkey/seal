// SPDX-License-Identifier: Apache-2.0
const fs = require('node:fs');

// Persistence boundaries fail closed on any incomplete write, including zero
// progress. writeFileSync retries short writes but can spin on a zero return;
// here the caller must abort the transaction instead of reporting success.
function writeCompleteSync(fd, data) {
  const bytes = Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8');
  const written = fs.writeSync(fd, bytes, 0, bytes.length);
  if (written !== bytes.length) {
    const error = new Error(`incomplete write: wrote ${written} of ${bytes.length} bytes`);
    error.code = 'EIO';
    throw error;
  }
}
module.exports = { writeCompleteSync };
