#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
//
// Drive the whole acceptance harness with the SCRIPTED STAND-IN client, with
// no human and no Claude Code, and write a pack that is marked synthetic in
// four independent places.
//
// Why this exists: an instrument nobody has driven end to end is not an
// instrument. This run exercises the real installed artifact, the real
// `seal protect`, the real proxy, the real approval contract and the real
// fixture — everything except the one thing the acceptance run is about, the
// client. What it produces is therefore evidence ABOUT THE HARNESS, and the
// checker refuses it for any release.
//
//   node harness/claude-code/synthetic-run.cjs --run-dir DIR [--out DIR]
//                                              [--artifact FILE --sha256 HEX --bytes N]
//
// With no artifact given it builds one from this checkout.
const fs = require("node:fs");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");

const harness = require("./cc-harness.cjs");

const ROOT = path.resolve(__dirname, "..", "..");
const SCENARIOS = {
  activation: { case: "activation", note: harness.NOTES.accept },
  decline: { case: "decline", note: harness.NOTES.decline },
  accept: { case: "accept", note: harness.NOTES.accept },
  missing_launcher: { case: "missing_launcher", note: harness.NOTES.fallback },
};

function parse(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (!flag.startsWith("--")) throw new Error(`unexpected argument ${flag}`);
    options[flag.slice(2)] = argv[index + 1];
    index += 1;
  }
  return options;
}

function buildArtifact(inputsDir) {
  const outDir = path.join(inputsDir, "dist");
  const built = spawnSync(process.execPath, [path.join(ROOT, "scripts", "build-dist.cjs"), "--out", outDir], { encoding: "utf8" });
  if (built.status !== 0) throw new Error(`build-dist failed: ${built.stderr || built.stdout}`);
  const meta = JSON.parse(fs.readFileSync(fs.readdirSync(outDir)
    .filter((name) => name.endsWith(".meta.json"))
    .map((name) => path.join(outDir, name))[0], "utf8"));
  return { artifact: path.join(outDir, meta.artifact), sha256: meta.sha256, bytes: String(meta.bytes) };
}

async function waitForFixtureReadiness(inputsDir) {
  const readyPath = path.join(inputsDir, "fixture-ready");
  const logPath = path.join(inputsDir, "fixture-readiness.jsonl");
  const effectPath = path.join(inputsDir, "fixture-readiness-effect");
  const probeEnv = { ...process.env, SEAL_CC_FIXTURE_LOG: logPath, SEAL_CC_FIXTURE_EFFECT: effectPath, SEAL_CC_FIXTURE_READY_FILE: readyPath };
  delete probeEnv.SEAL_CC_FIXTURE_FAIL_INITIALIZE;
  const child = spawn(process.execPath, [path.join(__dirname, "fixture-server.cjs")], {
    cwd: ROOT,
    env: probeEnv,
    stdio: ["ignore", "ignore", "pipe"],
  });
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  const started = Date.now();
  try {
    while (!fs.existsSync(readyPath)) {
      if (child.exitCode !== null) throw new Error(`fixture readiness probe exited ${child.exitCode}: ${stderr.trim()}`);
      if (Date.now() - started >= 30000) throw new Error(`fixture readiness probe timed out after 30000ms: ${stderr.trim()}`);
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  } finally {
    if (child.exitCode === null) child.kill("SIGTERM");
    await new Promise((resolve) => {
      if (child.exitCode !== null) return resolve();
      child.once("exit", resolve);
      setTimeout(() => { if (child.exitCode === null) child.kill("SIGKILL"); }, 2000);
    });
  }
}

async function main(argv) {
  const options = parse(argv);
  if (!options["run-dir"]) throw new Error("synthetic-run needs --run-dir DIR");
  const runDir = path.resolve(options["run-dir"]);
  // The run directory must be empty when the harness opens it, so the run's
  // inputs — the artifact and the stand-in client — live beside it.
  const inputsDir = path.join(path.dirname(runDir), `${path.basename(runDir)}-inputs`);
  fs.mkdirSync(inputsDir, { recursive: true });

  const pinned = options.artifact
    ? { artifact: path.resolve(options.artifact), sha256: options.sha256, bytes: options.bytes }
    : buildArtifact(inputsDir);

  // The stand-in is installed under the name the product looks for, so the
  // recorded process ancestry names it exactly as the real client would be
  // named — and the pack's client version says `synthetic-stand-in`.
  const stubBin = path.join(inputsDir, "stub-bin");
  fs.mkdirSync(stubBin, { recursive: true });
  const stubPath = path.join(stubBin, "claude");
  fs.copyFileSync(path.join(__dirname, "synthetic-client.cjs"), stubPath);
  fs.chmodSync(stubPath, 0o755);

  await waitForFixtureReadiness(inputsDir);

  harness.init([
    "--artifact", pinned.artifact,
    "--sha256", pinned.sha256,
    "--bytes", String(pinned.bytes),
    "--run-dir", runDir,
    "--stub-bin", stubBin,
    "--synthetic-client",
    "--client-command", stubPath,
  ]);

  for (const name of ["activation", "decline", "accept", "missing_launcher", "unprotect", "finish"]) {
    const scenario = SCENARIOS[name];
    process.env.SEAL_CC_SYNTHETIC_CASE = scenario ? scenario.case : "none";
    process.env.SEAL_CC_SYNTHETIC_NOTE = scenario ? scenario.note : "";
    const state = harness.loadState(runDir);
    if (name === "finish" && options.out) {
      harness.finish(state, { out: path.resolve(options.out) });
      state.step_index += 1;
      harness.saveState(state);
      continue;
    }
    harness.next(state);
  }
  return path.join(options.out ? path.resolve(options.out) : path.join(runDir, "pack"), "evidence", "claude-code");
}

if (require.main === module) {
  Promise.resolve().then(() => main(process.argv.slice(2))).then((written) => {
    process.stdout.write(`\nSYNTHETIC pack root: ${written}\n`);
  }).catch((error) => {
    if (error instanceof harness.HarnessError) {
      process.stderr.write(`REFUSE ${error.code}: ${error.message}\n`);
      process.exit(1);
    }
    process.stderr.write(`synthetic-run failed: ${error.stack}\n`);
    process.exit(1);
  });
}

module.exports = { main };
