const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const test = require("node:test");

const CLI = path.join(__dirname, "../bin/seal");
function run(args, root, input = "") {
  try {
    return { code: 0, out: execFileSync(process.execPath, [CLI, ...args], {
      env: { ...process.env, HOME: root, XDG_DATA_HOME: path.join(root, ".local", "share"), SEAL_CACHE_DIR: path.join(root, ".cache", "seal") },
      input, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"],
    }) };
  } catch (error) { return { code: error.status, out: `${error.stdout || ""}${error.stderr || ""}` }; }
}

test("status reports an empty fresh machine without network", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "seal-status-empty-"));
  const result = run(["status"], root);
  assert.equal(result.code, 0);
  assert.match(result.out, /^Runtime: absent /m);
  assert.match(result.out, /^Receipts: 0 stored in .* \(directory does not exist\)$/m);
  assert.match(result.out, /^Most recent: none observed$/m);
});

test("status reports the demo runtime and receipt, and names corruption", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "seal-status-demo-"));
  const demo = run(["demo"], root, "y\n");
  assert.equal(demo.code, 0, demo.out);
  const receiptDir = path.join(root, ".local", "share", "seal", "receipts");
  fs.writeFileSync(path.join(receiptDir, "corrupt.json"), "not json\n");
  const result = run(["status"], root);
  assert.equal(result.code, 0);
  assert.match(result.out, /^Runtime: present seal-assurance-kit@/m);
  assert.match(result.out, /^Receipts: 2 stored in /m);
  assert.match(result.out, /^Receipt unreadable: corrupt\.json \(Unexpected token/m);
  assert.match(result.out, /^Most recent: ALLOW at receipt time 1000 \(/m);
});
