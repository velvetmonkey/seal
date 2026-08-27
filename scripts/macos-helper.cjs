#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Verify that a release-produced macOS helper is a thin Mach-O for the
// architecture named by its artifact. Native helpers are release-produced,
// not independently reproduced.
const fs = require("node:fs");

const CPU_TYPES = new Map([
  [0x01000007, "darwin-x64"],
  [0x0100000c, "darwin-arm64"],
]);

function refuse(reason) {
  const error = new Error(`REFUSE macos_helper_architecture: ${reason}`);
  error.code = "macos_helper_architecture";
  throw error;
}

function helperPlatform(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 8) refuse("helper is too short to be Mach-O");
  const magic = bytes.subarray(0, 4).toString("hex");
  let cpuType;
  if (magic === "cffaedfe" || magic === "cefaedfe") cpuType = bytes.readUInt32LE(4);
  else if (magic === "feedfacf" || magic === "feedface") cpuType = bytes.readUInt32BE(4);
  else refuse(`helper is not a thin Mach-O (magic ${magic})`);
  const platform = CPU_TYPES.get(cpuType);
  if (!platform) refuse(`helper has unsupported Mach-O CPU type 0x${cpuType.toString(16)}`);
  return platform;
}

function requireHelperPlatform(file, expectedPlatform) {
  if (expectedPlatform !== "darwin-x64" && expectedPlatform !== "darwin-arm64") {
    refuse(`expected platform is not macOS: ${expectedPlatform || "<absent>"}`);
  }
  let bytes;
  try { bytes = fs.readFileSync(file); }
  catch (error) { refuse(`cannot read helper ${file}: ${error.message}`); }
  const actual = helperPlatform(bytes);
  if (actual !== expectedPlatform) refuse(`expected ${expectedPlatform} helper, got ${actual}`);
  return actual;
}

function argument(name) {
  const at = process.argv.indexOf(name);
  return at < 0 ? undefined : process.argv[at + 1];
}

if (require.main === module) {
  try {
    const helper = argument("--helper");
    const platform = argument("--platform");
    if (!helper || !platform) refuse("--helper and --platform are required");
    const actual = requireHelperPlatform(helper, platform);
    process.stdout.write(`macos-helper-architecture ${actual}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { helperPlatform, requireHelperPlatform };
