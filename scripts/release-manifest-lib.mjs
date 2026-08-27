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

export function parseChecksums(bytes) {
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
  if (entries.size !== 2) refuse("checksums_invalid", `SHA256SUMS must name exactly two payload assets, found ${entries.size}`);
  return entries;
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
  };
}

export function manifestFromObserved({
  tag,
  commitSha,
  artifactName,
  artifactBytes,
  checkerName,
  checkerBytes,
  checksumsName,
  checksumsBytes,
}) {
  if (!TAG.test(tag)) refuse("invalid", `tag is invalid: ${tag}`);
  if (!COMMIT.test(commitSha)) refuse("invalid", `commitSha is invalid: ${commitSha}`);
  if (checksumsName !== "SHA256SUMS") refuse("invalid", `checksum asset must be SHA256SUMS, got ${checksumsName}`);
  const payload = payloadFacts(artifactBytes);
  if (`v${payload.version}` !== tag) refuse("artifact_mismatch", `payload version ${payload.version} disagrees with tag ${tag}`);
  const expectedArtifactName = `seal-${tag}-${payload.platform}`;
  if (artifactName !== expectedArtifactName) {
    refuse("artifact_mismatch", `artifact name ${artifactName} disagrees with payload identity ${expectedArtifactName}`);
  }
  if (checkerName !== "seal-receipt-check.mjs") refuse("checker_mismatch", `unexpected checker name ${checkerName}`);
  const sums = parseChecksums(checksumsBytes);
  const observed = [
    [artifactName, artifactBytes],
    [checkerName, checkerBytes],
  ];
  for (const [name, bytes] of observed) {
    const entry = sums.get(name);
    if (!entry) refuse("checksums_mismatch", `SHA256SUMS does not name ${name}`);
    const actualDigest = sha256(bytes);
    if (entry.sha256 !== actualDigest || entry.bytes !== bytes.length) {
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
  exactKeys(manifest, ["schema", "tag", "commitSha", "platform", "minimumNodeMajor", "artifact", "checker", "checksums"], "manifest");
  exactKeys(manifest.artifact, ["name", "sha256", "bytes", "installedTreeSha256"], "manifest.artifact");
  exactKeys(manifest.checker, ["name", "sha256", "bytes"], "manifest.checker");
  exactKeys(manifest.checksums, ["name", "sha256"], "manifest.checksums");
  if (manifest.schema !== "seal.release/v1") refuse("invalid", `unsupported schema ${manifest.schema}`);
  if (!TAG.test(manifest.tag)) refuse("invalid", `tag is invalid: ${manifest.tag}`);
  if (!COMMIT.test(manifest.commitSha)) refuse("invalid", `commitSha is invalid: ${manifest.commitSha}`);
  if (!/^[a-z0-9]+-[a-z0-9]+$/.test(manifest.platform)) refuse("invalid", `platform is invalid: ${manifest.platform}`);
  positiveInteger(manifest.minimumNodeMajor, "minimumNodeMajor");
  if (typeof manifest.artifact.name !== "string" || !manifest.artifact.name) refuse("invalid", "artifact.name is absent");
  digest(manifest.artifact.sha256, "artifact.sha256");
  positiveInteger(manifest.artifact.bytes, "artifact.bytes");
  digest(manifest.artifact.installedTreeSha256, "artifact.installedTreeSha256");
  if (manifest.checker.name !== "seal-receipt-check.mjs") refuse("invalid", `checker.name is invalid: ${manifest.checker.name}`);
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
