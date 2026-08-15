// SPDX-License-Identifier: Apache-2.0
// Named product adapter for the proved authorization kernel. Node owns retry
// state; this adapter answers only whether the issue-time authorization binds
// the exact retried tool, arguments, context, and affirmative answer.
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const PRODUCT_ROOT = path.resolve(__dirname, "..");
const DEFAULT_KERNEL_ROOT = path.join(PRODUCT_ROOT, "runtime", "kernel");
const DEFAULT_MANIFEST = path.join(PRODUCT_ROOT, "runtime-manifest.json");
const DEFAULT_KERNEL_TIMEOUT_MS = 5000;

class KernelAuthorizationError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "KernelAuthorizationError";
    this.code = code;
  }
}

function sha256File(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function expectedWasmSha(manifestPath) {
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  } catch (error) {
    throw new KernelAuthorizationError("kernel_manifest_refused", `cannot read the kernel manifest: ${error.message}`);
  }
  const expected = manifest.files?.["kernel/wasm/seal.wasm"];
  if (!/^[0-9a-f]{64}$/.test(expected || "")) {
    throw new KernelAuthorizationError("kernel_manifest_refused", "the kernel manifest has no valid wasm pin");
  }
  return expected;
}

function createKernelAuthorizationAdapter({
  kernelRoot = DEFAULT_KERNEL_ROOT,
  manifestPath = DEFAULT_MANIFEST,
  workerPath = path.join(__dirname, "kernel-authorization-worker.cjs"),
  workerTimeoutMs = DEFAULT_KERNEL_TIMEOUT_MS,
} = {}) {
  return {
    authorize(input) {
      const wasmPath = path.join(kernelRoot, "wasm", "seal.wasm");
      const expected = expectedWasmSha(manifestPath);
      let computed;
      try {
        computed = sha256File(wasmPath);
      } catch (error) {
        throw new KernelAuthorizationError("kernel_integrity_refused", `cannot hash the vendored wasm: ${error.message}`);
      }
      if (computed !== expected) {
        throw new KernelAuthorizationError(
          "kernel_integrity_refused",
          `vendored wasm sha256 ${computed} does not match pinned ${expected}; no JavaScript fallback exists`,
        );
      }

      const child = spawnSync(process.execPath, [workerPath, kernelRoot], {
        input: JSON.stringify(input),
        encoding: "utf8",
        timeout: workerTimeoutMs,
        killSignal: "SIGKILL",
        maxBuffer: 8 * 1024 * 1024,
      });
      if (child.error?.code === "ETIMEDOUT") {
        throw new KernelAuthorizationError(
          "kernel_execution_refused",
          `kernel worker exceeded its ${workerTimeoutMs} ms deadline`,
        );
      }
      if (child.error) {
        throw new KernelAuthorizationError("kernel_execution_refused", `kernel worker could not start: ${child.error.message}`);
      }
      if (child.status !== 0) {
        const detail = (child.stderr || child.stdout || `worker exited ${child.status}`).trim();
        throw new KernelAuthorizationError("kernel_execution_refused", detail);
      }
      let answer;
      try {
        answer = JSON.parse(child.stdout);
      } catch (error) {
        throw new KernelAuthorizationError("kernel_output_refused", `kernel worker returned unreadable output: ${error.message}`);
      }
      if (answer.verdict !== "ALLOW" && answer.verdict !== "BLOCK") {
        throw new KernelAuthorizationError("kernel_output_refused", `kernel returned unexpected verdict ${JSON.stringify(answer.verdict)}`);
      }
      return { ...answer, wasm_sha256: computed };
    },
  };
}

module.exports = {
  createKernelAuthorizationAdapter,
  KernelAuthorizationError,
  DEFAULT_KERNEL_ROOT,
  DEFAULT_MANIFEST,
  DEFAULT_KERNEL_TIMEOUT_MS,
};
