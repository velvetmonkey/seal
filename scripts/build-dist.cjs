#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Build one platform-labelled install artifact. The macOS helper supplied by
// the matching release runner is release-produced, not independently reproduced.
const fs = require("node:fs");
const path = require("node:path");
require("./sync-version.cjs");
const { packPayload, sha256Hex, SUPPORTED_PLATFORMS } = require("../spine/integrity.cjs");
const { requireMatchingVersion } = require("../spine/version.cjs");
const { productIdentity, artifactName } = require("./product-identity.cjs");
const { requireHelperPlatform } = require("./macos-helper.cjs");

const ROOT = path.join(__dirname, "..");
const MARKER = "\n// --SEAL-PAYLOAD--\n";

const PAYLOAD_PATHS = [
  "bin/seal",
  "VERSION",
  "package.json",
  "LICENSE",
  "NOTICE",
  "runtime-manifest.json",
  "checker/seal-receipt-v2.mjs",
  "spine/version.cjs",
  "spine/platform.cjs",
  "spine/integrity.cjs",
  "spine/demo.cjs",
  "spine/demo-server.cjs",
  "spine/protection.cjs",
  "spine/proxy.cjs",
  "spine/proxy-cli.cjs",
  "spine/presentation.cjs",
  "spine/receipts.cjs",
  "spine/receipt-v2.cjs",
  "spine/store.cjs",
  "spine/tool-selection.cjs",
  "contract/canonical.cjs",
  "contract/contract.cjs",
  "contract/kernel-authorization.cjs",
  "contract/kernel-authorization-worker.cjs",
  "contract/renderer.cjs",
  "runtime/macos-process-start-witness.c",
  "runtime/kernel/kernel.js",
  "runtime/kernel/seal-config.js",
  "runtime/kernel/receipt-format.js",
  "runtime/kernel/decision-runner.cjs",
  "runtime/kernel/runner.cjs",
  "runtime/kernel/wasm/seal.js",
  "runtime/kernel/wasm/seal.wasm",
  "scripts/macos-helper.cjs",
  "scripts/seal-launch.cjs",
  "scripts/seal-reproduce.cjs",
];

function copyInto(staging, rel) {
  const src = path.join(ROOT, rel);
  const dest = path.join(staging, rel);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

function main() {
  const version = requireMatchingVersion();
  const platformAt = process.argv.indexOf("--platform");
  const platform = platformAt >= 0 ? process.argv[platformAt + 1] : "linux-x64";
  if (!SUPPORTED_PLATFORMS.has(platform)) {
    process.stderr.write(`REFUSE unsupported_platform: cannot build artifact for ${platform || "<absent>"}\n`);
    process.exit(1);
  }
  // The FILE is named by the product identity, so an untagged build cannot
  // pass for the release. Darwin payloads and tree digests are platform-bound
  // because they include the matching native helper.
  const identity = productIdentity({ root: ROOT, version });
  const outDir = process.argv.includes("--out")
    ? path.resolve(process.argv[process.argv.indexOf("--out") + 1])
    : path.join(ROOT, "dist");
  fs.mkdirSync(outDir, { recursive: true });

  const staging = fs.mkdtempSync(path.join(outDir, ".stage-"));
  try {
    for (const rel of PAYLOAD_PATHS) copyInto(staging, rel);
    if (platform.startsWith("darwin-")) {
      const helperAt = process.argv.indexOf("--macos-helper");
      const helper = helperAt >= 0 ? process.argv[helperAt + 1] : undefined;
      if (!helper) {
        process.stderr.write(`REFUSE macos_helper_absent: ${platform} requires --macos-helper built on its matching release runner\n`);
        process.exit(1);
      }
      requireHelperPlatform(helper, platform);
      const destination = path.join(staging, "runtime", "macos-process-start-witness");
      fs.copyFileSync(helper, destination);
      fs.chmodSync(destination, 0o555);
    }
    const { payload, manifest } = packPayload(staging, version, platform);
    const installerSrc = fs.readFileSync(path.join(ROOT, "scripts", "install.cjs"), "utf8")
      .replace(/^#!\/usr\/bin\/env node\n/, "");
    // A shell stub so Node never parses the binary payload. `node FILE`
    // would treat the payload as JavaScript; the stranger runs THIS file.
    const header = [
      "#!/bin/sh",
      "if ! command -v node >/dev/null 2>&1; then",
      `  printf '%s\\n' "REFUSE node_missing: Seal requires Node >= 20 on ${platform}"`,
      "  exit 1",
      "fi",
      "exec node - \"$0\" \"$@\" <<'SEAL_INSTALL_JS'",
      installerSrc,
      "SEAL_INSTALL_JS",
      MARKER.trimEnd(),
      "",
    ].join("\n");
    const artifact = Buffer.concat([Buffer.from(header, "utf8"), payload]);
    const name = artifactName(identity.identity, platform);
    const dest = path.join(outDir, name);
    if (fs.existsSync(dest)) fs.rmSync(dest, { force: true });
    fs.writeFileSync(dest, artifact, { mode: 0o555 });
    const digest = sha256Hex(artifact);
    const sums = `${digest}  ${artifact.length}  ${name}\n`;
    fs.writeFileSync(path.join(outDir, "SHA256SUMS"), sums);
    const meta = {
      schema: "seal.dist/v1",
      version,
      identity: identity.identity,
      identityKind: identity.kind,
      commit: identity.commit,
      platform,
      artifact: name,
      sha256: digest,
      bytes: artifact.length,
      treeSha256: manifest.treeSha256,
      ...(platform.startsWith("darwin-") ? {
        nativeHelper: {
          path: "runtime/macos-process-start-witness",
          provenance: "release-produced, not independently reproduced",
        },
      } : {}),
    };
    fs.writeFileSync(path.join(outDir, `${name}.meta.json`), `${JSON.stringify(meta, null, 2)}\n`);
    process.stdout.write(`${dest}\n`);
    process.stdout.write(`sha256 ${digest}\n`);
    process.stdout.write(`bytes ${artifact.length}\n`);
    process.stdout.write(`tree ${manifest.treeSha256}\n`);
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
}

module.exports = { PAYLOAD_PATHS };

if (require.main === module) main();
