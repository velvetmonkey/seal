// SPDX-License-Identifier: Apache-2.0
// The published pin is the product. A hand-copied hash goes stale the
// moment a payload file is added. This test builds the artifact and
// FAILS unless SHA256SUMS equals the freshly built digest and byte count.
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const { productIdentity, artifactName, releaseArtifactName } = require("../scripts/product-identity.cjs");

const ROOT = path.join(__dirname, "..");
const PIN = path.join(ROOT, "SHA256SUMS");
const BUILD = path.join(ROOT, "scripts", "build-dist.cjs");
const VERSION = fs.readFileSync(path.join(ROOT, "VERSION"), "utf8").trim();

function parsePin(text) {
  const [sha256, bytes, name] = text.trim().split(/\s+/);
  return { sha256, bytes: Number(bytes), name };
}

test("the published pin matches a freshly built artifact", () => {
  const recorded = parsePin(fs.readFileSync(PIN, "utf8"));
  assert.match(recorded.sha256, /^[0-9a-f]{64}$/);
  assert.ok(Number.isInteger(recorded.bytes) && recorded.bytes > 0);
  // The pin is a claim about the bytes the RELEASE will publish, so it carries
  // the release name even while HEAD is untagged. The build below is named for
  // this commit; the two agree on bytes because the payload never carries one.
  assert.equal(recorded.name, releaseArtifactName(VERSION));

  const out = fs.mkdtempSync(path.join(os.tmpdir(), "seal-dist-pin-"));
  const built = spawnSync(process.execPath, [BUILD, "--out", out], { encoding: "utf8" });
  assert.equal(built.status, 0, built.stdout + built.stderr);

  const builtName = artifactName(productIdentity({ root: ROOT }).identity);
  const artifact = path.join(out, builtName);
  assert.ok(fs.existsSync(artifact), `missing ${builtName}\n${built.stdout}`);
  const bytes = fs.readFileSync(artifact);
  const digest = crypto.createHash("sha256").update(bytes).digest("hex");

  assert.equal(bytes.length, recorded.bytes, `SHA256SUMS bytes ${recorded.bytes} != built ${bytes.length}`);
  assert.equal(digest, recorded.sha256, `SHA256SUMS sha256 is stale; built ${digest} (${bytes.length} bytes)`);

  const docs = fs.readFileSync(path.join(ROOT, "docs", "DISTRIBUTION.md"), "utf8");
  assert.ok(docs.includes(recorded.sha256), "docs/DISTRIBUTION.md must carry the published sha256");
  assert.ok(docs.includes(String(recorded.bytes)), "docs/DISTRIBUTION.md must carry the published byte count");

  // The README's install beat pastes the pin inline so a stranger can copy
  // it. A payload change that leaves those values behind is the published
  // hash-vs-artifact mismatch this repo already shipped once; fail here first.
  const readme = fs.readFileSync(path.join(ROOT, "README.md"), "utf8");
  assert.ok(readme.includes(`--sha256 ${recorded.sha256}`), "README.md install command must carry the published sha256");
  assert.ok(readme.includes(`--bytes ${recorded.bytes}`), "README.md install command must carry the published byte count");

  const distribution = fs.readFileSync(path.join(ROOT, "docs", "DISTRIBUTION.md"), "utf8");
  const guide = fs.readFileSync(path.join(ROOT, "docs", "guide", "README.md"), "utf8");
  // README builds from source, where the filename carries the commit. The
  // pasted command names the shape so it stays true one commit later.
  assert.ok(readme.includes(`./dist/seal-v*-linux-x64 --sha256 ${recorded.sha256} --bytes ${recorded.bytes}`));
  assert.ok(distribution.includes(`./${recorded.name} --sha256 ${recorded.sha256} --bytes ${recorded.bytes}`));
  assert.ok(guide.includes(`$ ./${recorded.name} --sha256 ${recorded.sha256} --bytes ${recorded.bytes}`));
  assert.doesNotMatch(guide, /After Ben publishes/);
});
