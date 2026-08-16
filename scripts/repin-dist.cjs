#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Rebuild and materialize the generated distribution pin in the published copy.
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const { releaseArtifactName } = require("./product-identity.cjs");

const ROOT = path.join(__dirname, "..");
const dist = path.join(ROOT, "dist");
execFileSync(process.execPath, [path.join(ROOT, "scripts", "build-dist.cjs"), "--out", dist], { stdio: "inherit" });
const [sha256, bytes, artifact] = fs.readFileSync(path.join(dist, "SHA256SUMS"), "utf8").trim().split(/\s+/);
const meta = JSON.parse(fs.readFileSync(path.join(dist, `${artifact}.meta.json`), "utf8"));
// The build just made is named for THIS commit. The pin is a claim about the
// bytes the release will publish, so it carries the release name. The two
// agree because the payload is named by VERSION and never by the commit.
const released = releaseArtifactName(meta.version);
fs.writeFileSync(path.join(ROOT, "SHA256SUMS"), `${sha256}  ${bytes}  ${released}\n`);

function rewrite(file, replacements) {
  const target = path.join(ROOT, file);
  let text = fs.readFileSync(target, "utf8");
  for (const [expression, value] of replacements) text = text.replace(expression, value);
  fs.writeFileSync(target, text);
}

// Materialize each copyable install command from the artifact that was just
// built. The filename, digest and byte count are one generated unit.
// The README builds from source, so the file it produces is named for whatever
// commit the reader is standing on. The command names the shape; the printed
// transcript names the commit this repin ran at.
rewrite("README.md", [
  [/^\.\/dist\/seal-v[^ ]+-linux-x64 --sha256 [0-9a-f]+ --bytes \d+ --prefix ~\/\.local$/m,
    `./dist/seal-v*-linux-x64 --sha256 ${sha256} --bytes ${bytes} --prefix ~/.local`],
  [/^(\/\S*\/dist\/)seal-v[^ /]+-linux-x64$/m, `$1${artifact}`],
]);
// These two install a downloaded release, which is the one place the bare
// release name is the truth.
rewrite("docs/DISTRIBUTION.md", [
  [/^\.\/seal-v[^ ]+-linux-x64 --sha256 [0-9a-f]+ --bytes \d+ --prefix ~\/\.local$/m,
    `./${released} --sha256 ${sha256} --bytes ${bytes} --prefix ~/.local`],
]);
rewrite("docs/guide/README.md", [
  [/^\$ curl -fLO https:\/\/github\.com\/velvetmonkey\/seal\/releases\/download\/v[^/]+\/seal-v[^ ]+-linux-x64$/m,
    `$ curl -fLO https://github.com/velvetmonkey/seal/releases/download/v${meta.version}/${released}`],
  [/^\$ chmod \+x seal-v[^ ]+-linux-x64$/m, `$ chmod +x ${released}`],
  [/^\$ \.\/seal-v[^ ]+-linux-x64 --sha256 [0-9a-f]+ --bytes \d+$/m,
    `$ ./${released} --sha256 ${sha256} --bytes ${bytes}`],
]);
for (const file of ["README.md", "docs/guide/README.md"]) {
  rewrite(file, [
    [/^sha256 [0-9a-f]+$/gm, `sha256 ${sha256}`],
    [/^bytes \d+$/gm, `bytes ${bytes}`],
    [/^tree:? [0-9a-f]+$/gm, `tree ${meta.treeSha256}`],
    [/\/store\/[0-9a-f]+/g, `/store/${meta.treeSha256}`],
  ]);
}
