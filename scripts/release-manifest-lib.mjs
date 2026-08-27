// SPDX-License-Identifier: Apache-2.0
import crypto from "node:crypto";
import { createRequire } from "node:module";
import { isDeepStrictEqual } from "node:util";

const require = createRequire(import.meta.url);
const { treeDigest, unpackPayload } = require("../spine/integrity.cjs");

const PAYLOAD_MARKER = Buffer.from("\n// --SEAL-PAYLOAD--\n", "utf8");
const HEX = /^[0-9a-f]{64}$/;
const TAG = /^v[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/;
const COMMIT = /^[0-9a-f]{40}$/;
export const LEGACY_RELEASE_TAGS = Object.freeze(["v0.2.0-rc.1", "v0.2.0-rc.2", "v0.2.0-rc.3"]);

export function isLegacyReleaseTag(tag) {
  return LEGACY_RELEASE_TAGS.includes(tag);
}

export function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function refuse(code, reason) {
  const error = new Error(`REFUSE release_manifest_${code}: ${reason}`);
  error.code = code;
  throw error;
}

function exactKeys(value, expected, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    refuse("invalid", `${label} must be an object`);
  }
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) {
    refuse("invalid", `${label} fields must be exactly ${wanted.join(", ")}`);
  }
}

function positiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) refuse("invalid", `${label} must be a positive integer`);
}

function digest(value, label) {
  if (typeof value !== "string" || !HEX.test(value)) refuse("invalid", `${label} must be a lowercase SHA-256`);
}

function parseChecksumsCount(bytes, expected) {
  const text = bytes.toString("utf8");
  const entries = new Map();
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    if (!line) continue;
    const match = line.match(/^([0-9a-f]{64})  ([1-9][0-9]*)  ([^/\s]+)$/);
    if (!match) refuse("checksums_invalid", `SHA256SUMS line ${index + 1} is malformed`);
    if (entries.has(match[3])) refuse("checksums_invalid", `SHA256SUMS repeats ${match[3]}`);
    const count = Number(match[2]);
    if (!Number.isSafeInteger(count) || count <= 0) refuse("checksums_invalid", `SHA256SUMS line ${index + 1} has an invalid byte count`);
    entries.set(match[3], { sha256: match[1], bytes: count });
  }
  if (entries.size !== expected) refuse("checksums_invalid", `SHA256SUMS must name exactly ${expected} release assets, found ${entries.size}`);
  return entries;
}

export function parseChecksums(bytes) {
  return parseChecksumsCount(bytes, 4);
}

function payloadFacts(artifactBytes) {
  const at = artifactBytes.indexOf(PAYLOAD_MARKER);
  if (at < 0) refuse("artifact_invalid", "artifact has no Seal payload marker");
  let unpacked;
  try {
    unpacked = unpackPayload(artifactBytes.subarray(at + PAYLOAD_MARKER.length));
  } catch (error) {
    refuse("artifact_invalid", error.message);
  }
  const packageFile = unpacked.files.find((file) => file.path === "package.json");
  if (!packageFile) refuse("artifact_invalid", "payload has no package.json");
  let packageJson;
  try {
    packageJson = JSON.parse(packageFile.data.toString("utf8"));
  } catch (error) {
    refuse("artifact_invalid", `payload package.json is invalid: ${error.message}`);
  }
  const engine = packageJson?.engines?.node;
  const engineMatch = typeof engine === "string" ? engine.match(/^>=(\d+)$/) : null;
  if (!engineMatch) refuse("artifact_invalid", "payload package.json must name a minimum Node major as >=N");
  const recomputedTree = treeDigest(unpacked.manifest.files);
  if (recomputedTree !== unpacked.manifest.treeSha256) refuse("artifact_invalid", "payload tree digest disagrees");
  return {
    version: unpacked.manifest.version,
    platform: unpacked.manifest.platform,
    minimumNodeMajor: Number(engineMatch[1]),
    installedTreeSha256: recomputedTree,
    hasNativeHelper: unpacked.files.some((file) => file.path === "runtime/macos-process-start-witness"),
  };
}

