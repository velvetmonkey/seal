#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const TAG = "v0.2.0";

function isExecutableFile(file) {
  try {
    if (!fs.statSync(file).isFile()) return false;
    fs.accessSync(file, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function exerciseOwner(owner, fixture, override) {
  const flavor = override ? (path.dirname(override) === "." ? "bare-override" : "path-override") : "installed";
  const work = path.join(fixture, `${flavor}-work`);
  const home = path.join(fixture, `${flavor}-home`);
  const emptyPath = path.join(fixture, `${flavor}-empty-path`);
  const githubPath = path.join(fixture, `${flavor}-github-path`);
  const installedDirectory = path.join(home, ".guard-elan", "installer-bin");
  const installedLauncher = path.join(installedDirectory, "lake");
  const selectedLauncher = override || installedLauncher;
  const selectedDirectory = path.dirname(selectedLauncher) === "." ? null : path.dirname(selectedLauncher);
  const decoy = `${path.join(fixture, "github-path-decoy")}\n`;
  const launcherCommands = [];
  const postInstallerCalls = [];
  let installerReturned = false;
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
    child(command, args, options = {}) {
      if (command === "python3") {
        fs.writeFileSync(args[0], 'bin_directory = Path.home() / ".guard-elan" / "installer-bin"\n');
        fs.mkdirSync(installedDirectory, { recursive: true });
        fs.writeFileSync(installedLauncher, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
        fs.writeFileSync(path.join(installedDirectory, "lean"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
        if (selectedDirectory && selectedDirectory !== installedDirectory) {
          fs.mkdirSync(selectedDirectory, { recursive: true });
          fs.writeFileSync(selectedLauncher, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
          fs.writeFileSync(path.join(selectedDirectory, "lean"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
        } else if (!selectedDirectory) {
          fs.writeFileSync(path.join(emptyPath, selectedLauncher), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
          fs.writeFileSync(path.join(emptyPath, "lean"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
        }
        installerReturned = true;
      } else if (installerReturned) {
        postInstallerCalls.push({ command, options });
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
  if (postInstallerCalls.length !== 8) {
    findings.push(`real buildPinnedKernel owner passed ${postInstallerCalls.length} post-installer children to the guard, expected 8`);
  }
  for (const { command, options } of postInstallerCalls) {
    const receivedPath = options.env?.PATH;
    const pathEntries = typeof receivedPath === "string" ? receivedPath.split(path.delimiter) : [];
    if (selectedDirectory && pathEntries[0] !== selectedDirectory) {
      findings.push(`${command} did not receive launcher directory ${JSON.stringify(selectedDirectory)} first on PATH`);
    }
    if (!selectedDirectory && receivedPath !== environment.PATH) {
      findings.push(`${command} changed PATH for bare launcher ${JSON.stringify(selectedLauncher)}`);
    }
    if (!pathEntries.some((entry) => isExecutableFile(path.join(entry, "lean")))) {
      findings.push(`${command} received a PATH that cannot find the selected Lean toolchain`);
    }
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
      ...exerciseOwner(owner, fixture, "lake"),
    ];
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
}

function main() {
  const findings = checkPinnedLeanLauncher(ROOT);
  if (findings.length > 0) {
    process.stderr.write("REFUSE pinned_lean_launcher: shipped rebuild owner does not pass a usable Lean toolchain PATH to every post-installer child:\n");
    process.stderr.write(`${findings.join("\n")}\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write("PASS pinned_lean_launcher: shipped rebuild owner resolves the installer launcher and passes its toolchain PATH without GITHUB_PATH\n");
}

if (require.main === module) main();

module.exports = { checkPinnedLeanLauncher };
