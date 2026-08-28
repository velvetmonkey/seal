#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { LEAN_LAUNCHER_ENV, leanLauncher } = require("./seal-reproduce.cjs");

function checkPinnedLeanLauncher(resolve = leanLauncher) {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "seal-launcher-check-"));
  try {
    const home = path.join(fixture, "home");
    const emptyPath = path.join(fixture, "empty-path");
    const installer = path.join(fixture, "install_pinned_elan.py");
    const githubPath = path.join(fixture, "github-path");
    const installedDirectory = path.join(home, ".guard-elan", "installer-bin");
    const installedLauncher = path.join(installedDirectory, "lake");
    const decoy = `${path.join(fixture, "github-path-decoy")}\n`;
    fs.mkdirSync(installedDirectory, { recursive: true });
    fs.mkdirSync(emptyPath);
    fs.writeFileSync(installer, 'bin_directory = Path.home() / ".guard-elan" / "installer-bin"\n');
    fs.writeFileSync(installedLauncher, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    fs.writeFileSync(githubPath, decoy);

    const environment = { HOME: home, PATH: emptyPath, GITHUB_PATH: githubPath };
    const resolved = resolve(environment, installer);
    if (resolved !== installedLauncher) {
      return [`PATH has no lake and same-process resolution returned ${JSON.stringify(resolved)}, not installer executable ${JSON.stringify(installedLauncher)}`];
    }
    if (fs.readFileSync(githubPath, "utf8") !== decoy) {
      return ["launcher resolution read or changed the GITHUB_PATH handoff file"];
    }
    const override = path.join(fixture, "operator-lake");
    const overridden = resolve({ ...environment, [LEAN_LAUNCHER_ENV]: override }, installer);
    if (overridden !== override) {
      return [`${LEAN_LAUNCHER_ENV} did not override the installed launcher`];
    }
    return [];
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
}

function main() {
  const findings = checkPinnedLeanLauncher();
  if (findings.length > 0) {
    process.stderr.write("REFUSE pinned_lean_launcher: rebuild launcher depends on a later-step PATH update:\n");
    process.stderr.write(`${findings.join("\n")}\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write("PASS pinned_lean_launcher: same-process installer launcher resolves without GITHUB_PATH\n");
}

if (require.main === module) main();

module.exports = { checkPinnedLeanLauncher };
