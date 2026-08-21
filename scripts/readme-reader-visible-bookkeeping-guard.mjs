#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Keep repository guard-scoping prose out of the README a reader sees.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const readme = resolve(process.env.SEAL_READER_README ?? "README.md");
const source = readFileSync(readme, "utf8");
const visible = source.replace(/<!--[\s\S]*?-->/g, (comment) => "\n".repeat((comment.match(/\n/g) ?? []).length));
const match = /\bScope of the [^\n:]*\b(?:guard|check):/i.exec(visible);
if (match) {
  const line = visible.slice(0, match.index).split("\n").length;
  console.error(`FAIL  reader-visible guard bookkeeping: ${readme}:${line}: ${match[0]}`);
  process.exit(1);
}
console.log(`PASS  no reader-visible guard bookkeeping: ${readme}`);
