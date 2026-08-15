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

test("the Protect and Remove instructions identify Claude Code's retained home files", () => {
  const readme = fs.readFileSync(path.join(ROOT, "README.md"), "utf8");
  const protection = fs.readFileSync(path.join(ROOT, "spine", "protection.cjs"), "utf8");

  assert.match(protection, /spawnSync\("claude", args/);
  assert.match(protection, /"mcp", "add", "--scope", "local", serverName/);
  assert.match(protection, /"mcp", "remove", "--scope", "local", serverName/);
  assert.match(readme, /Claude Code writes `~\/\.claude\.json` and a backup under `~\/\.claude\/backups\/`/);
  assert.match(readme, /Seal invokes Claude Code but does not write either file/);
  assert.match(readme, /does not delete Claude Code's `~\/\.claude\.json` or backups under `~\/\.claude\/backups\/`; those files remain/);
});

test("the first screen requires Claude Code for Protect and provides its availability check", () => {
  const readme = fs.readFileSync(path.join(ROOT, "README.md"), "utf8");
  const firstScreen = readme.slice(0, readme.indexOf("## 1. Install"));

  assert.match(firstScreen, /the `claude` command for Protect \(check with `claude --version`\)/);
});

test("the removal beat leaves the demo authority path fresh in the reader's memory", () => {
  const readme = fs.readFileSync(path.join(ROOT, "README.md"), "utf8");
  const remove = readme.indexOf("## 4. Remove");
  const limits = readme.indexOf("## What Seal covers, and what it does not");
  const pathReminder = "demo client -> Seal -> demo MCP server -> demo.mutate";

  assert.ok(remove >= 0, "README must contain the Remove beat");
  assert.ok(limits > remove, "limits must follow the Remove beat");
  assert.ok(readme.indexOf(pathReminder, remove) > remove, "the authority path must appear after Remove");
  assert.ok(readme.indexOf(pathReminder, remove) < limits, "the authority path must appear before the limits list");
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
