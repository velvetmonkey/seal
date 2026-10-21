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
  const readme = fs.readFileSync(path.join(ROOT, "docs", "guide", "choosing-what-to-protect.md"), "utf8");
  const protection = fs.readFileSync(path.join(ROOT, "spine", "protection.cjs"), "utf8");
  const prose = readme.replace(/\s+/g, " ");
  const retainedFiles = "Claude Code writes `~/.claude.json` and a backup under `~/.claude/backups/`. ";
  const noSealWrite = "Seal invokes Claude Code but writes neither file";
  const removal = ["Unprotect asks Claude Code to remove only Seal's local override", "It does not delete `~/.claude.json` or backups under `~/.claude/backups/`", "Those files remain until you or Claude Code remove them"].join(". ") + ".";

  assert.match(protection, /spawnSync\(command, args/);
  assert.match(protection, /function runClaude\(args, env = process.env, cwd = process.cwd\(\), command = "claude"\)/);
  assert.match(protection, /const claude = identifyClaude\(env, root\)/);
  assert.match(protection, /"mcp", "add", "--scope", "local", serverName/);
  assert.match(protection, /"mcp", "remove", "--scope", "local", serverName/);
  assert.ok(prose.includes(retainedFiles + noSealWrite + "."), "protection guide must state that Seal invokes Claude Code but writes neither retained file");
  assert.ok(prose.includes(removal), "protection guide must state that Unprotect leaves Claude Code's retained files in place");
});

test("the Protect section requires Claude Code and provides its availability check", () => {
  const readme = fs.readFileSync(path.join(ROOT, "README.md"), "utf8");
  const publishedVersion = readme.match(/^SEAL_VERSION=(v[^\s]+)$/m)?.[1];
  const protect = readme.slice(readme.indexOf("## Protect a real tool set"), readme.indexOf("## Remove it"));

  assert.match(protect, /```bash[\s\S]*?claude --version[\s\S]*?```/, "Protect must show the exact Claude Code availability command");
  assert.ok(publishedVersion, "README must name its published release");
  assert.ok(protect.includes("seal protect db demo.mutate demo.erase"), "Protect must show the named-set command");
});

test("the Protect section sets the signed kernel policy before seal protect", () => {
  const readme = fs.readFileSync(path.join(ROOT, "README.md"), "utf8");
  const protect = readme.slice(readme.indexOf("## Protect a real tool set"), readme.indexOf("## Remove it"));
  const command = protect.search(/^seal protect db\b/m);

  assert.ok(command >= 0, "Protect section must contain the seal protect db command");
  const before = protect.slice(0, command);
  for (const token of ["SEAL_KERNEL_POLICY_FILE", "SEAL_KERNEL_PUBKEY"]) {
    assert.ok(before.includes(token), `Protect section must set ${token} before seal protect db`);
  }
  assert.ok(before.includes("](docs/assurance/architecture.md)"), "Protect section must link docs/assurance/architecture.md before seal protect db");
});

test("the demo section names the printed directory as the cleanup target", () => {
  const readme = fs.readFileSync(path.join(ROOT, "README.md"), "utf8");
  const demo = readme.indexOf("## Try Seal in two minutes");
  const protect = readme.indexOf("## Protect a real tool set");
  const cleanupReminder = "When you are finished, use the printed `Recover this run directory with:` command to remove the temporary demo directory.";

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

test("the assurance index names v1.0.0-rc.1 notes as the prerelease, not v0.4.0 as a candidate", () => {
  const page = fs.readFileSync(path.join(ROOT, "docs", "assurance", "index.html"), "utf8");
  assert.ok(page.includes('<a href="RELEASE-NOTES-v1.0.0-rc.1.md">v1.0.0-rc.1 prerelease notes</a>'), "assurance index must name v1.0.0-rc.1 prerelease notes");
  assert.doesNotMatch(page, /Candidate v0\.4\.0/, "assurance index must not name Candidate v0.4.0");
});

test("the v0.4.0 checker notice names the published releases that carry the exit fix", () => {
  const page = fs.readFileSync(path.join(ROOT, "docs", "verify", "README.md"), "utf8");
  const start = page.indexOf("## v0.4.0 standalone checker exit status");
  const end = page.indexOf("## One receipt, or a broader review", start);
  assert.ok(start >= 0 && end > start, "verify README must contain the v0.4.0 checker notice");
  const section = page.slice(start, end).replace(/\s+/g, " ");
  const sentence = "The published v0.5.1, v0.5.2 and v0.5.3 releases and the v1.0.0-rc.1 prerelease carry this fix: their standalone checker exits 1 in the deleted-signature and no-key cases.";
  assert.ok(section.includes(sentence), "v0.4.0 checker notice must name the published v0.5.1, v0.5.2, v0.5.3 and v1.0.0-rc.1 releases with the exit fix");
});

test("the demo section says the --dir form prints no Recover line", () => {
  const readme = fs.readFileSync(path.join(ROOT, "README.md"), "utf8");
  const start = readme.indexOf('seal demo --dir "$demo_dir"');
  const end = readme.indexOf("## What you should see", start);
  assert.ok(start >= 0 && end > start, "README must contain the --dir demo section");
  const section = readme.slice(start, end);
  assert.ok(section.includes("The `--dir` form above prints no `Recover this run directory with:` line."), "--dir demo must state that it prints no Recover this run directory with: line");
});

test("each Protect guide page sets the signed kernel policy before its first seal protect command", () => {
  for (const relative of ["docs/guide/choosing-what-to-protect.md", "docs/reference/multi-tool-semantics.md"]) {
    const page = fs.readFileSync(path.join(ROOT, relative), "utf8");
    const command = page.search(/\bseal protect [a-z][\w.-]* [a-z][\w.-]*/);
    assert.ok(command >= 0, `${relative} must contain a seal protect command`);
    const before = page.slice(0, command);
    for (const token of ["SEAL_KERNEL_POLICY_FILE", "SEAL_KERNEL_PUBKEY", "](../assurance/architecture.md)"]) {
      assert.ok(before.includes(token), `${relative} must name ${token} before its first seal protect command`);
    }
  }
});
