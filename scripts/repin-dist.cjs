#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Rebuild and materialize the generated distribution pin in the published copy.
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { formatInstalledTreeRefusal, scanInstalledTreeRegions } = require("./installed-tree-pin-regions.cjs");
const { releaseArtifactName } = require("./product-identity.cjs");
const ROOT = path.join(__dirname, "..");
const dist = path.join(ROOT, "dist");

function applyReplacements(text, replacements) { for (const [expression, value] of replacements) text = text.replace(expression, value); return text; }
function inspect(file) {
  const target = path.join(ROOT, file);
  let stat;
  try { stat = fs.statSync(target); } catch (error) {
    const code = error.code === "ENOENT" ? "claim_input_absent" : "claim_input_unreadable";
    throw new Error(`REFUSE ${code}: ${file}: ${error.message}`);
  }
  if (!stat.isFile()) throw new Error(`REFUSE claim_input_unreadable: ${file}: not a regular file`);
  if ((stat.mode & 0o777) === 0) throw new Error(`REFUSE claim_input_unreadable: ${file}: mode 000 has no read permissions`);
  if (stat.size === 0) throw new Error(`REFUSE claim_input_empty: ${file}: installed-tree claim region is absent`);
  let original;
  try { original = fs.readFileSync(target, "utf8"); }
  catch (error) { throw new Error(`REFUSE claim_input_unreadable: ${file}: ${error.message}`); }
  return { file, target, original, scanned: scanInstalledTreeRegions(original, file) };
}
function rewrite(inspected, values, outsideReplacements, refusals) {
  const { file, target, original, scanned } = inspected;
  let rewritten = "";
  let cursor = 0;
  const protectedBlocks = [];
  for (const region of scanned.regions) {
    const hits = scanned.hits.filter((hit) => hit.region === region);
    if (!hits.length) continue;
    const block = original.slice(region.regionStart, region.end);
    rewritten += original.slice(cursor, region.regionStart);
    if (hits[0].role === "published-asset") {
      refusals.push(`REFUSE published_asset_pin: ${file}:${region.markers[0].line} role published-asset is immutable; block left byte-identical`);
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

let inspected;
try { inspected = [inspect("README.md"), inspect("docs/guide/README.md")]; }
catch (error) { process.stderr.write(`${error.message}\n`); process.exit(1); }
const structuralRefusals = inspected.flatMap(({ scanned }) => scanned.issues.map(formatInstalledTreeRefusal));
if (structuralRefusals.length) {
  process.stderr.write(`${structuralRefusals.join("\n")}\n`);
  process.exit(1);
}
execFileSync(process.execPath, [path.join(ROOT, "scripts", "build-dist.cjs"), "--out", dist], { stdio: "inherit" });
const [sha256, bytes, artifact] = fs.readFileSync(path.join(dist, "SHA256SUMS"), "utf8").trim().split(/\s+/);
const meta = JSON.parse(fs.readFileSync(path.join(dist, `${artifact}.meta.json`), "utf8"));
const released = releaseArtifactName(meta.version);
fs.writeFileSync(path.join(ROOT, "SHA256SUMS"), `${sha256}  ${bytes}  ${released}\n`);
const values = { sha256, bytes, treeSha256: meta.treeSha256 };
const refusals = [];
rewrite(inspected[0], values, [
  [/^\.\/dist\/seal-v[^ ]+-linux-x64 --sha256 [0-9a-f]+ --bytes \d+ --prefix ~\/\.local$/m, `./dist/seal-v*-linux-x64 --sha256 ${sha256} --bytes ${bytes} --prefix ~/.local`],
  [/^(\/\S*\/dist\/)seal-v[^ /]+-linux-x64$/m, `$1${artifact}`],
], refusals);
rewrite(inspected[1], values, [], refusals);
if (refusals.length) { process.stderr.write(`${refusals.join("\n")}\n`); process.exitCode = 1; }
