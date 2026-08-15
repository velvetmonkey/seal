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

const ROOT = path.join(__dirname, "..");
const PIN = path.join(ROOT, "SHA256SUMS");
const BUILD = path.join(ROOT, "scripts", "build-dist.cjs");

function parsePin(text) {
  const [sha256, bytes, name] = text.trim().split(/\s+/);
  return { sha256, bytes: Number(bytes), name };
}

test("the published pin matches a freshly built artifact", () => {
  const recorded = parsePin(fs.readFileSync(PIN, "utf8"));
  assert.match(recorded.sha256, /^[0-9a-f]{64}$/);
  assert.ok(Number.isInteger(recorded.bytes) && recorded.bytes > 0);
  assert.match(recorded.name, /^seal-v\d+\.\d+\.\d+-linux-x64$/);

  const out = fs.mkdtempSync(path.join(os.tmpdir(), "seal-dist-pin-"));
  const built = spawnSync(process.execPath, [BUILD, "--out", out], { encoding: "utf8" });
  assert.equal(built.status, 0, built.stdout + built.stderr);

  const artifact = path.join(out, recorded.name);
  assert.ok(fs.existsSync(artifact), `missing ${recorded.name}\n${built.stdout}`);
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
});
