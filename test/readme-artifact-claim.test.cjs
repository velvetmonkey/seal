// SPDX-License-Identifier: Apache-2.0
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const ROOT = path.join(__dirname, "..");
const README = fs.readFileSync(path.join(ROOT, "README.md"), "utf8");
const VERSION = fs.readFileSync(path.join(ROOT, "VERSION"), "utf8").trim();
const artifact = `seal-v${VERSION}-linux-x64`;
const CHECK = path.join(ROOT, "scripts", "check-readme-artifact-claim.cjs");

function check(text) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "seal-readme-artifact-claim-"));
  const file = path.join(dir, "README.md");
  fs.writeFileSync(file, text);
  return spawnSync(process.execPath, [CHECK], {
    encoding: "utf8",
    env: { ...process.env, README_ARTIFACT_CLAIM_README: file },
  });
}

test("README artifact claim rejects builder paths and development names for a released VERSION", () => {
  const green = check(README);
  assert.equal(green.status, 0, green.stderr);

  const absolute = check(README.replace(artifact, `/home/monkey/wt/builder/dist/${artifact}`));
  assert.equal(absolute.status, 1);
  assert.match(absolute.stderr, /builder-local absolute artifact path/);

  const development = check(README.replace(artifact, `seal-v${VERSION}-dev.gdeadbee-linux-x64`));
  assert.equal(development.status, 1);
  assert.match(development.stderr, /development artifact named while VERSION is a release/);
});
