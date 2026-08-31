// SPDX-License-Identifier: Apache-2.0
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { testTmpdir } = require("../scripts/temp-root.cjs");
const { helperPlatform, requireHelperPlatform } = require("../scripts/macos-helper.cjs");

function thinMachO(cpuType) {
  const bytes = Buffer.alloc(32);
  bytes.writeUInt32LE(0xfeedfacf, 0);
  bytes.writeUInt32LE(cpuType, 4);
  return bytes;
}

test("thin Mach-O helpers are identified by CPU type", () => {
  assert.equal(helperPlatform(thinMachO(0x01000007)), "darwin-x64");
  assert.equal(helperPlatform(thinMachO(0x0100000c)), "darwin-arm64");
});

test("the architecture gate refuses a deliberately wrong helper", () => {
  const directory = testTmpdir(path.join(os.tmpdir(), "seal-macos-helper-"));
  const helper = path.join(directory, "macos-process-start-witness");
  try {
    fs.writeFileSync(helper, thinMachO(0x01000007));
    assert.throws(
      () => requireHelperPlatform(helper, "darwin-arm64"),
      (error) => error.code === "macos_helper_architecture" &&
        error.message === "REFUSE macos_helper_architecture: expected darwin-arm64 helper, got darwin-x64",
    );
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("the architecture gate refuses non-Mach-O input", () => {
  assert.throws(
    () => helperPlatform(Buffer.from("not a native helper")),
    (error) => error.code === "macos_helper_architecture" && /not a thin Mach-O/.test(error.message),
  );
});
