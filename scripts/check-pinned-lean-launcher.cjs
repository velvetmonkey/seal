#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const TAG = "v0.2.0";

function exerciseOwner(owner, fixture, override) {
  const flavor = override ? "override" : "installed";
  const work = path.join(fixture, `${flavor}-work`);
  const home = path.join(fixture, `${flavor}-home`);
  const emptyPath = path.join(fixture, `${flavor}-empty-path`);
  const githubPath = path.join(fixture, `${flavor}-github-path`);
  const installedDirectory = path.join(home, ".guard-elan", "installer-bin");
  const installedLauncher = path.join(installedDirectory, "lake");
  const selectedLauncher = override || installedLauncher;
  const decoy = `${path.join(fixture, "github-path-decoy")}\n`;
  const launcherCommands = [];
  fs.mkdirSync(work, { recursive: true });
  fs.mkdirSync(emptyPath);
  fs.writeFileSync(githubPath, decoy);

  const environment = { HOME: home, PATH: emptyPath, GITHUB_PATH: githubPath };
  if (override) environment[owner.LEAN_LAUNCHER_ENV] = override;
  const rebuilt = owner.buildPinnedKernel(TAG, work, {
    environment,
    clonePinnedSource(_pin, destination) {
      fs.mkdirSync(path.join(destination, "scripts"), { recursive: true });
    },
    child(command, args) {
      if (command === "python3") {
        fs.writeFileSync(args[0], 'bin_directory = Path.home() / ".guard-elan" / "installer-bin"\n');
        fs.mkdirSync(installedDirectory, { recursive: true });
        fs.writeFileSync(installedLauncher, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
      }
      if (args[0] === "update" || args[0] === "build") launcherCommands.push(command);
      if (command === "./build_wasm.sh") {
        const output = path.join(work, "pinned-source", "wasm-spike", "build-core", "seal.wasm");
        fs.mkdirSync(path.dirname(output), { recursive: true });
        fs.writeFileSync(output, "not a real kernel build\n");
      }
    },
  });

  const findings = [];
  if (launcherCommands.length !== 2 || launcherCommands.some((command) => command !== selectedLauncher)) {
    findings.push(`real buildPinnedKernel owner selected ${JSON.stringify(launcherCommands)}, expected ${JSON.stringify(selectedLauncher)} for update and build`);
  }
  if (fs.readFileSync(githubPath, "utf8") !== decoy) {
    findings.push("real buildPinnedKernel owner read or changed the GITHUB_PATH handoff file");
  }
  if (rebuilt !== path.join(work, "pinned-source", "wasm-spike", "build-core", "seal.wasm")) {
    findings.push("real buildPinnedKernel owner did not finish the command-stubbed recipe");
  }
  return findings;
}

function checkPinnedLeanLauncher(root = ROOT) {
  const ownerFile = path.join(fs.realpathSync(root), "scripts", "seal-reproduce.cjs");
  const owner = require(ownerFile);
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "seal-launcher-check-"));
  try {
    return [
      ...exerciseOwner(owner, fixture),
      ...exerciseOwner(owner, fixture, path.join(fixture, "operator-lake")),
    ];
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
}

function main() {
  const findings = checkPinnedLeanLauncher(ROOT);
  if (findings.length > 0) {
    process.stderr.write("REFUSE pinned_lean_launcher: shipped rebuild owner depends on a later-step PATH update:\n");
    process.stderr.write(`${findings.join("\n")}\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write("PASS pinned_lean_launcher: shipped rebuild owner resolves installer launcher without GITHUB_PATH\n");
}

if (require.main === module) main();

module.exports = { checkPinnedLeanLauncher };
