// SPDX-License-Identifier: Apache-2.0
// Supported release lanes are explicit. Install/demo portability and Protect
// process-identity support are separate answers. The env overrides exist only
// so both boundaries and their refusals are testable.
// Seal supports only the explicit install/demo platform pairs below; Protect
// support is separately narrower.
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const MACOS_HELPER = path.join(__dirname, "../runtime/macos-process-start-witness");
// sysctl is part of the macOS system volume at this path on both Intel and
// Apple-silicon hosts. Never let the caller's PATH choose a boot-time bound.
const MACOS_SYSCTL = "/usr/sbin/sysctl";
const MACOS_WITNESS_TIMEOUT_MS = 1000;
const MACOS_MIN_BOOT_SECONDS = 946684800;

function macosProtectPrerequisites() {
  try {
    const helper = fs.statSync(MACOS_HELPER);
    if (!helper.isFile()) return { supported: false, reason: "macos_process_start_witness_not_file" };
    fs.accessSync(MACOS_HELPER, fs.constants.X_OK);
    const nowSeconds = Date.now() / 1000;
    const boot = spawnSync(MACOS_SYSCTL, ["-n", "kern.boottime"], {
      encoding: "utf8",
      timeout: MACOS_WITNESS_TIMEOUT_MS,
    });
    const bootMatch = /\{ sec = ([1-9]\d*)(?=[^\d.e])(?:,| ,) usec = \d+ \}/.exec(boot.stdout || "");
    if (boot.error?.code === "ETIMEDOUT") return { supported: false, reason: "macos_sysctl_timeout" };
    if (boot.error || boot.status !== 0) return { supported: false, reason: "macos_sysctl_unavailable" };
    if (!bootMatch || (boot.stdout.match(/\bsec = /g) || []).length !== 1) {
      return { supported: false, reason: "macos_boot_time_invalid" };
    }
    const bootSeconds = Number(bootMatch[1]);
    if (!Number.isSafeInteger(bootSeconds) || bootSeconds < MACOS_MIN_BOOT_SECONDS || bootSeconds > nowSeconds) {
      return { supported: false, reason: "macos_boot_time_invalid" };
    }
    const witness = spawnSync(MACOS_HELPER, [String(process.pid)], {
      encoding: "utf8",
      timeout: MACOS_WITNESS_TIMEOUT_MS,
    });
    const witnessMatch = /^([1-9]\d*)\.\d{6}\n?$/.exec(witness.stdout || "");
    if (witness.error?.code === "ETIMEDOUT") {
      return { supported: false, reason: "macos_process_start_witness_timeout" };
    }
    if (witness.error || witness.status !== 0) {
      return { supported: false, reason: "macos_process_start_witness_unavailable" };
    }
    if (!witnessMatch) return { supported: false, reason: "macos_process_start_witness_invalid" };
    const startSeconds = Number(witnessMatch[1]);
    if (!Number.isSafeInteger(startSeconds) || startSeconds < bootSeconds || startSeconds > nowSeconds) {
      return { supported: false, reason: "macos_process_start_witness_invalid" };
    }
    return { supported: true };
  } catch (error) {
    return {
      supported: false,
      reason: error?.code === "EACCES"
        ? "macos_process_start_witness_not_executable"
        : "macos_process_start_witness_unavailable",
    };
  }
}

function platformSupport() {
  const platform = process.env.SEAL_SPINE_PLATFORM || process.platform;
  const arch = process.env.SEAL_SPINE_ARCH || process.arch;
  const installSupported = platform === "linux" && arch === "x64"
    || platform === "darwin" && (arch === "x64" || arch === "arm64");
  const macosPrerequisites = platform === "darwin" && (arch === "x64" || arch === "arm64")
    ? macosProtectPrerequisites()
    : null;
  const protectSupported = platform === "linux" && arch === "x64"
    || macosPrerequisites?.supported === true;
  return {
    supported: installSupported,
    installSupported,
    protectSupported,
    ...(macosPrerequisites && !macosPrerequisites.supported ? { protectReason: macosPrerequisites.reason } : {}),
    platform,
    arch,
  };
}

function unsupportedPlatformText() {
  return [
    "UNSUPPORTED PLATFORM",
    "",
    "Seal v0.2.0-rc.3.",
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
  platformSupport,
  requireProtectSupportedPlatform,
  requireSupportedPlatform,
  unsupportedPlatformText,
};
