#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const { LEAN_LAUNCHER_ENV, LIMIT, SCHEMA, SOURCE_PINS, execute, executeBuildPinned, leanLauncher, leanLauncherMissingMessage } = require("../scripts/seal-reproduce.cjs");

const TAG = "v0.2.0-rc.3";
const ASSET = `seal-${TAG}-linux-x64`;
const PUBLISHED_KERNEL = Buffer.from("published kernel bytes\n");
const OUTSIDE_AUTHORITY = "independ" + "ent";
const LIMIT_CLAIM = "This result covers only the selected artifact's kernel bytes. It is not a proof that the rule is the right rule, and it does not establish independence when the rebuilder and the publisher are the same authority.";

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

test("honest comparison names and scopes the selected artifact kernel", () => {
  const h = harness();
  const outcome = execute([TAG], h.deps);
  assert.equal(outcome.exitCode, 0);
  assert.equal(outcome.report.schema, SCHEMA);
  assert.equal(outcome.report.result, "artifact-kernel-match");
  assert.equal(outcome.report.platform, "linux-x64");
  assert.equal(outcome.report.asset.name, ASSET);
  assert.equal(outcome.report.scope, "selected-artifact-kernel-only");
  assert.deepEqual(outcome.report.native_macos_helper, {
    provenance: "release-produced, not independ" + "ently reproduced",
    covered_by_result: false,
  });
  assert.equal(outcome.report.authority, "same-authority");
  assert.equal(outcome.report.limit, LIMIT_CLAIM); // CLAIM-COVERAGE: docs/reproduce.md#limit
  assert.equal(outcome.report.published_kernel_sha256, digest(PUBLISHED_KERNEL));
  assert.equal(outcome.report.rebuilt_kernel_sha256, digest(PUBLISHED_KERNEL));
  assert.equal(h.builds, 1);
  assert.ok(h.installedPath.includes("test-prefix-"));
  assert.equal(fs.existsSync(h.installedPath), false);
  assert.ok(SOURCE_PINS[TAG].commit.match(/^[0-9a-f]{40}$/));
});

test("the CLI prints exactly one schema-bearing JSON report on refusal", () => {
  const run = spawnSync(process.execPath, [path.join(__dirname, "..", "scripts", "seal-reproduce.cjs"), "rc.3"], {
    encoding: "utf8",
  });
  const parsed = JSON.parse(run.stdout);
  assert.equal(parsed.schema, SCHEMA); // CLAIM-COVERAGE: docs/reproduce.md#schema
  assert.equal(run.stdout.trim().split(/\r?\n/)[0], "{");
  assert.match(run.stderr, /^REFUSE seal-reproduce/m);
  assert.equal(run.status, 1);
});

