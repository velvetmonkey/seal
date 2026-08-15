#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Rebuild and materialize the generated distribution pin in the published copy.
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const dist = path.join(ROOT, "dist");
execFileSync(process.execPath, [path.join(ROOT, "scripts", "build-dist.cjs"), "--out", dist], { stdio: "inherit" });
const [sha256, bytes, artifact] = fs.readFileSync(path.join(dist, "SHA256SUMS"), "utf8").trim().split(/\s+/);
const meta = JSON.parse(fs.readFileSync(path.join(dist, `${artifact}.meta.json`), "utf8"));
fs.writeFileSync(path.join(ROOT, "SHA256SUMS"), `${sha256}  ${bytes}  ${artifact}\n`);

function rewrite(file, replacements) {
  const target = path.join(ROOT, file);
  let text = fs.readFileSync(target, "utf8");
  for (const [expression, value] of replacements) text = text.replace(expression, value);
  fs.writeFileSync(target, text);
}

for (const file of ["README.md", "docs/DISTRIBUTION.md", "docs/guide/README.md"]) {
  rewrite(file, [
    [/--sha256 [0-9a-f]+(?: --bytes \d+)?/g, `--sha256 ${sha256} --bytes ${bytes}`],
  ]);
}
for (const file of ["README.md", "docs/guide/README.md"]) {
  rewrite(file, [
    [/^sha256 [0-9a-f]+$/gm, `sha256 ${sha256}`],
    [/^bytes \d+$/gm, `bytes ${bytes}`],
    [/^tree:? [0-9a-f]+$/gm, `tree ${meta.treeSha256}`],
    [/\/store\/[0-9a-f]+/g, `/store/${meta.treeSha256}`],
  ]);
}
