const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const test = require("node:test");

test("seal demo fails closed when the runtime cannot be downloaded", () => {
  const cache = fs.mkdtempSync(path.join(os.tmpdir(), "seal-runtime-test-"));
  assert.throws(
    () => execFileSync(process.execPath, [path.join(__dirname, "../bin/seal"), "demo"], {
      env: { ...process.env, SEAL_CACHE_DIR: cache, SEAL_RUNTIME_BASE_URL: "http://127.0.0.1:1/no-runtime" },
      input: "n\n", encoding: "utf8", stdio: ["pipe", "pipe", "pipe"],
    }),
    /runtime download failed|fetch failed|ECONNREFUSED/,
  );
});
