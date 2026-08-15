// SPDX-License-Identifier: Apache-2.0
// Test helper: produce a genuine kernel receipt through the pinned
// assurance-kit runtime, exactly as the retired wasm demo used to. The
// spine demo no longer emits kernel receipts, but `seal verify` and
// `seal status` still consume them, so their tests build one here.
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "runtime-manifest.json"), "utf8"));

async function ensureRuntime(cacheRoot) {
  const base = process.env.SEAL_RUNTIME_BASE_URL ||
    `https://raw.githubusercontent.com/${manifest.repository}/${manifest.commit}`;
  const cache = path.join(cacheRoot, "runtime", manifest.commit);
  for (const [relative, expected] of Object.entries(manifest.files)) {
    const target = path.join(cache, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    if (fs.existsSync(target)) continue;
    const response = await fetch(`${base}/${relative}`);
    if (!response.ok) throw new Error(`runtime download failed: ${response.status} ${relative}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    const got = crypto.createHash("sha256").update(bytes).digest("hex");
    if (got !== expected) throw new Error(`runtime hash mismatch for ${relative}: ${got}`);
    fs.writeFileSync(target, bytes, { mode: 0o600 });
  }
  return cache;
}

// Writes one ALLOW kernel receipt into dataHome/seal/receipts and returns its path.
async function writeKernelReceipt(cacheRoot, dataHome) {
  const runtime = await ensureRuntime(cacheRoot);
  const config = await import(pathToFileURL(path.join(runtime, "kernel/seal-config.js")));
  const runner = require(path.join(runtime, "kernel/runner.cjs"));
  const call = { tool: "db.execute", args: { database: "demo", sql: "drop table users" }, now: 1000 };
  const target = config.guardTarget(call.tool, call.args);
  const allowed = await runner.decide(config.SCENARIOS["destructive-sql"].config, { ...call, approvals: [target] });
  if (allowed.verdict !== "ALLOW") throw new Error(`helper expected ALLOW, got ${allowed.verdict}`);
  const receiptDir = path.join(dataHome, "seal", "receipts");
  fs.mkdirSync(receiptDir, { recursive: true, mode: 0o700 });
  const receipt = path.join(receiptDir, `receipt-${Date.now()}-${process.pid}-${crypto.randomBytes(4).toString("hex")}.json`);
  fs.writeFileSync(receipt, JSON.stringify(allowed.receipt, null, 2) + "\n", { mode: 0o600 });
  return receipt;
}

module.exports = { writeKernelReceipt };
