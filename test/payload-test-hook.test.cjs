const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { PAYLOAD_PATHS } = require("../scripts/build-dist.cjs");

const ROOT = path.join(__dirname, "..");
const TEST_HOOK = "process.env.SEAL_TEST";

test("the shipped payload refuses test environment hooks", () => {
  const hits = [];
  for (const file of PAYLOAD_PATHS) {
    const lines = fs.readFileSync(path.join(ROOT, file), "utf8").split(/\r?\n/);
    lines.forEach((line, index) => {
      if (line.includes(TEST_HOOK)) hits.push(`${file}:${index + 1}`);
    });
  }
  assert.deepEqual(hits, [], `REFUSE payload_test_hook: ${hits.join(", ")} reads ${TEST_HOOK}`);
});
