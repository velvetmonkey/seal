// SPDX-License-Identifier: Apache-2.0
// Supported release lanes are explicit. Anything else is unsupported —
// not untested, not a warning. The env overrides exist only so the refusal
// itself is testable.
// Seal supports only the explicit platform and architecture pairs below.
function platformSupport() {
  const platform = process.env.SEAL_SPINE_PLATFORM || process.platform;
  const arch = process.env.SEAL_SPINE_ARCH || process.arch;
  const supported = platform === "linux" && arch === "x64"
    || platform === "darwin" && (arch === "x64" || arch === "arm64");
  return { supported, platform, arch };
}

function unsupportedPlatformText() {
  return [
    "UNSUPPORTED PLATFORM",
    "",
    "Seal v0.2.0-rc.3.",
    "macOS source portability is CI-exercised for install, demo and receipt checking.",
    "Protect is not supported on macOS yet.",
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
