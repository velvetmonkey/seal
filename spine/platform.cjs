// SPDX-License-Identifier: Apache-2.0
// Supported release lanes are explicit. This module describes the capability
// contract carried by the build; it deliberately performs no machine I/O.
// Readiness and runtime witnessing live in protection.cjs.
const INSTALL_IMPLEMENTATIONS = Object.freeze({
  "linux-x64": "node-linux-x64",
  "darwin-x64": "node-darwin-native-x64",
  "darwin-arm64": "node-darwin-native-arm64",
});

// Naming the shipped implementation keeps this stronger than a bare OS/arch
// string check. Release-matrix tests bind the Darwin entries to artifacts that
// contain the native helper and its unchanged Mach-O architecture gate.
const PROTECT_IMPLEMENTATIONS = Object.freeze({
  "linux-x64": "linux-procfs-process-start-witness",
  "darwin-x64": "macos-sysctl3-process-and-boot-witness",
  "darwin-arm64": "macos-sysctl3-process-and-boot-witness",
});

function implementationFor(table, platform, arch) {
  return table[`${platform}-${arch}`] || null;
}

function protectPlatformSupported(platform, arch) {
  return implementationFor(PROTECT_IMPLEMENTATIONS, platform, arch) !== null;
}

function platformSupport(env = process.env) {
  const platform = env.SEAL_SPINE_PLATFORM || process.platform;
  const arch = env.SEAL_SPINE_ARCH || process.arch;
  const installImplementation = implementationFor(INSTALL_IMPLEMENTATIONS, platform, arch);
  const protectImplementation = implementationFor(PROTECT_IMPLEMENTATIONS, platform, arch);
  const installSupported = installImplementation !== null;
  const protectSupported = protectImplementation !== null;
  return {
    supported: installSupported,
    installSupported,
    protectSupported,
    installImplementation,
    protectImplementation,
    platform,
    arch,
  };
}

function unsupportedPlatformText() {
  return [
    "UNSUPPORTED PLATFORM",
    "",
    "Seal v0.2.1.",
    "Seal supports install, demo, receipt checking and Protect on Linux x86-64 and macOS x64/arm64.",
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
  process.stderr.write(`REFUSE unsupported_platform: this is ${platform}-${arch}\n`);
  process.exit(1);
}

module.exports = {
  INSTALL_IMPLEMENTATIONS,
  PROTECT_IMPLEMENTATIONS,
  platformSupport,
  protectPlatformSupported,
  requireProtectSupportedPlatform,
  requireSupportedPlatform,
  unsupportedPlatformText,
};
