// SPDX-License-Identifier: Apache-2.0
// Seal-owned product loader. Only the pre-signed envelope and its independent
// public-key pin reach seal_init. No signing key exists in this module.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { pathToFileURL } = require("node:url");

let loaded;
async function load(kernelRoot) {
  if (loaded) return loaded;
  const wasmDir = path.join(kernelRoot, "wasm");
  globalThis.require = require;
  globalThis.__dirname = wasmDir;
  (0, eval)(fs.readFileSync(path.join(wasmDir, "seal.js"), "utf8"));
  const M = await globalThis.SealModule({ locateFile: (name) => path.join(wasmDir, name), print() {}, printErr() {} });
  const cfg = await import(pathToFileURL(path.join(kernelRoot, "seal-config.js")).href);
  const K = await import(pathToFileURL(path.join(kernelRoot, "kernel.js")).href);
  loaded = { M, cfg, K, wasmDir };
  return loaded;
}

async function decide(kernelRoot, envelope, publicKey, config, call) {
  const { M, cfg, K, wasmDir } = await load(kernelRoot);
  const init = JSON.parse(M.ccall("seal_init", "string", ["string", "string"], [envelope, publicKey]));
  if (init.ok !== true) throw new Error("seal_init failed: " + JSON.stringify(init));
  const raw = M.ccall("seal_decide", "string", ["string"], [cfg.buildStepInput(call)]);
  const parsed = cfg.parseVerdict(raw, call.tool);
  const computed = crypto.createHash("sha256").update(fs.readFileSync(path.join(wasmDir, "seal.wasm"))).digest("hex");
  const receipt = JSON.parse(K.canonicalReceiptJson(K.buildReceipt({
    call, config, parsed, raw,
    sha: { computed, pinned: K.KERNEL_WASM_SHA256, match: computed === K.KERNEL_WASM_SHA256 },
  })));
  return { raw, verdict: receipt.verdict, receipt };
}

module.exports = { load, decide };
