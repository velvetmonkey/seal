// SPDX-License-Identifier: Apache-2.0
// The supported lane is deliberately tiny: macOS arm64 and Linux x86-64.
// Anything else is unsupported — not untested, not a warning. The env
// overrides exist only so the refusal itself is testable.
function platformSupport() {
  const platform = process.env.SEAL_SPINE_PLATFORM || process.platform;
  const arch = process.env.SEAL_SPINE_ARCH || process.arch;
  const supported = (platform === "darwin" && arch === "arm64") || (platform === "linux" && arch === "x64");
  return { supported, platform, arch };
}

function requireSupportedPlatform() {
  const { supported, platform, arch } = platformSupport();
  if (!supported) {
    process.stderr.write(`seal: unsupported: this command supports macOS arm64 and Linux x86-64; this is ${platform}-${arch}\n`);
    process.exit(1);
  }
}

module.exports = { platformSupport, requireSupportedPlatform };
