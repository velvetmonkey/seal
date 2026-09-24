// SPDX-License-Identifier: Apache-2.0
// Shared, read-only runtime preflight for CLI and MCP receipt verification.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const ROOT = path.resolve(__dirname, "..");
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "runtime-manifest.json"), "utf8"));
const cache = path.join(process.env.SEAL_CACHE_DIR || path.join(os.homedir(), ".cache", "seal"), "runtime", manifest.commit);
const shippedRuntime = path.join(ROOT, "runtime");
const shippedRuntimeFiles = Object.entries(manifest.files).filter(([relative]) => relative.startsWith("kernel/"));

function sha256(bytes) { return crypto.createHash("sha256").update(bytes).digest("hex"); }
function inspectRuntimeAt(directory, files) {
  for (const [relative, expected] of files) {
    const target = path.join(directory, relative);
    try {
      if (!fs.statSync(target).isFile()) return { present: false, state: "absent", reason: `${relative} is not a file` };
      const got = sha256(fs.readFileSync(target));
      if (got !== expected) return { present: false, state: "integrity check failed", reason: `${relative} hash mismatch` };
    } catch (error) {
      return { present: false, state: "absent", reason: `${relative} is unavailable` };
    }
  }
  return { present: true };
}
function inspectRuntime() {
  // The installed artifact ships the kernel, while src/verify.cjs is fetched
  // into the cache for the optional verification command. Never treat a bad
  // shipped kernel as a reason to use an unchecked fallback.
  const shipped = inspectRuntimeAt(shippedRuntime, shippedRuntimeFiles);
  if (shipped.present || shipped.state === "integrity check failed") return shipped;
  return inspectRuntimeAt(cache, Object.entries(manifest.files));
}
module.exports = { inspectRuntime };
