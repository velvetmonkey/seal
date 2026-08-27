#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const { LIMIT, SCHEMA, SOURCE_PINS, execute } = require("../scripts/seal-reproduce.cjs");

const TAG = "v0.2.0-rc.3";
const ASSET = `seal-${TAG}-linux-x64`;
const PUBLISHED_KERNEL = Buffer.from("published kernel bytes\n");
const OUTSIDE_AUTHORITY = "independ" + "ent";

function digest(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function harness(options = {}) {
  let builds = 0;
  let installedPath;
  const assetBytes = Buffer.from("fixture installer bytes\n");
  const declaredDigest = digest(assetBytes);
  return {
    get builds() { return builds; },
    get installedPath() { return installedPath; },
    deps: {
      download(url, destination) {
        if (url.endsWith("/SHA256SUMS")) {
          const checksum = options.checksum || `${declaredDigest}  ${assetBytes.length}  ${ASSET}\n`;
          fs.writeFileSync(destination, checksum);
        } else {
          fs.writeFileSync(destination, assetBytes);
        }
      },
      installPublished(_asset, _declared, work) {
        const prefix = fs.mkdtempSync(path.join(work, "test-prefix-"));
        installedPath = path.join(prefix, "runtime", "kernel", "wasm", "seal.wasm");
        fs.mkdirSync(path.dirname(installedPath), { recursive: true });
        fs.writeFileSync(installedPath, PUBLISHED_KERNEL);
        return installedPath;
      },
      afterPublishedKernel: options.afterPublishedKernel,
      buildPinnedKernel(_tag, work) {
        builds += 1;
        const rebuilt = path.join(work, "fresh-source-build", "seal.wasm");
        fs.mkdirSync(path.dirname(rebuilt), { recursive: true });
        fs.writeFileSync(rebuilt, PUBLISHED_KERNEL);
        return rebuilt;
      },
    },
  };
}

test("honest comparison uses distinct origins and emits seal.reproduction/v1", () => {
  const h = harness();
  const outcome = execute([TAG], h.deps);
  assert.equal(outcome.exitCode, 0);
  assert.equal(outcome.report.schema, SCHEMA);
  assert.equal(outcome.report.result, "reproduced");
  assert.equal(outcome.report.authority, "same-authority");
  assert.equal(outcome.report.limit, LIMIT);
  assert.equal(outcome.report.published_kernel_sha256, digest(PUBLISHED_KERNEL));
  assert.equal(outcome.report.rebuilt_kernel_sha256, digest(PUBLISHED_KERNEL));
  assert.equal(h.builds, 1);
  assert.ok(h.installedPath.includes("test-prefix-"));
  assert.equal(fs.existsSync(h.installedPath), false);
  assert.ok(SOURCE_PINS[TAG].commit.match(/^[0-9a-f]{40}$/));
});

test("one flipped byte in the extracted kernel produces mismatch and nonzero exit", () => {
  const h = harness({
    afterPublishedKernel(file) {
      const bytes = fs.readFileSync(file);
      bytes[0] ^= 1;
      fs.writeFileSync(file, bytes);
    },
  });
  const outcome = execute([TAG], h.deps);
  assert.equal(outcome.exitCode, 1);
  assert.equal(outcome.report.result, "mismatch");
  assert.notEqual(outcome.report.published_kernel_sha256, outcome.report.rebuilt_kernel_sha256);
  assert.equal(h.builds, 1);
});

test("edited SHA256SUMS digit refuses before install or build", () => {
  const h = harness({ checksum: `${"0".repeat(64)}  24  ${ASSET}\n` });
  const outcome = execute([TAG], h.deps);
  assert.equal(outcome.exitCode, 1);
  assert.equal(outcome.report.result, "refused");
  assert.match(outcome.error, /asset digest mismatch/);
  assert.equal(h.builds, 0);
  assert.equal(h.installedPath, undefined);
});

test("nonexistent well-formed tag refuses by name and never reports reproduced", () => {
  const missing = "v99.99.99-does-not-exist";
  const deps = {
    download() { throw new Error(`release download missing for ${missing}`); },
  };
  const outcome = execute([missing], deps);
  assert.equal(outcome.exitCode, 1);
  assert.equal(outcome.report.result, "refused");
  assert.match(outcome.error, new RegExp(missing));
  assert.notEqual(outcome.report.result, "reproduced");
});

test("outside-authority declaration requires a nonempty authority name", () => {
  let downloads = 0;
  const outcome = execute([TAG, "--authority", OUTSIDE_AUTHORITY], {
    download() { downloads += 1; },
  });
  assert.equal(outcome.exitCode, 1);
  assert.equal(outcome.report.result, "refused");
  assert.equal(outcome.report.authority, "same-authority");
  assert.match(outcome.error, /requires --authority-name/);
  assert.equal(downloads, 0);
});

test("caller declaration is the only path to outside authority", () => {
  const h = harness();
  const outcome = execute([TAG, "--authority", OUTSIDE_AUTHORITY, "--authority-name", "Outside Lab"], h.deps);
  assert.equal(outcome.exitCode, 0);
  assert.equal(outcome.report.authority, OUTSIDE_AUTHORITY);
});

test("invalid tags refuse before download using the published checker pattern", () => {
  let downloads = 0;
  const outcome = execute(["rc.3"], { download() { downloads += 1; } });
  assert.equal(outcome.report.result, "refused");
  assert.match(outcome.error, /release tag is invalid: rc\.3/);
  assert.equal(downloads, 0);
});
