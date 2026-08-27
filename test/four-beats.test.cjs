// SPDX-License-Identifier: Apache-2.0
//
// Step 4 — the four beats, as a stranger would run them.
//
// Read this file top to bottom. It is the acceptance test for:
//   install → demo (approval bounds the effect) → check the receipt
//   → protect one tool → unprotect (remove)
// from the INSTALLED linux-x64 artifact, not from this checkout.
//
// DONE-WHEN (roadmap step 4): the whole path runs on Linux x86-64 with
// no Docker, no Lean, no Python, no JSON editing, and no key ceremony.
// This test fails if any of those five is required to complete the path.
//
// What this file is allowed to use:
//   - node
//   - the artifact built by scripts/build-dist.cjs
//   - the published-style --sha256 pin of that artifact (a digest, not a key)
//   - a stand-in `claude` so `seal protect` can run without a live Claude
//     Code session (the product talks to `claude mcp`, not to Docker/Lean)
//
// The .mcp.json this test writes is a stand-in for the file a Claude
// project already has. The product never asks anyone to edit JSON.
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const test = require("node:test");

const ROOT = path.join(__dirname, "..");

// Match the repository's existing path.relative(ROOT, ...) convention used by
// output and inventory diagnostics: semantic command assertions must not
// depend on the checkout's absolute filesystem location.
function repositoryRelativeOutput(text) {
  // A sibling temporary directory can share ROOT's textual prefix without
  // being inside the checkout.
  return text.replaceAll(`${ROOT}${path.sep}`, `.${path.sep}`);
}

// A PATH that cannot see docker, lake, elan, or python even if they exist
// elsewhere on this machine. /usr/bin:/bin is enough for `sh` and `node`.
function strangerPath(extraBins) {
  return [...extraBins, "/usr/bin", "/bin"].join(path.delimiter);
}

function run(file, args, opts = {}) {
  const result = spawnSync(file, args, {
    encoding: "utf8",
    env: { ...process.env, ...(opts.env || {}) },
    cwd: opts.cwd,
  });
  return {
    code: result.status,
    out: `${result.stdout || ""}${result.stderr || ""}`,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
  };
}

function writeFakeClaude(binDir) {
  fs.mkdirSync(binDir, { recursive: true });
  fs.writeFileSync(path.join(binDir, "claude"), `#!/usr/bin/env node
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const cwd = process.cwd();
const home = process.env.HOME || cwd;
const args = process.argv.slice(2);
function key(name) {
  return crypto.createHash("sha256").update(cwd).digest("hex").slice(0, 16) + "-" + name + ".json";
}
function localPath(name) {
  const dir = path.join(home, ".claude-local");
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, key(name));
}
if (args[0] !== "mcp") process.exit(2);
if (args[1] === "get") {
  const name = args[2];
  if (fs.existsSync(localPath(name))) {
    console.log(name + ":\\n  Scope: Local config\\n  Type: stdio");
    process.exit(0);
  }
  try {
    if (JSON.parse(fs.readFileSync(path.join(cwd, ".mcp.json"), "utf8")).mcpServers[name]) {
      console.log(name + ":\\n  Scope: Project config\\n  Type: stdio");
      process.exit(0);
    }
  } catch {}
  process.exit(1);
}
if (args[1] === "add") {
  const name = args[4];
  const split = args.indexOf("--");
  fs.writeFileSync(localPath(name), JSON.stringify({ command: args[split + 1], args: args.slice(split + 2) }));
  process.exit(0);
}
if (args[1] === "remove") {
  try { fs.unlinkSync(localPath(args[4])); } catch {}
  process.exit(0);
}
process.exit(2);
`, { mode: 0o755 });
}

function assertNoForbiddenTool(command, args) {
  const text = repositoryRelativeOutput([command, ...args].join(" "));
  assert.doesNotMatch(text, /\bdocker\b/i, `path invoked docker: ${text}`);
  assert.doesNotMatch(text, /\blake\b/, `path invoked lake: ${text}`);
  assert.doesNotMatch(text, /\blean\b/i, `path invoked lean: ${text}`);
  assert.doesNotMatch(text, /\bpython[0-9.]*\b/i, `path invoked python: ${text}`);
  assert.doesNotMatch(text, /generateKeyPair|openssl/, `path invoked a key ceremony: ${text}`);
}

