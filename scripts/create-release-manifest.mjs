#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
import fs from "node:fs";
import path from "node:path";
import { manifestFromObserved } from "./release-manifest-lib.mjs";

function argument(name) {
  const at = process.argv.indexOf(name);
  if (at < 0 || !process.argv[at + 1]) throw new Error(`missing ${name}`);
  return process.argv[at + 1];
}

function argumentsFor(name) {
  const values = [];
  for (let index = 0; index < process.argv.length; index += 1) {
    if (process.argv[index] === name) {
      if (!process.argv[index + 1]) throw new Error(`missing ${name}`);
      values.push(process.argv[index + 1]);
    }
  }
  return values;
}

try {
  const artifacts = argumentsFor("--artifact").map((artifact) => path.resolve(artifact));
  const checker = path.resolve(argument("--checker"));
  const checksums = path.resolve(argument("--checksums"));
  const out = path.resolve(argument("--out"));
  const manifest = manifestFromObserved({
    tag: argument("--tag"),
    commitSha: argument("--commit"),
    artifacts: artifacts.map((artifact) => ({
      name: path.basename(artifact),
      bytes: fs.readFileSync(artifact),
    })),
    checkerName: path.basename(checker),
    checkerBytes: fs.readFileSync(checker),
    checksumsName: path.basename(checksums),
    checksumsBytes: fs.readFileSync(checksums),
  });
  fs.writeFileSync(out, `${JSON.stringify(manifest, null, 2)}\n`);
  process.stdout.write(`${out}\n`);
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
}
