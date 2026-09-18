#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
"use strict";

// Stage A's source check only. A PASS here is not artifact correspondence.
// Retain the checkout and build transcript beside the evidence for inspection.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");

const THEOREMS = [
  "SealCore.guarded_allow_iff_live", "Kernels.safetyKernel",
  "Kernels.safety_verdict_allow_iff", "Host.composed_non_bypass",
  "Host.step_forward_non_bypass", "Ffi.safety_always_registered",
  "Host.commitInstsFor_wiring", "Ffi.stepImpl_spelled", "Host.dispatch_spelled",
];
const sha256 = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");

function run(command, args, cwd, env = process.env) {
  const result = spawnSync(command, args, { cwd, env, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  if (result.error || result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")}: ${result.error || result.stderr || result.stdout || result.signal}`);
  }
  return result.stdout.trim();
}

function git(root, ...args) { return run("git", args, root); }

function sourceIdentity(root) {
  if (git(root, "status", "--porcelain", "--untracked-files=all", "--", ".",
      ":(exclude).lake", ":(exclude)kernel-source/.lake")) {
    throw new Error(`source-check: dirty source/dependency: ${root}`);
  }
  const listing = run("git", ["ls-files", "--stage", "-z"], root);
  const entries = listing.split("\0").filter(Boolean).map((entry) => {
    const match = /^(\d+) ([a-f0-9]+) 0\t([\s\S]+)$/.exec(entry);
    if (!match || !["100644", "100755", "120000"].includes(match[1])) {
      throw new Error(`source-check: unsupported tracked entry: ${entry}`);
    }
    const [, mode, , name] = match;
    if (/\.(olean|ilean|olean\.private|olean\.server)$/.test(name)) {
      throw new Error(`source-check: tracked precompiled Lean input: ${name}`);
    }
    const file = path.join(root, name);
    const bytes = mode === "120000" ? Buffer.from(fs.readlinkSync(file)) : fs.readFileSync(file);
    return { name, mode, sha256: sha256(bytes) };
  });
  return {
    commit: git(root, "rev-parse", "HEAD"),
    git_tree: git(root, "rev-parse", "HEAD^{tree}"),
    sha256: sha256(JSON.stringify(entries)), entries,
  };
}

function rejectPrecompiled(root) {
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (entry.name === ".git") continue;
    const file = path.join(root, entry.name);
    if (entry.isDirectory()) rejectPrecompiled(file);
    else if (/\.olean(?:\.private|\.server)?$/.test(entry.name)) {
      throw new Error(`source-check: stale compiled input: ${file}`);
    }
  }
}

function checkProof({ sourceRoot, evidencePath }) {
  const evidence = {
    schema: "seal.authorization-source-proof/v1", scope: "source-only",
    result: "FAIL", theorems: THEOREMS, axiom_allowlist: ["propext", "Classical.choice", "Quot.sound"],
    residual_assumptions: ["Lean checker and toolchain", "compiler", "runtime", "IO"],
  };
  fs.mkdirSync(path.dirname(evidencePath), { recursive: true });
  try {
    const source = sourceIdentity(sourceRoot);
    const work = fs.mkdtempSync(path.join(path.dirname(evidencePath), "authorization-proof-"));
    evidence.work_root = work;
    const checkout = path.join(work, "source");
    // Clone committed bytes only; neither the source's build directory nor its
    // object hardlinks are inherited. Never run a caller's existing .olean files.
    run("git", ["clone", "--no-local", "--no-checkout", sourceRoot, checkout], work);
    git(checkout, "checkout", "--detach", source.commit);
    rejectPrecompiled(checkout);
    evidence.source = source;
    const toolchain = fs.readFileSync(path.join(checkout, "lean-toolchain"), "utf8").trim();
    if (!/^leanprover\/lean4:v\d+\.\d+\.\d+(?:-[\w.]+)?$/.test(toolchain)) {
      throw new Error(`source-check: unpinned toolchain: ${toolchain}`);
    }
    const env = { ...process.env, ELAN_TOOLCHAIN: toolchain, LEAN_PATH: "", LEAN_SRC_PATH: "" };
    evidence.toolchain = toolchain;
    evidence.lean_version = run("lean", ["--version"], checkout, env);
    evidence.lake_version = run("lake", ["--version"], checkout, env);
    const manifestPath = path.join(checkout, "lake-manifest.json");
    const manifestBytes = fs.readFileSync(manifestPath);
    const manifest = JSON.parse(manifestBytes);
    evidence.manifest_sha256 = sha256(manifestBytes);
    evidence.build_command = ["lake", "build", "AuthorizationCorrespondenceProof"];
    const transcript = path.join(work, "build.log");
    const fd = fs.openSync(transcript, "wx");
    let build;
    try {
      build = spawnSync("lake", ["build", "AuthorizationCorrespondenceProof"], {
        cwd: checkout, env, stdio: ["ignore", fd, fd],
      });
    } finally { fs.closeSync(fd); }
    evidence.transcript = { path: transcript, sha256: sha256(fs.readFileSync(transcript)) };
    evidence.build_exit = build.status;
    if (build.error || build.status !== 0) {
      throw new Error(`source-check: proof build failed: ${build.error || build.signal || build.status}; see ${transcript}`);
    }
    const log = fs.readFileSync(transcript, "utf8");
    for (const name of THEOREMS) {
      if (!log.includes(`correspondence proof: ${name}:`)) {
        throw new Error(`source-check: missing fresh axiom-check output for ${name}`);
      }
    }
    if (sourceIdentity(checkout).sha256 !== source.sha256 ||
        sha256(fs.readFileSync(manifestPath)) !== evidence.manifest_sha256) {
      throw new Error("source-check: build changed committed source or dependency manifest");
    }
    evidence.dependencies = manifest.packages.map((pkg) => {
      if (pkg.type === "path") {
        const local = path.resolve(checkout, pkg.dir);
        if (!local.startsWith(checkout + path.sep)) throw new Error("source-check: external path dependency");
        return { name: pkg.name, type: "path", path: pkg.dir, covered_by: source.sha256 };
      }
      if (pkg.type !== "git" || !/^[0-9a-f]{40}$/.test(pkg.rev)) {
        throw new Error(`source-check: unpinned dependency ${pkg.name}`);
      }
      const name = pkg.name.replace(/^«|»$/g, "");
      const root = path.join(checkout, manifest.packagesDir, name);
      const identity = sourceIdentity(root);
      if (identity.commit !== pkg.rev) throw new Error(`source-check: dependency revision mismatch: ${name}`);
      return { name, url: pkg.url, ...identity };
    });
    evidence.closure_sha256 = sha256(JSON.stringify({
      source: source.sha256, dependencies: evidence.dependencies,
      toolchain, lean_version: evidence.lean_version, lake_version: evidence.lake_version,
    }));
    evidence.result = "PASS";
  } catch (error) {
    evidence.failure = error.message;
  }
  fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2) + "\n");
  if (evidence.result !== "PASS") throw new Error(evidence.failure);
  return evidence;
}

if (require.main === module) {
  try {
    const { values } = require("node:util").parseArgs({ options: {
      "source-root": { type: "string" }, evidence: { type: "string" },
    } });
    if (!values["source-root"] || !values.evidence) throw new Error("required: --source-root --evidence");
    const evidence = checkProof({ sourceRoot: path.resolve(values["source-root"]), evidencePath: path.resolve(values.evidence) });
    console.log(`source-only proof check PASS: ${evidence.source.commit}`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { checkProof, THEOREMS };
