// SPDX-License-Identifier: Apache-2.0
// Supported release lanes are explicit. Install/demo portability and Protect
// process-identity support are separate answers. The env overrides exist only
// so both boundaries and their refusals are testable.
// Seal supports only the explicit install/demo platform pairs below; Protect
// support is separately narrower.
function platformSupport() {
  const platform = process.env.SEAL_SPINE_PLATFORM || process.platform;
  const arch = process.env.SEAL_SPINE_ARCH || process.arch;
  const installSupported = platform === "linux" && arch === "x64"
    || platform === "darwin" && (arch === "x64" || arch === "arm64");
  const protectSupported = platform === "linux" && arch === "x64";
  return { supported: installSupported, installSupported, protectSupported, platform, arch };
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
  const { installSupported, platform, arch } = platformSupport();
  if (!installSupported) {
    process.stderr.write(unsupportedPlatformText());
    process.stderr.write(`REFUSE unsupported_platform: this is ${platform}-${arch}\n`);
    process.exit(1);
  }
}

function requireProtectSupportedPlatform() {
  const { protectSupported, platform, arch } = platformSupport();
  if (protectSupported) return;
  process.stderr.write(unsupportedPlatformText());
  if (platform === "darwin") {
    process.stderr.write(`REFUSE unsupported_platform: Protect is not supported on macOS yet; this is ${platform}-${arch}\n`);
  } else {
    process.stderr.write(`REFUSE unsupported_platform: this is ${platform}-${arch}\n`);
  }
  process.exit(1);
}

module.exports = {
  platformSupport,
  requireProtectSupportedPlatform,
  requireSupportedPlatform,
  unsupportedPlatformText,
};