test("documented report result and field contract is executable", () => {
  const matched = execute([TAG], harness().deps);
  const mismatch = execute([TAG], harness({
    afterPublishedKernel(file) {
      const bytes = fs.readFileSync(file);
      bytes[0] ^= 1;
      fs.writeFileSync(file, bytes);
    },
  }).deps);
  const refused = execute([TAG], harness({ checksum: `${"0".repeat(64)}  24  ${ASSET}\n` }).deps);
  assert.deepEqual([matched.report.result, mismatch.report.result, refused.report.result], ["artifact-kernel-match", "artifact-kernel-mismatch", "refused"]); // CLAIM-COVERAGE: docs/reproduce.md#result
  assert.deepEqual([matched.exitCode, mismatch.exitCode, refused.exitCode], [0, 1, 1]); // CLAIM-COVERAGE: docs/reproduce.md#exit-codes
  assert.deepEqual(Object.keys(matched.report.asset), ["name", "declared_sha256", "declared_bytes", "observed_sha256", "observed_bytes"]); // CLAIM-COVERAGE: docs/reproduce.md#asset-keys
  assert.deepEqual(
    ["published_kernel_sha256", "rebuilt_kernel_sha256", "scope", "native_macos_helper", "result", "authority", "limit"].map((key) => Object.hasOwn(matched.report, key)),
    [true, true, true, true, true, true, true],
  ); // CLAIM-COVERAGE: docs/reproduce.md#report-fields
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
  assert.equal(outcome.report.result, "artifact-kernel-mismatch");
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

test("nonexistent well-formed tag refuses by name and never reports an artifact-kernel match", () => {
  const missing = "v99.99.99-does-not-exist";
  const deps = {
    download() { throw new Error(`release download missing for ${missing}`); },
  };
  const outcome = execute([missing], deps);
  assert.equal(outcome.exitCode, 1);
  assert.equal(outcome.report.result, "refused");
  assert.match(outcome.error, new RegExp(missing));
  assert.notEqual(outcome.report.result, "artifact-kernel-match");
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
  assert.equal(downloads, 0); // CLAIM-COVERAGE: docs/reproduce.md#download-refusal
});

test("caller declaration is the only path to outside authority", () => {
  const h = harness();
  const outcome = execute([TAG, "--authority", OUTSIDE_AUTHORITY, "--authority-name", "Outside Lab"], h.deps);
  assert.equal(outcome.exitCode, 0);
  assert.equal(outcome.report.authority, OUTSIDE_AUTHORITY); // CLAIM-COVERAGE: docs/reproduce.md#authority
});

test("invalid tags refuse before download using the published checker pattern", () => {
  let downloads = 0;
  const outcome = execute(["rc.3"], { download() { downloads += 1; } });
  assert.equal(outcome.report.result, "refused");
  assert.match(outcome.error, /release tag is invalid: rc\.3/);
  assert.equal(downloads, 0);
});

test("a Darwin platform question refuses before download and names the uncovered artifact", () => {
  let downloads = 0;
  const outcome = execute([TAG, "--platform", "darwin-arm64"], {
    download() { downloads += 1; },
  });
  assert.equal(outcome.exitCode, 1);
  assert.equal(outcome.report.result, "refused");
  assert.equal(outcome.report.platform, "darwin-arm64");
  assert.equal(outcome.report.asset.name, `seal-${TAG}-darwin-arm64`);
  assert.equal(outcome.report.native_macos_helper.provenance, "release-produced, not independ" + "ently reproduced");
  assert.equal(outcome.report.native_macos_helper.covered_by_result, false);
  assert.match(outcome.error, /only checks the linux-x64 artifact kernel/);
  assert.equal(downloads, 0);
  console.log(JSON.stringify(outcome.report));
});

test("Lean launcher defaults to portable lake and accepts the serialization override", () => {
  assert.equal(leanLauncher({}), "lake");
  assert.equal(leanLauncher({ [LEAN_LAUNCHER_ENV]: "/opt/serialized lake" }), "/opt/serialized lake");
  assert.equal(leanLauncher({ [LEAN_LAUNCHER_ENV]: "" }), "lake");
  assert.match(leanLauncherMissingMessage("lake"), /Install elan/);
  assert.match(leanLauncherMissingMessage("lake"), /ensure its lake executable is on PATH/);
  assert.match(leanLauncherMissingMessage("lake"), new RegExp(LEAN_LAUNCHER_ENV));
});

test("same-process rebuild resolves the executable declared by the pinned installer without GITHUB_PATH", (t) => {
  const fixture = fs.mkdtempSync(path.join(require("node:os").tmpdir(), "seal-pinned-launcher-"));
  t.after(() => fs.rmSync(fixture, { recursive: true, force: true }));
  const home = path.join(fixture, "home");
  const emptyPath = path.join(fixture, "empty-path");
  const installer = path.join(fixture, "install_pinned_elan.py");
  const githubPath = path.join(fixture, "github-path");
  const installedDirectory = path.join(home, ".fixture-elan", "from-installer");
  const installedLauncher = path.join(installedDirectory, "lake");
  fs.mkdirSync(installedDirectory, { recursive: true });
  fs.mkdirSync(emptyPath);
  fs.writeFileSync(installer, 'bin_directory = Path.home() / ".fixture-elan" / "from-installer"\n');
  fs.writeFileSync(installedLauncher, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  fs.writeFileSync(githubPath, `${path.join(fixture, "decoy-bin")}\n`);

  const environment = { HOME: home, PATH: emptyPath, GITHUB_PATH: githubPath };
  assert.equal(leanLauncher(environment, installer), installedLauncher);
  assert.equal(fs.readFileSync(githubPath, "utf8"), `${path.join(fixture, "decoy-bin")}\n`);
  assert.equal(leanLauncher({ ...environment, [LEAN_LAUNCHER_ENV]: "/override/lake" }, installer), "/override/lake");
});

test("pinned Lean toolchain CI check exercises every post-installer child environment", () => {
  const { checkPinnedLeanLauncher } = require("../scripts/check-pinned-lean-launcher.cjs");
  const realRepositoryRoot = path.resolve(__dirname, "..");
  assert.deepEqual(checkPinnedLeanLauncher(realRepositoryRoot), []);
});

test("rebuild-only entry point delegates to the owning pinned recipe and copies its output", (t) => {
  const outputDirectory = fs.mkdtempSync(path.join(require("node:os").tmpdir(), "seal-rebuild-output-"));
  t.after(() => fs.rmSync(outputDirectory, { recursive: true, force: true }));
  const output = path.join(outputDirectory, "rebuilt-seal.wasm");
  let observedTag;
  let observedWork;
  const outcome = executeBuildPinned([TAG, "--output", output], {
    buildPinnedKernel(tag, work) {
      observedTag = tag;
      observedWork = work;
      const rebuilt = path.join(work, "pinned-source", "wasm-spike", "build-core", "seal.wasm");
      fs.mkdirSync(path.dirname(rebuilt), { recursive: true });
      fs.writeFileSync(rebuilt, PUBLISHED_KERNEL);
      return rebuilt;
    },
  });
  assert.equal(outcome.exitCode, 0);
  assert.equal(observedTag, TAG);
  assert.equal(fs.existsSync(observedWork), false);
  assert.deepEqual(fs.readFileSync(output), PUBLISHED_KERNEL);
});

test("rebuild-only entry point refuses an unpinned tag before building", () => {
  let builds = 0;
  const outcome = executeBuildPinned(["not-a-tag", "--output", "unused.wasm"], {
    buildPinnedKernel() { builds += 1; },
  });
  assert.equal(outcome.exitCode, 1);
  assert.match(outcome.error, /release tag is invalid/);
  assert.equal(builds, 0);
});
