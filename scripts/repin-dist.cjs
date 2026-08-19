#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Rebuild and materialize the generated distribution pin in the published copy.
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const {
  formatInstalledTreeRefusal,
  scanInstalledTreePinFiles,
} = require("./installed-tree-pin-regions.cjs");
const { releaseArtifactName } = require("./product-identity.cjs");

const ROOT = path.join(__dirname, "..");
const dist = path.join(ROOT, "dist");

function applyReplacements(text, replacements) {
  for (const [expression, value] of replacements) text = text.replace(expression, value);
  return text;
}

function inspectRoleMarkedPins() {
  return scanInstalledTreePinFiles(ROOT).map((entry) => ({
    file: entry.file,
    target: path.join(ROOT, entry.file),
    original: entry.text,
    scanned: entry.scanned,
  }));
}

function rewriteRoleMarkedPins(inspected, values, outsideReplacements, refusals) {
  const { file, target, original, scanned } = inspected;
  const protectedBlocks = [];
  let rewritten = "";
  let cursor = 0;
  for (const region of scanned.regions) {
    const hits = scanned.hits.filter((hit) => hit.region === region);
    if (hits.length === 0) continue;
    const role = hits[0].role;
    const block = original.slice(region.regionStart, region.end);
    rewritten += original.slice(cursor, region.regionStart);
    if (role === "published-asset") {
      const markerAt = region.markers[0].line;
      refusals.push(
        `REFUSE published_asset_pin: ${file}:${markerAt} role published-asset is immutable; block left byte-identical`,
      );
      const token = `\0seal-protected-block-${protectedBlocks.length}\0`;
      protectedBlocks.push([token, block]);
      rewritten += token;
    } else {
      rewritten += block
        .replace(/^sha256 [0-9a-f]+$/gm, `sha256 ${values.sha256}`)
        .replace(/^bytes \d+$/gm, `bytes ${values.bytes}`)
        .replace(/^tree:? [0-9a-f]+$/gm, `tree ${values.treeSha256}`)
        .replace(/\/store\/[0-9a-f]+/g, `/store/${values.treeSha256}`);
    }
    cursor = region.end;
  }
  rewritten += original.slice(cursor);
  rewritten = applyReplacements(rewritten, outsideReplacements);
  for (const [token, block] of protectedBlocks) rewritten = rewritten.replace(token, block);
  fs.writeFileSync(target, rewritten);
}

function main() {
  const inspected = inspectRoleMarkedPins();
  const structuralRefusals = inspected.flatMap(({ scanned }) =>
    scanned.issues.map(formatInstalledTreeRefusal));
  if (structuralRefusals.length > 0) {
    process.stderr.write(`${structuralRefusals.join("\n")}\n`);
    process.exitCode = 1;
    return;
  }

  execFileSync(process.execPath, [path.join(ROOT, "scripts", "build-dist.cjs"), "--out", dist], { stdio: "inherit" });
  const [sha256, bytes, artifact] = fs.readFileSync(path.join(dist, "SHA256SUMS"), "utf8").trim().split(/\s+/);
  const meta = JSON.parse(fs.readFileSync(path.join(dist, `${artifact}.meta.json`), "utf8"));
  // The build just made is named for THIS commit. The pin is a claim about the
  // bytes the release will publish, so it carries the release name. The two
  // agree because the payload is named by VERSION and never by the commit.
  const released = releaseArtifactName(meta.version);
  fs.writeFileSync(path.join(ROOT, "SHA256SUMS"), `${sha256}  ${bytes}  ${released}\n`);

  const values = { sha256, bytes, treeSha256: meta.treeSha256 };
  const refusals = [];
  // Materialize each copyable install command from the artifact that was just
  // built. The filename, digest and byte count are one generated unit.
  // The README builds from source, so the file it produces is named for whatever
  // commit the reader is standing on. The command names the shape; the printed
  // transcript names the commit this repin ran at.
  // Download instructions derive their filename, digest, and byte count from
  // the SHA256SUMS asset attached to the same release; do not materialize a
  // release-specific command here.
  const extraReplacements = {
    "README.md": [
      [/^\.\/dist\/seal-v[^ ]+-linux-x64 --sha256 [0-9a-f]+ --bytes \d+ --prefix ~\/\.local$/m,
        `./dist/seal-v*-linux-x64 --sha256 ${sha256} --bytes ${bytes} --prefix ~/.local`],
      [/^(\/\S*\/dist\/)seal-v[^ /]+-linux-x64$/m, `$1${artifact}`],
    ],
  };
  for (const item of inspected) {
    const extras = extraReplacements[item.file] || [];
    if (item.scanned.hits.length === 0 && extras.length === 0) continue;
    rewriteRoleMarkedPins(item, values, extras, refusals);
  }

  if (refusals.length > 0) {
    process.stderr.write(`${refusals.join("\n")}\n`);
    process.exitCode = 1;
  }
}

main();
