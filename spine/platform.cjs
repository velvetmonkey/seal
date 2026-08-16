// SPDX-License-Identifier: Apache-2.0
// The supported lane is Linux x86-64 only. Anything else is unsupported —
// not untested, not a warning. The env overrides exist only so the refusal
// itself is testable.
function platformSupport() {
  const platform = process.env.SEAL_SPINE_PLATFORM || process.platform;
  const arch = process.env.SEAL_SPINE_ARCH || process.arch;
  const supported = platform === "linux" && arch === "x64";
  return { supported, platform, arch };
}

function unsupportedPlatformText() {
  return [
    "UNSUPPORTED PLATFORM",
    "",
    "Seal v0.2.0-rc.1 supports Linux x86-64 only.",
    "macOS arm64 has not completed Seal's end-to-end acceptance path.",
    "",
    "No files were changed.",
    "",
  ].join("\n");
}

function requireSupportedPlatform() {
  const { supported, platform, arch } = platformSupport();
  if (!supported) {
    process.stderr.write(unsupportedPlatformText());
    process.stderr.write(`REFUSE unsupported_platform: this is ${platform}-${arch}\n`);
    process.exit(1);
  }
}

module.exports = { platformSupport, requireSupportedPlatform, unsupportedPlatformText };
