#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
//
// Generate the Seal bootstrap installer for one release.
//
// ACYCLIC GENERATION ORDER (this is the load-bearing property of this file):
//
//   1. The three platform artifacts, the receipt checker, and SHA256SUMS are
//      built from source (scripts/build-dist.cjs / the release workflow),
//      exactly as today, with no involvement from this script.
//   2. release-manifest.json is produced FROM THOSE OBSERVED, ALREADY-BUILT
//      BYTES (scripts/create-release-manifest.mjs). It is the validated
//      source of truth for every artifact's name, sha256, and byte count --
//      the same source scripts/generate-release-docs.mjs already trusts to
//      publish install instructions.
//   3. THIS script reads that release-manifest.json and re-validates its
//      shape (scripts/release-manifest-lib.mjs#validateManifestShape, the
//      same validator the docs generator uses) before embedding a narrowed
//      copy of it -- repository, tag, commitSha, minimumNodeMajor, and each
//      artifact's {platform, name, sha256, bytes} -- into
//      scripts/bootstrap-install.cjs, producing the bootstrap's bytes. Those
//      bytes are now FROZEN.
//   4. A SEPARATE step, --sidecar-out below, hashes the frozen bootstrap
//      bytes from step 3 and writes that digest to its OWN file next to the
//      bootstrap. That digest is never written back into the bootstrap and
//      never folded into release-manifest.json.
//
// Step 4 has to be separate from step 3, and its output has to live in a
// file of its own, because a file cannot contain a correct hash of itself:
// embedding the digest would change the bytes, which would change the
// digest, which would need to be embedded again. The bootstrap only ever
// embeds OTHER artifacts' hashes (the product binaries built in step 1);
// its own hash is always published BESIDE it, computed after its bytes are
// final, never inside them.
//
// Usage:
//   node scripts/generate-bootstrap.mjs \
//     --manifest <path to release-manifest.json, schema seal.release/v2> \
//     --out <output directory> \
//     [--repository owner/repo]     (default: $SEAL_RELEASE_REPOSITORY or velvetmonkey/seal)
//
// Writes <out>/<bootstrapName> (the bootstrap script, mode 0o555) and
// <out>/<bootstrapName>.sha256 (its sidecar digest, in the same
// "<sha256>  <bytes>  <name>" line shape SHA256SUMS already uses elsewhere
// in this repository).
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { validateManifestShape } from "./release-manifest-lib.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TEMPLATE_PATH = path.join(ROOT, "scripts", "bootstrap-install.cjs");
const MARKER = '"__SEAL_BOOTSTRAP_RELEASE_FACTS_JSON__"';

function refuse(code, reason) {
  const error = new Error(`REFUSE bootstrap_generate_${code}: ${reason}`);
  error.code = code;
  throw error;
}

export function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

// Pure function: no filesystem or network access, so it is exercised
// directly (and cheaply) by scripts/generate-bootstrap.mjs's own tests
// against hand-built manifest fixtures, not only end to end.
export function buildBootstrapArtifact({ manifest, repository, templateSource }) {
  validateManifestShape(manifest); // the same shape check generate-release-docs.mjs already trusts
  if (typeof repository !== "string" || !/^[^/\s]+\/[^/\s]+$/.test(repository)) {
    refuse("repository_invalid", `--repository must be owner/repo, got ${JSON.stringify(repository)}`);
  }
  const occurrences = templateSource.split(MARKER).length - 1;
  if (occurrences !== 1) {
    refuse("template_marker", `bootstrap template marker must appear exactly once in scripts/bootstrap-install.cjs, found ${occurrences}`);
  }
  const releaseFacts = {
    schema: "seal.bootstrap-release/v1",
    repository,
    tag: manifest.tag,
    commitSha: manifest.commitSha,
    minimumNodeMajor: manifest.minimumNodeMajor,
    // Narrowed on purpose: only the fields the bootstrap needs to select and
    // verify a download. installedTreeSha256 and nativeHelperProvenance stay
    // out of the embedded surface; the bootstrap never inspects the payload
    // tree itself, install.cjs does, unmodified, after the handoff.
    artifacts: manifest.artifacts.map((artifact) => ({
      platform: artifact.platform,
      name: artifact.name,
      sha256: artifact.sha256,
      bytes: artifact.bytes,
    })),
  };
  const injected = templateSource.split(MARKER).join(JSON.stringify(releaseFacts));
  const name = `seal-bootstrap-${manifest.tag}`;
  const header = [
    "#!/bin/sh",
    "if ! command -v node >/dev/null 2>&1; then",
    // Deliberately `>&2`, unlike scripts/install.cjs's own shell-stub header
    // (which prints its equivalent node_missing line to stdout): every other
    // refusal this bootstrap prints goes to stderr, so this one does too. See
    // the generation-order comment above this function for why the two shell
    // stubs otherwise intentionally duplicate each other line for line.
    `  printf '%s\\n' "REFUSE node_missing: this installer requires Node >= ${manifest.minimumNodeMajor}. Install Node (for example via nvm, or your OS package manager), then re-run this script." >&2`,
    "  exit 1",
    "fi",
    "exec node - \"$0\" \"$@\" <<'SEAL_BOOTSTRAP_JS'",
    injected,
    "SEAL_BOOTSTRAP_JS",
    "",
  ].join("\n");
  return { name, bytes: Buffer.from(header, "utf8"), releaseFacts };
}

function option(argv, name) {
  const at = argv.indexOf(name);
  if (at < 0) return undefined;
  const value = argv[at + 1];
  if (value === undefined) refuse("arguments", `${name} needs a value`);
  return value;
}

function main() {
  const argv = process.argv.slice(2);
  const manifestPath = option(argv, "--manifest");
  const outDir = option(argv, "--out");
  const repository = option(argv, "--repository") || process.env.SEAL_RELEASE_REPOSITORY || "velvetmonkey/seal";
  if (!manifestPath || !outDir) refuse("arguments", "usage: generate-bootstrap.mjs --manifest <release-manifest.json> --out <dir> [--repository owner/repo]");

  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(path.resolve(manifestPath), "utf8"));
  } catch (error) {
    refuse("manifest_json", `${manifestPath}: ${error.message}`);
  }
  const templateSource = fs.readFileSync(TEMPLATE_PATH, "utf8").replace(/^#!\/usr\/bin\/env node\n/, "");
  const { name, bytes } = buildBootstrapArtifact({ manifest, repository, templateSource });

  fs.mkdirSync(path.resolve(outDir), { recursive: true });
  const dest = path.join(path.resolve(outDir), name);
  fs.writeFileSync(dest, bytes, { mode: 0o555 });
  // Step 4 of the acyclic order above: hash the now-frozen bytes and publish
  // that digest in a file of its own, never back into `bytes`.
  const digest = sha256(bytes);
  const sidecar = `${dest}.sha256`;
  fs.writeFileSync(sidecar, `${digest}  ${bytes.length}  ${name}\n`);

  process.stdout.write(`${dest}\n`);
  process.stdout.write(`sha256 ${digest}\n`);
  process.stdout.write(`bytes ${bytes.length}\n`);
  process.stdout.write(`${sidecar}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
