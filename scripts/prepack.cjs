#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Gate the real npm lifecycle; the inner dry run only asks npm for its file list.
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { PAYLOAD_PATHS } = require("./build-dist.cjs");

const root = path.resolve(__dirname, "..");

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit", ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed (${result.signal || result.status})`);
  return result;
}

function checkContent() {
  const expected = new Set([...PAYLOAD_PATHS, "README.md"]);
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  if (!Array.isArray(manifest.files) || manifest.files.length !== expected.size ||
      new Set(manifest.files).size !== expected.size || manifest.files.some(file => !expected.has(file))) {
    throw new Error("package.json files must exactly declare the installer payload plus README.md");
  }
  for (const file of expected) {
    if (!fs.lstatSync(path.join(root, file)).isFile()) throw new Error(`required package file is not regular: ${file}`);
  }
  // --ignore-scripts prevents recursive prepack invocation, not the outer gate.
  // --dry-run never creates a tarball. npm applies its real inclusion rules.
  const npmArgs = ["pack", "--dry-run", "--ignore-scripts", "--json"];
  const result = process.env.npm_execpath
    ? run(process.execPath, [process.env.npm_execpath, ...npmArgs], { encoding: "utf8", stdio: "pipe" })
    : run("npm", npmArgs, { encoding: "utf8", stdio: "pipe" });
  const packs = JSON.parse(result.stdout);
  if (packs.length !== 1 || !Array.isArray(packs[0].files)) throw new Error("npm returned no unique package file list");
  const actual = new Set(packs[0].files.map(file => file.path));
  const missing = [...expected].filter(file => !actual.has(file));
  const extra = [...actual].filter(file => !expected.has(file));
  if (missing.length || extra.length) {
    throw new Error(`package content mismatch: missing [${missing.join(", ")}]; extra [${extra.join(", ")}]`);
  }
  console.log(`prepack: package content OK (${actual.size} files)`);
}

try {
  run(process.execPath, ["scripts/sync-version.cjs"]);
  checkContent();
  // Always test this source tree, even if a caller has suite fixture overrides.
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith("SEAL_PRODUCT_") || key === "SEAL_CRITICAL_PROPERTY_MANIFEST") delete env[key];
  }
  // The estate's admission wrapper is optional outside the estate; the suite is not.
  const admission = "/home/monkey/bin/suiterun";
  if (fs.existsSync(admission)) run(admission, ["--", "scripts/run-complete-product-suite.sh"], { env });
  else run("bash", ["scripts/run-complete-product-suite.sh"], { env });
  // Recheck after the suite, so any content changes during testing also refuse.
  checkContent();
} catch (error) {
  console.error(`REFUSE prepack: ${error.message}`);
  process.exitCode = 1;
}
