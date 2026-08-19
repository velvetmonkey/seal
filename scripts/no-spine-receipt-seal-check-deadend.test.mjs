#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// The public seal-check route does not accept Seal's seal.spine/v1 receipts.
// Keep receipt holders on the shipped checker until that route is wired.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const defaultFiles = [resolve(ROOT, "README.md"), resolve(ROOT, "spine/demo.cjs")];
const files = process.argv.slice(2).map((file) => resolve(file));
const targets = files.length ? files : defaultFiles;
const publicRoute = /https?:\/\/velvetmonkey\.github\.io\/seal-check\/?/g;
const failures = [];
const contents = new Map();

for (const file of targets) {
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch (error) {
    const reason = error.code === "ENOENT" ? "absent" : error.code === "EACCES" ? "unreadable" : `read error ${error.code ?? error.message}`;
    failures.push(`deadend_spine_receipt_link: ${reason} file ${file}`);
    continue;
  }
  if (text.length === 0) {
    failures.push(`deadend_spine_receipt_link: empty file ${file}`);
    continue;
  }
  contents.set(file, text);
  for (const match of text.matchAll(publicRoute)) {
    const line = text.slice(0, match.index).split("\n").length;
    failures.push(`deadend_spine_receipt_link: ${file}:${line}: reader-followable seal-check route`);
  }
}

if (!files.length) {
  const readme = contents.get(defaultFiles[0]) ?? "";
  if (!readme.includes("node checker/seal-receipt-check.mjs RECEIPT.json --pubkey (HEX | FILE)")) {
    failures.push(`deadend_spine_receipt_link: ${defaultFiles[0]} is missing the shipped checker Usage command`);
  }
  const demo = contents.get(defaultFiles[1]) ?? "";
  if (!demo.includes('path.resolve(path.dirname(sealBinPath), "..", "checker", "seal-receipt-check.mjs")') || !demo.includes("--pubkey")) {
    failures.push(`deadend_spine_receipt_link: ${defaultFiles[1]} is missing the shipped checker command`);
  }
}

if (failures.length) {
  process.stderr.write(`${failures.join("\n")}\n`);
  process.exit(1);
}

process.stdout.write(`PASS deadend_spine_receipt_link: ${targets.length} reader-facing files contain no public seal-check route\n`);
