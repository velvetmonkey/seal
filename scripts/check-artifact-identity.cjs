#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Bare-version refusal.
//
// A built artifact must be named for the product identity of the tree it was
// built from. The bare release name `seal-v$VERSION-linux-x64` is legal ONLY
// when HEAD is exactly tag v$VERSION. An untagged build that emits the bare
// name is refused by name, whether or not any tag exists yet.
//
// This is deliberately NOT the collision gate in check-version-identity.cjs.
// The collision gate needs origin and answers "does v$VERSION already identify
// a different commit?". This check needs no network and answers "does this
// artifact claim to be the release?". A tag-service outage must not be able to
// silence it, and it must fire on a version that has never been released.
const fs = require("node:fs");
const path = require("node:path");
const { productIdentity, artifactName, releaseArtifactName } = require("./product-identity.cjs");

const ROOT = path.join(__dirname, "..");
const ARTIFACT = /^seal-v.+-linux-x64$/;

function refuse(code, message) {
  process.stderr.write(`REFUSE ${code}: ${message}\n`);
  process.exit(1);
}

function distDir(argv) {
  const at = argv.indexOf("--dist");
  if (at < 0) return path.join(ROOT, "dist");
  const value = argv[at + 1];
  if (!value) refuse("dist_argument_missing", "--dist requires a directory");
  return path.resolve(value);
}

function main() {
  const dir = distDir(process.argv);
  let entries;
  try {
    entries = fs.readdirSync(dir);
  } catch (error) {
    refuse("dist_unreadable", `${dir} could not be read: ${error.message}`);
  }

  const built = entries.filter((name) => ARTIFACT.test(name));
  if (built.length === 0) {
    // Silence must not read as approval. An empty directory means the check
    // never saw the artifact it was asked to judge.
    refuse("no_named_artifact", `${dir} holds no seal-v<identity>-linux-x64 file to identify`);
  }

  const record = productIdentity({ root: ROOT });
  const expected = artifactName(record.identity);
  const bare = releaseArtifactName(record.version);

  for (const name of built) {
    if (name === expected) continue;
    if (name === bare) {
      refuse(
        "bare_release_identity",
        `${name} wears the released name ${record.tag}, but HEAD ${record.commit || "(unknown)"} is not ${record.tag}; an untagged build must be named ${expected}`,
      );
    }
    refuse(
      "artifact_identity_mismatch",
      `${name} is not the product identity of this tree; expected ${expected}`,
    );
  }

  const sums = path.join(dir, "SHA256SUMS");
  if (fs.existsSync(sums)) {
    const named = fs.readFileSync(sums, "utf8").trim().split(/\s+/)[1];
    if (named !== expected) {
      refuse("checksum_identity_mismatch", `${sums} names ${named}; expected ${expected}`);
    }
  }

  process.stdout.write(`product identity ${record.identity} (${record.kind}): ${expected}\n`);
}

main();
