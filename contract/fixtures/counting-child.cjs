#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// The fixtures' child process. Counts every line it receives into
// DATAFILE.count — a file only THIS process writes — so a test can observe
// whether any bytes reached the child, instead of trusting what the server
// printed. Same evidence rule as the spine acceptance test.
const fs = require("node:fs");
const path = require("node:path");
const readline = require("node:readline");

const dataFile = process.argv[2];
if (!dataFile) { process.stderr.write("usage: counting-child.cjs DATAFILE\n"); process.exit(2); }
const countFile = `${dataFile}.count`;

function writeSynced(filePath, text) {
  const fd = fs.openSync(filePath, "w", 0o600);
  try { fs.writeSync(fd, text); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}

fs.mkdirSync(path.dirname(dataFile), { recursive: true, mode: 0o700 });
writeSynced(dataFile, "");
writeSynced(countFile, "0\n");

let count = 0;
const input = readline.createInterface({ input: process.stdin, terminal: false });
input.on("line", (line) => {
  if (!line.trim()) return;
  count += 1;
  fs.appendFileSync(dataFile, line + "\n");
  writeSynced(countFile, `${count}\n`);
  process.stdout.write(JSON.stringify({ received: count }) + "\n");
});
input.on("close", () => process.exit(0));
