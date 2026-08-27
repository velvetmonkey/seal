// SPDX-License-Identifier: Apache-2.0
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.join(__dirname, "..");
const SEAL = path.join(ROOT, "bin", "seal");

function runSeal(args) {
  try {
    return { code: 0, stdout: execFileSync(process.execPath, [SEAL, ...args], { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }), stderr: "" };
  } catch (error) {
    return { code: error.status, stdout: error.stdout || "", stderr: error.stderr || "" };
  }
}

test("the Protect and Remove sections identify Claude Code's retained home files", () => {
  const readme = fs.readFileSync(path.join(ROOT, "README.md"), "utf8");
  const protection = fs.readFileSync(path.join(ROOT, "spine", "protection.cjs"), "utf8");
  const prose = readme.replace(/\s+/g, " ");
  const retainedFiles = "Claude Code writes `~/.claude.json` and a backup under `~/.claude/backups/`. ";
  const noSealWrite = "Seal invokes Claude Code but writes neither file";
  const removal = ["Unprotect asks Claude Code to remove only Seal's local override", "It does not delete `~/.claude.json` or backups under `~/.claude/backups/`", "Those files remain until you or Claude Code remove them"].join(". ") + ".";

  assert.match(protection, /spawnSync\("claude", args/);
  assert.match(protection, /"mcp", "add", "--scope", "local", serverName/);
  assert.match(protection, /"mcp", "remove", "--scope", "local", serverName/);
  assert.ok(prose.includes(retainedFiles + noSealWrite + "."), "README must state that Seal invokes Claude Code but writes neither retained file");
  assert.ok(prose.includes(removal), "README must state that Unprotect leaves Claude Code's retained files in place");
});

test("the Protect section requires Claude Code and provides its availability check", () => {
  const readme = fs.readFileSync(path.join(ROOT, "README.md"), "utf8");
  const publishedVersion = readme.match(/^SEAL_VERSION=(v[^\s]+)$/m)?.[1];
  const protect = readme.slice(readme.indexOf("## Protect something real"), readme.indexOf("## Remove it"));

  assert.ok(protect.includes("First check that Claude Code is available:\n\n```bash\nclaude --version\n```"), "Protect must show the exact Claude Code availability command");
  assert.ok(publishedVersion, "README must name its published release");
  assert.ok(protect.includes(`With the published ${publishedVersion} CLI, protect one tool:`), "Protect must state its published-CLI scope");
});

test("the demo section names the printed directory as the cleanup target", () => {
  const readme = fs.readFileSync(path.join(ROOT, "README.md"), "utf8");
  const demo = readme.indexOf("## See it work");
  const protect = readme.indexOf("## Protect something real");
  const cleanupReminder = "When you are finished, remove the directory printed as `Demo directory: /absolute/path`.";

  assert.ok(demo >= 0, "README must contain the demo beat");
  assert.ok(protect > demo, "the Protect beat must follow the demo beat");
  assert.ok(readme.indexOf(cleanupReminder, demo) > demo, "the demo cleanup instruction must appear in the demo section");
  assert.ok(readme.indexOf(cleanupReminder, demo) < protect, "the demo cleanup instruction must precede Protect");
});

test("both conventional help flags print the bare-command help and succeed", () => {
  const bare = runSeal([]);
  assert.equal(bare.code, 0, bare.stderr);
  for (const flag of ["--help", "-h"]) {
    const result = runSeal([flag]);
    assert.equal(result.code, 0, `${flag}: ${result.stderr}`);
    assert.equal(result.stderr, "", `${flag} must not report an unknown command`);
    assert.equal(result.stdout, bare.stdout, `${flag} must print the standard help`);
  }
});
