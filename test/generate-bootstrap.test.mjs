// SPDX-License-Identifier: Apache-2.0
// Generation-logic and observed-byte CLI tests for scripts/generate-bootstrap.mjs: the
// artifact map must come from a validated manifest (never hand-typed), and
// generation must be acyclic -- the produced bytes must never contain a
// hash of themselves. CLI fixtures use the product payload codec; end-to-end
// download/verify/install behaviour is covered by test/bootstrap-install.test.cjs.
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { manifestFromObserved } from "../scripts/release-manifest-lib.mjs";
import integrity from "../spine/integrity.cjs";
import { fileURLToPath } from "node:url";
import { buildBootstrapArtifact, sha256 } from "../scripts/generate-bootstrap.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TEMPLATE_SOURCE = fs.readFileSync(path.join(ROOT, "scripts", "bootstrap-install.cjs"), "utf8")
  .replace(/^#!\/usr\/bin\/env node\n/, "");

function validManifest(overrides = {}) {
  const base = {
    schema: "seal.release/v2",
    tag: "v9.9.9",
    commitSha: "f".repeat(40),
    minimumNodeMajor: 20,
    artifacts: [
      { platform: "darwin-arm64", name: "seal-v9.9.9-darwin-arm64", sha256: "1".repeat(64), bytes: 10, installedTreeSha256: "2".repeat(64), nativeHelperProvenance: "release-produced, not independently reproduced" },
      { platform: "darwin-x64", name: "seal-v9.9.9-darwin-x64", sha256: "3".repeat(64), bytes: 11, installedTreeSha256: "4".repeat(64), nativeHelperProvenance: "release-produced, not independently reproduced" },
      { platform: "linux-x64", name: "seal-v9.9.9-linux-x64", sha256: "5".repeat(64), bytes: 12, installedTreeSha256: "6".repeat(64) },
    ],
    checker: { name: "seal-receipt-v2.mjs", sha256: "7".repeat(64), bytes: 13 },
    checksums: { name: "SHA256SUMS", sha256: "8".repeat(64) },
  };
  return { ...base, ...overrides };
}

function writeObservedFixture(scratch) {
  const payloadRoot = path.join(scratch, "payload");
  fs.mkdirSync(payloadRoot);
  fs.writeFileSync(path.join(payloadRoot, "package.json"), JSON.stringify({ engines: { node: ">=20" } }));
  const artifacts = ["linux-x64", "darwin-arm64", "darwin-x64"].map((platform) => {
    if (platform.startsWith("darwin")) {
      fs.mkdirSync(path.join(payloadRoot, "runtime"), { recursive: true });
      fs.writeFileSync(path.join(payloadRoot, "runtime", "macos-process-start-witness"), "test helper");
    }
    const bytes = Buffer.concat([Buffer.from("#!/bin/sh\nexit 0\n// --SEAL-PAYLOAD--\n"), integrity.packPayload(payloadRoot, "9.9.9", platform).payload]);
    const name = `seal-v9.9.9-${platform}`;
    fs.writeFileSync(path.join(scratch, name), bytes);
    return { name, bytes };
  });
  const checkerName = "seal-receipt-v2.mjs";
  const checkerBytes = Buffer.from("// test checker\n");
  fs.writeFileSync(path.join(scratch, checkerName), checkerBytes);
  const checksumsBytes = Buffer.from([...artifacts, { name: checkerName, bytes: checkerBytes }]
    .map(({ name, bytes }) => `${sha256(bytes)}  ${bytes.length}  ${name}\n`).join(""));
  fs.writeFileSync(path.join(scratch, "SHA256SUMS"), checksumsBytes);
  return manifestFromObserved({ tag: "v9.9.9", commitSha: "f".repeat(40), artifacts, checkerName, checkerBytes, checksumsName: "SHA256SUMS", checksumsBytes });
}

test("the generated bootstrap embeds exactly the manifest's artifact facts, narrowed to what it needs", () => {
  const manifest = validManifest();
  const { name, bytes, releaseFacts } = buildBootstrapArtifact({ manifest, repository: "velvetmonkey/seal", templateSource: TEMPLATE_SOURCE });
  assert.equal(name, "seal-bootstrap-v9.9.9");
  assert.equal(releaseFacts.tag, manifest.tag);
  assert.equal(releaseFacts.repository, "velvetmonkey/seal");
  assert.deepEqual(releaseFacts.artifacts, manifest.artifacts.map((a) => ({ platform: a.platform, name: a.name, sha256: a.sha256, bytes: a.bytes })));
  const source = bytes.toString("utf8");
  for (const artifact of manifest.artifacts) {
    assert.ok(source.includes(artifact.sha256), `embedded source must name ${artifact.platform}'s digest`);
    assert.ok(source.includes(artifact.name), `embedded source must name ${artifact.platform}'s artifact name`);
  }
  // Narrowed on purpose: fields the bootstrap never reads must not leak in.
  assert.ok(!source.includes(manifest.artifacts[0].installedTreeSha256));
  assert.ok(!source.includes(manifest.checksums.sha256));
});

test("ACYCLIC: the generated bootstrap's bytes never contain a hash of themselves", () => {
  const manifest = validManifest();
  const { bytes } = buildBootstrapArtifact({ manifest, repository: "velvetmonkey/seal", templateSource: TEMPLATE_SOURCE });
  const selfDigest = sha256(bytes);
  assert.equal(bytes.toString("utf8").includes(selfDigest), false,
    "a file cannot correctly embed a hash of its own bytes; the digest must be published beside it (the sidecar), never inside it");
});

test("ACYCLIC: two runs against the same manifest are byte-identical, so the sidecar digest is reproducible, not order-dependent", () => {
  const manifest = validManifest();
  const first = buildBootstrapArtifact({ manifest, repository: "velvetmonkey/seal", templateSource: TEMPLATE_SOURCE });
  const second = buildBootstrapArtifact({ manifest, repository: "velvetmonkey/seal", templateSource: TEMPLATE_SOURCE });
  assert.deepEqual(first.bytes, second.bytes);
  assert.equal(sha256(first.bytes), sha256(second.bytes));
});

test("generation refuses a manifest that fails the same validator generate-release-docs.mjs already trusts", () => {
  const broken = validManifest();
  broken.artifacts = broken.artifacts.slice(0, 2); // drop linux-x64: shape now invalid
  assert.throws(
    () => buildBootstrapArtifact({ manifest: broken, repository: "velvetmonkey/seal", templateSource: TEMPLATE_SOURCE }),
    /release_manifest_invalid/,
  );
});

test("generation refuses a manifest whose schema is not seal.release/v2", () => {
  const broken = validManifest({ schema: "seal.release/v1" });
  assert.throws(
    () => buildBootstrapArtifact({ manifest: broken, repository: "velvetmonkey/seal", templateSource: TEMPLATE_SOURCE }),
    /release_manifest_invalid/,
  );
});

test("generation refuses an invalid repository shape rather than embedding a hand-typed host", () => {
  const manifest = validManifest();
  for (const repository of ["", "not-a-repo", "owner/repo/extra", "owner/"]) {
    assert.throws(
      () => buildBootstrapArtifact({ manifest, repository, templateSource: TEMPLATE_SOURCE }),
      /repository_invalid/,
      `expected ${JSON.stringify(repository)} to be refused`,
    );
  }
});

test("generation refuses a template whose marker is missing or duplicated", () => {
  const manifest = validManifest();
  assert.throws(
    () => buildBootstrapArtifact({ manifest, repository: "velvetmonkey/seal", templateSource: TEMPLATE_SOURCE.replace('"__SEAL_BOOTSTRAP_RELEASE_FACTS_JSON__"', "null") }),
    /template_marker/,
  );
  const duplicated = `${TEMPLATE_SOURCE}\n"__SEAL_BOOTSTRAP_RELEASE_FACTS_JSON__"`;
  assert.throws(
    () => buildBootstrapArtifact({ manifest, repository: "velvetmonkey/seal", templateSource: duplicated }),
    /template_marker/,
  );
});

test("the CLI writes the bootstrap and a separate sidecar digest file, and the sidecar matches the frozen bytes", async () => {
  const { spawnSync } = await import("node:child_process");
  const os = await import("node:os");
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "seal-bootstrap-cli-"));
  try {
    const manifestPath = path.join(scratch, "release-manifest.json");
    fs.writeFileSync(manifestPath, JSON.stringify(writeObservedFixture(scratch), null, 2));
    const outDir = path.join(scratch, "out");
    const result = spawnSync(process.execPath, [path.join(ROOT, "scripts", "generate-bootstrap.mjs"), "--manifest", manifestPath, "--out", outDir], { encoding: "utf8" });
    assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
    const bootstrapPath = path.join(outDir, "seal-bootstrap-v9.9.9");
    const sidecarPath = `${bootstrapPath}.sha256`;
    const bytes = fs.readFileSync(bootstrapPath);
    const [digest, length, name] = fs.readFileSync(sidecarPath, "utf8").trim().split(/\s+/);
    assert.equal(digest, sha256(bytes));
    assert.equal(Number(length), bytes.length);
    assert.equal(name, "seal-bootstrap-v9.9.9");
    assert.equal(bytes.toString("utf8").includes(digest), false, "the sidecar digest must not appear inside the bootstrap it describes");
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

test("PHYSICAL TAMPER: CLI refuses a planted script even when manifest and checksums match its bytes", async () => {
  const { spawnSync } = await import("node:child_process");
  const os = await import("node:os");
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "seal-bootstrap-tamper-"));
  try {
    const manifest = writeObservedFixture(scratch);
    const artifact = manifest.artifacts.find((entry) => entry.platform === "linux-x64");
    const planted = Buffer.from("#!/bin/sh\necho PWNED_BOOTSTRAP_EXEC\n# test\n");
    assert.equal(planted.length, 43);
    fs.writeFileSync(path.join(scratch, artifact.name), planted);
    artifact.sha256 = sha256(planted);
    artifact.bytes = planted.length;
    const sums = Buffer.from([...manifest.artifacts, manifest.checker]
      .map((entry) => `${entry.sha256}  ${entry.bytes}  ${entry.name}\n`).join(""));
    fs.writeFileSync(path.join(scratch, "SHA256SUMS"), sums);
    manifest.checksums.sha256 = sha256(sums);
    const manifestPath = path.join(scratch, "release-manifest.json");
    fs.writeFileSync(manifestPath, JSON.stringify(manifest));
    const outDir = path.join(scratch, "out");
    const result = spawnSync(process.execPath, [path.join(ROOT, "scripts", "generate-bootstrap.mjs"), "--manifest", manifestPath, "--out", outDir], { encoding: "utf8" });
    assert.notEqual(result.status, 0, "planted script must not generate a bootstrap");
    assert.match(result.stderr, /release_manifest_artifact_invalid/);
    assert.equal(result.stdout, "");
    assert.equal(fs.existsSync(outDir), false);
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

test("CLI refuses artifact hash and byte-count claims that disagree with observed files", async () => {
  const { spawnSync } = await import("node:child_process");
  const os = await import("node:os");
  for (const field of ["sha256", "bytes"]) {
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "seal-bootstrap-mismatch-"));
    try {
      const manifest = writeObservedFixture(scratch);
      const artifact = manifest.artifacts.find((entry) => entry.platform === "linux-x64");
      artifact[field] = field === "sha256" ? "0".repeat(64) : artifact.bytes + 1;
      const manifestPath = path.join(scratch, "release-manifest.json");
      fs.writeFileSync(manifestPath, JSON.stringify(manifest));
      const outDir = path.join(scratch, "out");
      const result = spawnSync(process.execPath, [path.join(ROOT, "scripts", "generate-bootstrap.mjs"), "--manifest", manifestPath, "--out", outDir], { encoding: "utf8" });
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /release_manifest_asset_mismatch/);
      assert.match(result.stderr, new RegExp(field));
      assert.equal(fs.existsSync(outDir), false);
    } finally {
      fs.rmSync(scratch, { recursive: true, force: true });
    }
  }
});