export function legacyManifestFromObserved({
  tag, commitSha, artifactName, artifactBytes, checkerName, checkerBytes, checksumsName, checksumsBytes,
}) {
  if (!TAG.test(tag)) refuse("invalid", `tag is invalid: ${tag}`);
  if (!COMMIT.test(commitSha)) refuse("invalid", `commitSha is invalid: ${commitSha}`);
  if (checksumsName !== "SHA256SUMS") refuse("invalid", `checksum asset must be SHA256SUMS, got ${checksumsName}`);
  const payload = payloadFacts(artifactBytes);
  if (`v${payload.version}` !== tag) refuse("artifact_mismatch", `payload version ${payload.version} disagrees with tag ${tag}`);
  const expectedName = `seal-${tag}-${payload.platform}`;
  if (artifactName !== expectedName) refuse("artifact_mismatch", `artifact name ${artifactName} disagrees with payload identity ${expectedName}`);
  if (!["seal-receipt-check.mjs", "seal-receipt-v2.mjs"].includes(checkerName)) refuse("checker_mismatch", `unexpected checker name ${checkerName}`);
  const sums = parseChecksumsCount(checksumsBytes, 2);
  for (const [name, bytes] of [[artifactName, artifactBytes], [checkerName, checkerBytes]]) {
    const entry = sums.get(name);
    if (!entry || entry.sha256 !== sha256(bytes) || entry.bytes !== bytes.length) {
      refuse("checksums_mismatch", `SHA256SUMS disagrees with published bytes for ${name}`);
    }
  }
  return {
    schema: "seal.release/v1",
    tag,
    commitSha,
    platform: payload.platform,
    minimumNodeMajor: payload.minimumNodeMajor,
    artifact: {
      name: artifactName,
      sha256: sha256(artifactBytes),
      bytes: artifactBytes.length,
      installedTreeSha256: payload.installedTreeSha256,
    },
    checker: { name: checkerName, sha256: sha256(checkerBytes), bytes: checkerBytes.length },
    checksums: { name: checksumsName, sha256: sha256(checksumsBytes) },
  };
}

export function manifestFromObserved({
  tag,
  commitSha,
  artifacts,
  checkerName,
  checkerBytes,
  checksumsName,
  checksumsBytes,
}) {
  if (!TAG.test(tag)) refuse("invalid", `tag is invalid: ${tag}`);
  if (!COMMIT.test(commitSha)) refuse("invalid", `commitSha is invalid: ${commitSha}`);
  if (checksumsName !== "SHA256SUMS") refuse("invalid", `checksum asset must be SHA256SUMS, got ${checksumsName}`);
  if (!Array.isArray(artifacts) || artifacts.length !== 3) {
    refuse("artifact_mismatch", `release must supply exactly three platform artifacts, found ${artifacts?.length ?? 0}`);
  }
  if (!["seal-receipt-check.mjs", "seal-receipt-v2.mjs"].includes(checkerName)) refuse("checker_mismatch", `unexpected checker name ${checkerName}`);
  const sums = parseChecksums(checksumsBytes);
  const artifactFacts = artifacts.map(({ name, bytes }) => {
    const payload = payloadFacts(bytes);
    if (`v${payload.version}` !== tag) refuse("artifact_mismatch", `payload version ${payload.version} disagrees with tag ${tag}`);
    const expectedName = `seal-${tag}-${payload.platform}`;
    if (name !== expectedName) refuse("artifact_mismatch", `artifact name ${name} disagrees with payload identity ${expectedName}`);
    const darwin = payload.platform === "darwin-arm64" || payload.platform === "darwin-x64";
    if (darwin && !payload.hasNativeHelper) refuse("artifact_mismatch", `${name} has no native process-start witness helper`);
    if (!darwin && payload.hasNativeHelper) refuse("artifact_mismatch", `${name} unexpectedly carries a macOS process-start witness helper`);
    return {
      platform: payload.platform,
      name,
      sha256: sha256(bytes),
      bytes: bytes.length,
      installedTreeSha256: payload.installedTreeSha256,
      ...(darwin ? { nativeHelperProvenance: "release-produced, not independently reproduced" } : {}),
      minimumNodeMajor: payload.minimumNodeMajor,
    };
  }).sort((left, right) => left.platform.localeCompare(right.platform));
  const platforms = artifactFacts.map((artifact) => artifact.platform);
  if (JSON.stringify(platforms) !== JSON.stringify(["darwin-arm64", "darwin-x64", "linux-x64"])) {
    refuse("artifact_mismatch", `artifact platforms must be darwin-arm64, darwin-x64, linux-x64; got ${platforms.join(", ")}`);
  }
  const minimumNodeMajors = new Set(artifactFacts.map((artifact) => artifact.minimumNodeMajor));
  if (minimumNodeMajors.size !== 1) refuse("artifact_mismatch", "artifacts disagree on minimum Node major");
  for (const artifact of artifactFacts) delete artifact.minimumNodeMajor;
  const observed = [...artifacts.map(({ name, bytes }) => [name, bytes]), [checkerName, checkerBytes]];
  for (const [name, bytes] of observed) {
    const entry = sums.get(name);
    if (!entry) refuse("checksums_mismatch", `SHA256SUMS does not name ${name}`);
    const actualDigest = sha256(bytes);
    if (entry.sha256 !== actualDigest || entry.bytes !== bytes.length) {
      refuse("checksums_mismatch", `SHA256SUMS disagrees with published bytes for ${name}`);
    }
  }
  return {
    schema: "seal.release/v2",
    tag,
    commitSha,
    minimumNodeMajor: [...minimumNodeMajors][0],
    artifacts: artifactFacts,
    checker: {
      name: checkerName,
      sha256: sha256(checkerBytes),
      bytes: checkerBytes.length,
    },
    checksums: {
      name: checksumsName,
      sha256: sha256(checksumsBytes),
    },
  };
}

