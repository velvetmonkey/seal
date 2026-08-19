#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Rebuild and materialize the generated distribution pin in the published copy.
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const { releaseArtifactName } = require("./product-identity.cjs");

const ROOT = path.join(__dirname, "..");
const dist = path.join(ROOT, "dist");
const STORE_HASH = /(?:\btree:?\s+|\/store\/)[0-9a-f]{64}\b/g;
const MARKED_FENCE =
  /^(\*\*Seal installed-tree pin role:\*\* `([A-Za-z0-9][A-Za-z0-9-]*)`\r?\n)(```[^\n]*\r?\n)([\s\S]*?)(^```\s*$)/gm;
const KNOWN_ROLES = new Set(["published-asset", "fresh-build"]);
const refusals = [];
execFileSync(process.execPath, [path.join(ROOT, "scripts", "build-dist.cjs"), "--out", dist], { stdio: "inherit" });
const [sha256, bytes, artifact] = fs.readFileSync(path.join(dist, "SHA256SUMS"), "utf8").trim().split(/\s+/);
const meta = JSON.parse(fs.readFileSync(path.join(dist, `${artifact}.meta.json`), "utf8"));
// The build just made is named for THIS commit. The pin is a claim about the
// bytes the release will publish, so it carries the release name. The two
// agree because the payload is named by VERSION and never by the commit.
const released = releaseArtifactName(meta.version);
fs.writeFileSync(path.join(ROOT, "SHA256SUMS"), `${sha256}  ${bytes}  ${released}\n`);

function applyReplacements(text, replacements) {
  for (const [expression, value] of replacements) text = text.replace(expression, value);
  return text;
}

function lineNumber(text, index) {
  return text.slice(0, index).split("\n").length;
}

function rewriteRoleMarkedPins(file, outsideReplacements = []) {
  const target = path.join(ROOT, file);
  const original = fs.readFileSync(target, "utf8");
  const markedRanges = [];
  const protectedBlocks = [];
  let rewritten = original.replace(
    MARKED_FENCE,
    (block, markerLine, role, opening, body, closing, offset) => {
      markedRanges.push({ start: offset, end: offset + block.length });
      if (!STORE_HASH.test(body)) {
        STORE_HASH.lastIndex = 0;
        return block;
      }
      STORE_HASH.lastIndex = 0;
      const markerAt = lineNumber(original, offset);
      if (!KNOWN_ROLES.has(role)) {
        refusals.push(
          `REFUSE role_marker_unknown: ${file}:${markerAt} unknown store-hash role ${JSON.stringify(role)}`,
        );
        const token = `\0seal-protected-block-${protectedBlocks.length}\0`;
        protectedBlocks.push([token, block]);
        return token;
      }
      if (role === "published-asset") {
        refusals.push(
          `REFUSE published_asset_pin: ${file}:${markerAt} role published-asset is immutable; block left byte-identical`,
        );
        const token = `\0seal-protected-block-${protectedBlocks.length}\0`;
        protectedBlocks.push([token, block]);
        return token;
      }
      const updatedBody = body
        .replace(/^sha256 [0-9a-f]+$/gm, `sha256 ${sha256}`)
        .replace(/^bytes \d+$/gm, `bytes ${bytes}`)
        .replace(/^tree:? [0-9a-f]+$/gm, `tree ${meta.treeSha256}`)
        .replace(/\/store\/[0-9a-f]+/g, `/store/${meta.treeSha256}`);
      return `${markerLine}${opening}${updatedBody}${closing}`;
    },
  );

  for (const match of original.matchAll(STORE_HASH)) {
    if (!markedRanges.some((range) => match.index >= range.start && match.index < range.end)) {
      refusals.push(
        `REFUSE role_marker_absent: ${file}:${lineNumber(original, match.index)} store hash has no role marker`,
      );
    }
  }
  rewritten = applyReplacements(rewritten, outsideReplacements);
  for (const [token, block] of protectedBlocks) rewritten = rewritten.replace(token, block);
  fs.writeFileSync(target, rewritten);
}

// Materialize each copyable install command from the artifact that was just
// built. The filename, digest and byte count are one generated unit.
// The README builds from source, so the file it produces is named for whatever
// commit the reader is standing on. The command names the shape; the printed
// transcript names the commit this repin ran at.
// Download instructions derive their filename, digest, and byte count from
// the SHA256SUMS asset attached to the same release; do not materialize a
// release-specific command here.
rewriteRoleMarkedPins("README.md", [
  [/^\.\/dist\/seal-v[^ ]+-linux-x64 --sha256 [0-9a-f]+ --bytes \d+ --prefix ~\/\.local$/m,
    `./dist/seal-v*-linux-x64 --sha256 ${sha256} --bytes ${bytes} --prefix ~/.local`],
  [/^(\/\S*\/dist\/)seal-v[^ /]+-linux-x64$/m, `$1${artifact}`],
]);
rewriteRoleMarkedPins("docs/guide/README.md");

if (refusals.length > 0) {
  process.stderr.write(`${refusals.join("\n")}\n`);
  process.exitCode = 1;
}
