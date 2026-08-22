#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// VERSION names the NEXT intended release. That is one job, and on its own it
// cannot also identify a build: a moving main would wear the name of a future
// immutable release for as long as the release is unpublished.
//
// The product identity separates the two:
//
//   HEAD is exactly tag v$VERSION  ->  $VERSION
//   anything else                  ->  $VERSION-dev.g<short-commit>
//
// The bare release form is reserved for the one commit its tag identifies.
// Anything else says, in its own name, that it is a development tree.
//
// This is NOT the collision gate in scripts/check-version-identity.cjs. That
// gate asks whether v$VERSION already identifies a different commit on origin,
// and it is the brake on reusing a published version. This asks a question
// that has an answer before any tag exists, and it never reaches the network.
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ROOT = path.join(__dirname, "..");
const SHORT_COMMIT = 7;

function git(root, args) {
  return spawnSync("git", ["-C", root, ...args], { encoding: "utf8" });
}

function readVersion(root) {
  return fs.readFileSync(path.join(root, "VERSION"), "utf8").trim();
}

// kind is one of:
//   release      HEAD is exactly the commit tag v$VERSION identifies
//   development  HEAD is a known commit that the tag does not identify
//   unknown      no commit could be read at all (no git, no repository)
// `unknown` still yields a development identity. A tree that cannot prove it
// is the release must not be allowed to claim it by default.
function productIdentity(options = {}) {
  const root = options.root || ROOT;
  const version = options.version || readVersion(root);
  const tag = `v${version}`;

  const head = git(root, ["rev-parse", "HEAD"]);
  if (head.status !== 0) {
    return { version, tag, kind: "unknown", commit: null, identity: `${version}-dev.gunknown` };
  }
  const commit = head.stdout.trim();

  const tagged = git(root, ["rev-parse", "-q", "--verify", `refs/tags/${tag}^{commit}`]);
  if (tagged.status === 0 && tagged.stdout.trim() === commit) {
    return { version, tag, kind: "release", commit, identity: version };
  }
  return {
    version,
    tag,
    kind: "development",
    commit,
    identity: `${version}-dev.g${commit.slice(0, SHORT_COMMIT)}`,
  };
}

// Each platform artifact carries its identity in its filename. The
// bytes cannot carry it: this repository pins the artifact digest in-tree, and
// a digest that depended on the commit could never be pinned by a commit.
function artifactName(identity, platform = "linux-x64") {
  return `seal-v${identity}-${platform}`;
}

function releaseArtifactName(version, platform = "linux-x64") {
  return `seal-v${version}-${platform}`;
}

module.exports = { productIdentity, artifactName, releaseArtifactName };

if (require.main === module) {
  const record = productIdentity();
  if (process.argv.includes("--json")) {
    process.stdout.write(`${JSON.stringify(record, null, 2)}\n`);
  } else if (process.argv.includes("--artifact-name")) {
    process.stdout.write(`${artifactName(record.identity)}\n`);
  } else {
    process.stdout.write(`seal ${record.identity}\n`);
  }
}