export function validateManifestShape(manifest) {
  exactKeys(manifest, ["schema", "tag", "commitSha", "minimumNodeMajor", "artifacts", "checker", "checksums"], "manifest");
  exactKeys(manifest.checker, ["name", "sha256", "bytes"], "manifest.checker");
  exactKeys(manifest.checksums, ["name", "sha256"], "manifest.checksums");
  if (manifest.schema !== "seal.release/v2") refuse("invalid", `unsupported schema ${manifest.schema}`);
  if (!TAG.test(manifest.tag)) refuse("invalid", `tag is invalid: ${manifest.tag}`);
  if (!COMMIT.test(manifest.commitSha)) refuse("invalid", `commitSha is invalid: ${manifest.commitSha}`);
  positiveInteger(manifest.minimumNodeMajor, "minimumNodeMajor");
  if (!Array.isArray(manifest.artifacts) || manifest.artifacts.length !== 3) refuse("invalid", "artifacts must contain exactly three entries");
  for (const [index, artifact] of manifest.artifacts.entries()) {
    const darwin = artifact?.platform === "darwin-arm64" || artifact?.platform === "darwin-x64";
    exactKeys(artifact, darwin
      ? ["platform", "name", "sha256", "bytes", "installedTreeSha256", "nativeHelperProvenance"]
      : ["platform", "name", "sha256", "bytes", "installedTreeSha256"], `artifacts[${index}]`);
    if (!/^[a-z0-9]+-[a-z0-9]+$/.test(artifact.platform)) refuse("invalid", `artifact platform is invalid: ${artifact.platform}`);
    if (typeof artifact.name !== "string" || !artifact.name) refuse("invalid", `artifacts[${index}].name is absent`);
    digest(artifact.sha256, `artifacts[${index}].sha256`);
    positiveInteger(artifact.bytes, `artifacts[${index}].bytes`);
    digest(artifact.installedTreeSha256, `artifacts[${index}].installedTreeSha256`);
    if (darwin && artifact.nativeHelperProvenance !== "release-produced, not independently reproduced") {
      refuse("invalid", `artifacts[${index}] has incorrect native-helper provenance`);
    }
  }
  const platforms = manifest.artifacts.map((artifact) => artifact.platform);
  if (JSON.stringify(platforms) !== JSON.stringify(["darwin-arm64", "darwin-x64", "linux-x64"])) {
    refuse("invalid", `artifact platforms are invalid: ${platforms.join(", ")}`);
  }
  if (!["seal-receipt-check.mjs", "seal-receipt-v2.mjs"].includes(manifest.checker.name)) refuse("invalid", `checker.name is invalid: ${manifest.checker.name}`);
  digest(manifest.checker.sha256, "checker.sha256");
  positiveInteger(manifest.checker.bytes, "checker.bytes");
  if (manifest.checksums.name !== "SHA256SUMS") refuse("invalid", `checksums.name is invalid: ${manifest.checksums.name}`);
  digest(manifest.checksums.sha256, "checksums.sha256");
  return manifest;
}

export function validateManifestAgainstObserved(manifest, observed) {
  validateManifestShape(manifest);
  const actual = manifestFromObserved(observed);
  if (!isDeepStrictEqual(manifest, actual)) {
    const fields = [];
    const visit = (left, right, prefix = "manifest") => {
      if (left && right && typeof left === "object" && typeof right === "object") {
        for (const key of Object.keys(right)) visit(left[key], right[key], `${prefix}.${key}`);
      } else if (left !== right) fields.push(prefix);
    };
    visit(manifest, actual);
    refuse("asset_mismatch", `${fields.join(", ")} disagree with published release assets`);
  }
  return manifest;
}
