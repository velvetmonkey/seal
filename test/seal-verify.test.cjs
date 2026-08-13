const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const test = require("node:test");

const CLI = path.join(__dirname, "../bin/seal");
const env = (cache) => ({ ...process.env, SEAL_CACHE_DIR: cache });
function run(args, cache) {
  try {
    return { code: 0, out: execFileSync(process.execPath, [CLI, ...args], { env: env(cache), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }) };
  } catch (error) { return { code: error.status, out: `${error.stdout}${error.stderr}` }; }
}

test("verify refuses absent, empty, unreadable, directory, and invalid JSON paths", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "seal-verify-inputs-"));
  const cache = fs.mkdtempSync(path.join(os.tmpdir(), "seal-verify-cache-"));
  for (const [name, pattern] of [["absent.json", /cannot read receipt/], ["empty.json", /receipt is empty/], ["bad.json", /not valid JSON/], ["directory", /not a readable file/], ["unreadable.json", /not a readable file/]]) {
    const target = path.join(root, name);
    if (name === "empty.json") fs.writeFileSync(target, "");
    else if (name === "bad.json") fs.writeFileSync(target, "{");
    else if (name === "directory") fs.mkdirSync(target);
    else if (name === "unreadable.json") { fs.writeFileSync(target, "{}"); fs.chmodSync(target, 0o000); }
    const result = run(["verify", target], cache);
    assert.notEqual(result.code, 0, `${name} unexpectedly passed: ${result.out}`);
    assert.match(result.out, pattern);
  }
});
