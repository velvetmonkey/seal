#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Rebuild and materialize the generated distribution pin in the published copy.
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const { releaseArtifactName } = require("./product-identity.cjs");

const ROOT = path.join(__dirname, "..");
const dist = path.join(ROOT, "dist");
const leaveRootPin = process.argv.includes("--leave-root-pin");
execFileSync(process.execPath, [path.join(ROOT, "scripts", "build-dist.cjs"), "--out", dist], { stdio: "inherit" });
const [sha256, bytes, artifact] = fs.readFileSync(path.join(dist, "SHA256SUMS"), "utf8").trim().split(/\s+/);
const meta = JSON.parse(fs.readFileSync(path.join(dist, `${artifact}.meta.json`), "utf8"));
// The build just made is named for THIS commit. The pin is a claim about the
// bytes the release will publish, so it carries the release name. The two
// agree because the payload is named by VERSION and never by the commit.
const released = releaseArtifactName(meta.version);
if (!leaveRootPin) fs.writeFileSync(path.join(ROOT, "SHA256SUMS"), `${sha256}  ${bytes}  ${released}\n`);

function rewrite(file, replacements) {
  const target = path.join(ROOT, file);
  let text = fs.readFileSync(target, "utf8");
  for (const [expression, value] of replacements) text = text.replace(expression, value);
  fs.writeFileSync(target, text);
}

// Materialize each copyable install command from the artifact that was just
// built. The filename, digest and byte count are one generated unit.
// The README transcript is release copy, not a record of this builder's
// checkout. Give it the tag-time filename with no local-directory prefix;
// development builds still identify their own commits in dist/SHA256SUMS.
rewrite("README.md", [
  [/^\.\/dist\/seal-v[^ ]+-linux-x64 --sha256 [0-9a-f]+ --bytes \d+ --prefix ~\/\.local$/m,
    `./dist/seal-v*-linux-x64 --sha256 ${sha256} --bytes ${bytes} --prefix ~/.local`],
  [/^(?:\/\S*\/dist\/)?seal-v[^ /]+-linux-x64$/m, releaseArtifactName(meta.version)],
  [/^A build off a release tag names itself `-dev\.g<commit>`; the bare release name is reserved for the tag\./m,
    `At the exact release tag, your build writes \`${releaseArtifactName(meta.version)}\` in your own \`dist/\` directory; other commits add \`-dev.g<commit>\` to their filenames.`],
]);
// Download instructions derive their filename, digest, and byte count from
// the SHA256SUMS asset attached to the same release; do not materialize a
// release-specific command here.
for (const file of ["README.md", "docs/guide/README.md"]) {
  rewrite(file, [
    [/^sha256 [0-9a-f]+$/gm, `sha256 ${sha256}`],
    [/^bytes \d+$/gm, `bytes ${bytes}`],
    [/^tree:? [0-9a-f]+$/gm, `tree ${meta.treeSha256}`],
    [/\/store\/[0-9a-f]+/g, `/store/${meta.treeSha256}`],
  ]);
}
