// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { manifestFromObserved, sha256, validateManifestShape } from "../scripts/release-manifest-lib.mjs";
import integrity from "../spine/integrity.cjs";

const ROOT = path.join(import.meta.dirname, "..");
const VERSION = fs.readFileSync(path.join(ROOT, "VERSION"), "utf8").trim();
const HELPER_PROVENANCE = "release-produced, not independ" + "ently reproduced";
const { unpackPayload } = integrity;
const PAYLOAD_MARKER = Buffer.from("\n// --SEAL-PAYLOAD--\n", "utf8");

function machO(cpuType) {
  const bytes = Buffer.alloc(32);
  bytes.writeUInt32LE(0xfeedfacf, 0);
  bytes.writeUInt32LE(cpuType, 4);
  return bytes;
}

test("the release manifest binds all platforms and publication rewrites every release-note label and href", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "seal-release-matrix-"));
  try {
    const artifacts = [];
    for (const [platform, cpuType] of [
      ["linux-x64", null],
      ["darwin-arm64", 0x0100000c],
      ["darwin-x64", 0x01000007],
    ]) {
      const out = path.join(directory, platform);
      const args = [path.join(ROOT, "scripts", "build-dist.cjs"), "--platform", platform, "--out", out];
      if (cpuType !== null) {
        const helper = path.join(directory, `${platform}-helper`);
        fs.writeFileSync(helper, machO(cpuType), { mode: 0o755 });
        args.push("--macos-helper", helper);
      }
      const built = spawnSync(process.execPath, args, { cwd: ROOT, encoding: "utf8" });
      assert.equal(built.status, 0, built.stderr);
      const sourceName = fs.readFileSync(path.join(out, "SHA256SUMS"), "utf8").trim().split(/\s+/)[2];
      const name = `seal-v${VERSION}-${platform}`;
      const bytes = fs.readFileSync(path.join(out, sourceName));
      const payloadAt = bytes.indexOf(PAYLOAD_MARKER);
      assert.ok(payloadAt >= 0, `${platform} artifact has no payload marker`);
      const unpacked = unpackPayload(bytes.subarray(payloadAt + PAYLOAD_MARKER.length));
      const paths = new Set(unpacked.files.map((file) => file.path));
      for (const required of [
        "spine/platform.cjs",
        "spine/protection.cjs",
        "runtime/macos-process-start-witness.c",
        "scripts/macos-helper.cjs",
      ]) assert.ok(paths.has(required), `${platform} artifact lacks contract implementation member ${required}`);
      assert.equal(paths.has("runtime/macos-process-start-witness"), platform.startsWith("darwin-"));
      artifacts.push({ name, bytes });
    }
    const checkerName = "seal-receipt-v2.mjs";
    const checkerBytes = fs.readFileSync(path.join(ROOT, "checker", checkerName));
    const lines = [...artifacts, { name: checkerName, bytes: checkerBytes }]
      .map(({ name, bytes }) => `${sha256(bytes)}  ${bytes.length}  ${name}\n`)
      .join("");
    const manifest = manifestFromObserved({
      tag: `v${VERSION}`,
      commitSha: "a".repeat(40),
      artifacts,
      checkerName,
      checkerBytes,
      checksumsName: "SHA256SUMS",
      checksumsBytes: Buffer.from(lines),
    });
    validateManifestShape(manifest);
    assert.equal(manifest.schema, "seal.release/v2");
    assert.deepEqual(manifest.artifacts.map((artifact) => artifact.platform), ["darwin-arm64", "darwin-x64", "linux-x64"]);
    assert.equal(manifest.artifacts[0].nativeHelperProvenance, HELPER_PROVENANCE);
    assert.equal(manifest.artifacts[1].nativeHelperProvenance, HELPER_PROVENANCE);
    assert.equal("nativeHelperProvenance" in manifest.artifacts[2], false);
    assert.equal(new Set(manifest.artifacts.map((artifact) => artifact.sha256)).size, 3);

    for (const artifact of artifacts) fs.writeFileSync(path.join(directory, artifact.name), artifact.bytes);
    fs.writeFileSync(path.join(directory, checkerName), checkerBytes);
    fs.writeFileSync(path.join(directory, "SHA256SUMS"), lines);
    const manifestPath = path.join(directory, "release-manifest.json");
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    const docsRoot = path.join(directory, "docs-root");
    fs.mkdirSync(docsRoot, { recursive: true });
    fs.copyFileSync(path.join(ROOT, "README.md"), path.join(docsRoot, "README.md"));
    fs.cpSync(path.join(ROOT, "docs"), path.join(docsRoot, "docs"), { recursive: true });
    const mismatchPath = path.join(docsRoot, "docs", "archive", "AUTHORIZATION-MESH.md");
    const mismatch = fs.readFileSync(mismatchPath, "utf8").replace(
      "docs/assurance/RELEASE-NOTES-v0.2.0-rc.3.md",
      "docs/assurance/RELEASE-NOTES-v0.2.0.md",
    );
    assert.match(
      mismatch,
      /\[docs\/assurance\/RELEASE-NOTES-v0\.2\.0\.md\]\(\.\.\/assurance\/RELEASE-NOTES-v0\.2\.0-rc\.3\.md\)/,
      "fixture must reproduce the mismatched final-version label and rc.3 href",
    );
    fs.writeFileSync(mismatchPath, mismatch);
    const generated = spawnSync(process.execPath, [
      path.join(ROOT, "scripts", "generate-release-docs.mjs"),
      "--manifest", manifestPath,
      "--assets-dir", directory,
      "--tag-commit", "a".repeat(40),
    ], { cwd: ROOT, encoding: "utf8", env: { ...process.env, SEAL_RELEASE_DOCS_ROOT: docsRoot } });
    assert.equal(generated.status, 0, generated.stderr);
    const readme = fs.readFileSync(path.join(docsRoot, "README.md"), "utf8");
    assert.doesNotMatch(readme, /The current source is the unreleased/);
    const install = fs.readFileSync(path.join(docsRoot, "docs", "start", "install.md"), "utf8");
    assert.ok(install.includes(`The native macOS process-start witness helper is ${HELPER_PROVENANCE}.`));
    for (const artifact of manifest.artifacts) assert.match(install, new RegExp(artifact.name.replaceAll(".", "\\.")));
    const rewrittenMismatch = fs.readFileSync(mismatchPath, "utf8");
    assert.match(
      rewrittenMismatch,
      /\[docs\/assurance\/RELEASE-NOTES-v0\.2\.0\.md\]\(\.\.\/assurance\/RELEASE-NOTES-v0\.2\.0\.md\)/,
      "publication must retarget every release-note occurrence",
    );
    assert.doesNotMatch(
      rewrittenMismatch,
      /\[docs\/assurance\/RELEASE-NOTES-v0\.2\.0\.md\]\([^)]*RELEASE-NOTES-v(?!0\.2\.0\.md)[^)]*\)/,
      "a final-version label must not retain a prerelease href",
    );
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