test("four beats from the installed artifact: install, demo, check, protect, unprotect", async () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "seal-four-beats-"));
  const distDir = path.join(work, "dist");
  const prefix = path.join(work, "prefix");
  const demoDir = path.join(work, "demo");
  const project = path.join(work, "project");
  const home = path.join(work, "home");
  const fakeBin = path.join(work, "fake-claude", "bin");
  fs.mkdirSync(project);
  fs.mkdirSync(home);
  writeFakeClaude(fakeBin);

  const buildPath = strangerPath([]);
  assertNoForbiddenTool(process.execPath, [path.join(ROOT, "scripts", "build-dist.cjs"), "--out", distDir]);
  const built = run(process.execPath, [path.join(ROOT, "scripts", "build-dist.cjs"), "--out", distDir], {
    env: { PATH: buildPath },
  });
  assert.equal(built.code, 0, built.out);

  const sums = fs.readFileSync(path.join(distDir, "SHA256SUMS"), "utf8").trim().split(/\s+/);
  const artifact = path.join(distDir, sums[2]);
  const digest = sums[0];
  const bytes = sums[1];
  assert.equal(digest, crypto.createHash("sha256").update(fs.readFileSync(artifact)).digest("hex"));

  // INSTALL — hash pin, not a signing key.
  assertNoForbiddenTool(artifact, ["--sha256", digest, "--bytes", bytes, "--prefix", prefix]);
  const installed = run(artifact, ["--sha256", digest, "--bytes", bytes, "--prefix", prefix], {
    env: { PATH: strangerPath([]) },
  });
  assert.equal(installed.code, 0, installed.out);
  const seal = path.join(prefix, "bin", "seal");
  assert.ok(fs.existsSync(seal));

  const runEnv = {
    PATH: strangerPath([path.dirname(seal), fakeBin]),
    HOME: home,
    XDG_DATA_HOME: path.join(home, ".local", "share"),
  };
  assert.doesNotMatch(runEnv.PATH, /elan|cargo|\.local\/bin/i);

  // DEMO — observe one effect and refusal of the approval replay.
  assertNoForbiddenTool(process.execPath, [seal, "demo", "--dir", demoDir]);
  const demo = spawn(process.execPath, [seal, "demo", "--dir", demoDir], {
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, ...runEnv },
  });
  let demoOut = "";
  demo.stdout.on("data", (chunk) => {
    demoOut += chunk;
    if (/Approve\? \[y\/N\]/.test(demoOut)) demo.stdin.write("y\n");
  });
  const demoCode = await new Promise((resolve) => demo.once("close", resolve));
  assert.equal(demoCode, 0, demoOut);
  assert.match(demoOut, /File changed: yes/);
  assert.match(demoOut, /Protected-server call count: still 1/);
  assert.match(demoOut, /New Seal decisions: 0/);

  // CHECK — the installed v2 judge replays the receipt with the supplied key.
  const record = JSON.parse(fs.readFileSync(path.join(prefix, "lib", "seal", "install.json"), "utf8"));
  const store = path.join(prefix, record.store);
  const checker = path.join(store, "checker", "seal-receipt-v2.mjs");
  assert.equal(fs.existsSync(checker), true, "v2 checker must be inside the installed payload");
  const allow = fs.readdirSync(path.join(demoDir, "receipts")).find((name) => name.includes("-ALLOW.json"));
  assert.ok(allow, demoOut);
  const pubkey = path.join(demoDir, "receipt-signer.pub");
  const pubkeyHex = fs.readFileSync(pubkey, "utf8").trim();
  assertNoForbiddenTool(process.execPath, [checker, path.join(demoDir, "receipts", allow), "--pubkey", pubkeyHex]);
  const checked = run(process.execPath, [checker, path.join(demoDir, "receipts", allow), "--pubkey", pubkeyHex], {
    env: { PATH: strangerPath([]) },
    cwd: work,
  });
  assert.equal(checked.code, 0, checked.out);
  assert.match(checked.stdout, /Kernel decision          REPRODUCED/);

  // PROTECT / UNPROTECT — product reads the project's existing .mcp.json.
  // This file is a fixture for "a Claude project already has a server".
  // The stranger does not author or edit it as a Seal step.
  const mcpPath = path.join(project, ".mcp.json");
  const before = `${JSON.stringify({
    mcpServers: { db: { command: process.execPath, args: [seal, "__demo-server", path.join(work, "data.txt")] } },
  }, null, 2)}\n`;
  fs.writeFileSync(mcpPath, before);
  const beforeHash = crypto.createHash("sha256").update(before).digest("hex");

  assertNoForbiddenTool(process.execPath, [seal, "protect", "db", "demo.mutate"]);
  const protectedRun = run(process.execPath, [seal, "protect", "db", "demo.mutate"], {
    cwd: project,
    env: runEnv,
  });
  assert.equal(protectedRun.code, 0, protectedRun.out);
  assert.match(protectedRun.stdout, /PENDING RESTART/);
  assert.equal(crypto.createHash("sha256").update(fs.readFileSync(mcpPath)).digest("hex"), beforeHash);

  assertNoForbiddenTool(process.execPath, [seal, "unprotect", "db"]);
  const removed = run(process.execPath, [seal, "unprotect", "db"], {
    cwd: project,
    env: runEnv,
  });
  assert.equal(removed.code, 0, removed.out);
  assert.match(removed.stdout, /outside Seal/);
  assert.equal(fs.readFileSync(mcpPath, "utf8"), before, "unprotect must not require or perform JSON editing of .mcp.json");

  // The installed product tree does not call Docker, Lean, or Python.
  for (const rel of ["bin/seal", "scripts/seal-launch.cjs", "scripts/install.cjs", "spine/demo.cjs", "spine/protection.cjs"]) {
    const full = path.join(store, rel);
    if (!fs.existsSync(full)) continue;
    const src = fs.readFileSync(full, "utf8");
    assert.doesNotMatch(src, /\bdocker\b/i, `${rel} references docker`);
    assert.doesNotMatch(src, /\blake exe\b/, `${rel} references lake`);
    assert.doesNotMatch(src, /\bpython[0-9.]*\b/i, `${rel} references python`);
  }
});
