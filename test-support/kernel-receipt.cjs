// SPDX-License-Identifier: Apache-2.0
// Test helper that emits the same v2 envelope as the product from a real
// invocation of the pinned authorization kernel.
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const { createKernelAuthorizationAdapter } = require("../contract/kernel-authorization.cjs");
const { canonical, sealReceipt } = require("../spine/receipt-v2.cjs");

async function writeKernelReceipt(_cacheRoot, dataHome) {
  const tool = "db.execute";
  const args = { database: "demo", sql: "drop table users" };
  const record = createKernelAuthorizationAdapter().authorize({
    epoch: 1,
    issuedTool: tool,
    issuedArgs: args,
    retryTool: tool,
    retryArgs: args,
    accepted: true,
    now: 1000,
  }).receipt_record;
  const receiptDir = path.join(dataHome, "seal", "receipts");
  fs.mkdirSync(receiptDir, { recursive: true, mode: 0o700 });
  const receipt = path.join(receiptDir, `receipt-${Date.now()}-${process.pid}-${crypto.randomBytes(4).toString("hex")}.json`);
  fs.writeFileSync(receipt, canonical(sealReceipt(null, record, "ALLOW")), { mode: 0o600 });
  return receipt;
}

module.exports = { writeKernelReceipt };
