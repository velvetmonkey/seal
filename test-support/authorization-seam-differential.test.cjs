// SPDX-License-Identifier: Apache-2.0
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const { createKernelAuthorizationAdapter } = require("../contract/kernel-authorization.cjs");

const ROOT = path.resolve(__dirname, "..");
const MODEL = path.join(ROOT, "test-support", "kernel-authorization-model.lean");
const LEAN_TOOLCHAIN = "Lean (version 4.28.0";
const FFI_SHA256 = "092b67ff2a17380c3b3f9ed560395443bc0b749a3ae3a42b3d9af1a8256fe0f3";
const LAKE_MANIFEST_SHA256 = "ad4d98ca35cde0598794e4c08509bc8b21e79cbab39151c9a65d9e1cb3821dc0";
const MCP_SEAL_REVISION = "316d74126b4cb164d501fea21738d6880469bcb4";

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function refuse(message) {
  throw new Error(`interpreted Lean unavailable: ${message}`);
}

function leanEnvironment() {
  const sourceRoot = process.env.SEAL_INTERPRETED_LEAN_ROOT;
  if (!sourceRoot) {
    refuse("set SEAL_INTERPRETED_LEAN_ROOT to the built pinned seal-host source tree");
  }
  const ffi = path.join(sourceRoot, "Ffi.lean");
  const manifest = path.join(sourceRoot, "lake-manifest.json");
  if (sha256(ffi) !== FFI_SHA256) refuse(`Ffi.lean is not pinned sha256 ${FFI_SHA256}`);
  if (sha256(manifest) !== LAKE_MANIFEST_SHA256) {
    refuse(`lake-manifest.json is not pinned sha256 ${LAKE_MANIFEST_SHA256}`);
  }
  const mcpSeal = path.join(sourceRoot, ".lake", "packages", "mcp-seal");
  const revision = spawnSync("git", ["-C", mcpSeal, "rev-parse", "HEAD"], { encoding: "utf8" });
  if (revision.status !== 0 || revision.stdout.trim() !== MCP_SEAL_REVISION) {
    refuse(`mcp-seal source is not pinned revision ${MCP_SEAL_REVISION}: ${(revision.stderr || revision.stdout).trim()}`);
  }
  const lean = process.env.SEAL_LEAN || "lean";
  const version = spawnSync(lean, ["--version"], { encoding: "utf8" });
  if (version.status !== 0 || !version.stdout.startsWith(LEAN_TOOLCHAIN)) {
    refuse(`need Lean 4.28.0 at ${JSON.stringify(lean)}: ${(version.stderr || version.stdout).trim()}`);
  }
  const libraryPaths = [path.join(sourceRoot, ".lake", "build", "lib", "lean")];
  const packages = path.join(sourceRoot, ".lake", "packages");
  for (const name of fs.readdirSync(packages)) {
    const library = path.join(packages, name, ".lake", "build", "lib", "lean");
    if (fs.existsSync(library)) libraryPaths.push(library);
  }
  for (const library of libraryPaths) {
    if (!fs.existsSync(library)) refuse(`compiled import directory is absent: ${library}`);
  }
  return { lean, sourceRoot, leanPath: libraryPaths.join(path.delimiter) };
}

async function scenarioData() {
  const cfg = await import(pathToFileURL(path.join(ROOT, "runtime", "kernel", "seal-config.js")).href);
  const retryTool = "demo.mutate";
  const retryArgs = { line: "seam differential" };
  const cases = [
    { name: "matching accepted retry", issuedTool: retryTool, issuedArgs: retryArgs, retryTool, retryArgs, accepted: true },
    { name: "altered retry arguments", issuedTool: retryTool, issuedArgs: { line: "issued value" }, retryTool, retryArgs, accepted: true },
    { name: "approval declined", issuedTool: retryTool, issuedArgs: retryArgs, retryTool, retryArgs, accepted: false },
    { name: "approval for another tool", issuedTool: "demo.other", issuedArgs: retryArgs, retryTool, retryArgs, accepted: true },
  ].map((input) => ({ ...input, epoch: 1, now: 1000 }));
  const config = {
    epoch: 1,
    safety: {
      approval: { control_file: "product-adapter", ttl_seconds: 120 },
      tools: [{ name: retryTool, mode: "guarded", match: { type: "always" }, target: [{ full_arguments: true }] }],
    },
    temporal: { policies: [] },
  };
  const steps = cases.map((input) => {
    const issuedTarget = cfg.guardTarget(input.issuedTool, input.issuedArgs);
    return cfg.buildStepInput({
      tool: input.retryTool,
      args: input.retryArgs,
      approvals: input.accepted ? [issuedTarget] : [],
      now: input.now,
    });
  });
  return { cfg, cases, config, steps };
}

function pathToFileURL(file) {
  return require("node:url").pathToFileURL(file);
}

function interpretedAnswers(t, config, steps, cfg) {
  const { lean, sourceRoot, leanPath } = leanEnvironment();
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "seal-authorization-seamdiff-"));
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  const payload = path.join(temporary, "payload.json");
  const corpus = path.join(temporary, "corpus.jsonl");
  const output = path.join(temporary, "model.jsonl");
  fs.writeFileSync(payload, JSON.stringify(config));
  fs.writeFileSync(corpus, steps.join("\n#REINIT\n") + "\n");
  const result = spawnSync(lean, [MODEL], {
    cwd: sourceRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      LEAN_PATH: leanPath,
      SEAL_SEAMDIFF_PAYLOAD: payload,
      SEAL_SEAMDIFF_CORPUS: corpus,
      SEAL_SEAMDIFF_OUTPUT: output,
    },
  });
  assert.equal(result.status, 0, `interpreted Lean exited ${result.status}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  const lines = fs.readFileSync(output, "utf8").trim().split("\n");
  assert.equal(lines.length, steps.length, `interpreted Lean returned ${lines.length} answers for ${steps.length} inputs`);
  return lines.map((raw) => {
    const verdict = cfg.parseVerdict(raw, "demo.mutate").verdict;
    return verdict === "DENY" ? "BLOCK" : verdict;
  });
}

test("interpreted Lean agrees with shipped WASM through the Node authorization adapter", async (t) => {
  const { cfg, cases, config, steps } = await scenarioData();
  const leanAnswers = interpretedAnswers(t, config, steps, cfg);
  const adapter = createKernelAuthorizationAdapter();
  for (const [index, input] of cases.entries()) {
    let wasmAnswer;
    try {
      wasmAnswer = adapter.authorize(input).verdict;
    } catch (error) {
      wasmAnswer = `ERROR ${error.code || error.name}: ${error.message}`;
    }
    if (leanAnswers[index] !== wasmAnswer) {
      throw new Error(
        `authorization differential disagreement for input ${JSON.stringify(input)}: ` +
        `interpreted Lean=${JSON.stringify(leanAnswers[index])}; ` +
        `shipped WASM via contract/kernel-authorization-worker.cjs=${JSON.stringify(wasmAnswer)}`,
      );
    }
  }
});
