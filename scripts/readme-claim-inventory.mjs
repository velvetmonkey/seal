#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Authoritative README inventory: population comes from ef918e0:README.md.
// The implementation lives in readme-source-inventory.mjs so its source-unit
// extractor can also be invoked directly while developing the classifier.
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const result = spawnSync(process.execPath, [resolve(root, "scripts/readme-source-inventory.mjs"), ...process.argv.slice(2)], { stdio: "inherit" });
process.exit(result.status ?? 2);
