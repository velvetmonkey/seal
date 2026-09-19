// SPDX-License-Identifier: Apache-2.0
"use strict";
const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path");
const { spawnSync } = require("node:child_process");
const {
  compareCandidate,
} = require("./authorization-seam-differential.test.cjs");
const { runTraces } = require("./authorization-child-traces.cjs");
const MUTATIONS = [
  {
    id: "grant-retry-not-issued",
    file: "contract/kernel-authorization-worker.cjs",
    from: "cfg.guardTarget(request.issuedTool, request.issuedArgs)",
    to: "cfg.guardTarget(request.retryTool, request.retryArgs)",
    assertion: "altered retry arguments: raw-adapter-verdict",
  },
  {
    id: "grant-on-decline",
    file: "contract/kernel-authorization-worker.cjs",
    from: "request.accepted ? [issuedTarget] : []",
    to: "[issuedTarget]",
    assertion: "approval declined: raw-adapter-verdict",
  },
  {
    id: "rewrite-argument-before-decision",
    file: "contract/kernel-authorization-worker.cjs",
    from: "const request = JSON.parse(requestText);",
    to: "const request = JSON.parse(requestText); request.issuedArgs = request.retryArgs = {...request.retryArgs, correspondence_mutation: true};",
    assertion: "matching accepted retry: independent-issued-target",
  },
  {
    id: "decode-BLOCK-as-ALLOW",
    file: "contract/kernel-authorization-worker.cjs",
    from: "verdict: result.verdict,",
    to: 'verdict: result.verdict === "BLOCK" ? "ALLOW" : result.verdict,',
    assertion: "altered retry arguments: raw-adapter-verdict",
  },
  {
    id: "change-argument-after-ALLOW",
    file: "spine/proxy.cjs",
    from: "params: { name: tool, arguments: args },",
    to: "params: { name: tool, arguments: {...args, correspondence_mutation: true} },",
    assertion: "child-effects:accept-A",
    stage: "child",
  },
  {
    id: "forward-without-retry",
    file: "spine/proxy.cjs",
    from: "const decision = contract.begin({ tool: params.name, args: params.arguments, selection: matchedSelection });",
    to: 'child.stdin.write(JSON.stringify(frame) + "\\n"); const decision = contract.begin({ tool: params.name, args: params.arguments, selection: matchedSelection });',
    assertion: "child-effects:call-before-answer",
    stage: "child",
  },
  {
    id: "remove-consumed-state-check",
    file: "contract/contract.cjs",
    from: 'if (record.status === "consumed") return refuse(REFUSALS.ALREADY_CONSUMED, "this one-use approval has already been consumed");',
    to: "// Deliberate control: consumed-state refusal removed.",
    assertion: "contract:consumed-state-check",
    stage: "child",
  },
  {
    id: "load-checkout-not-candidate",
    assertion: "candidate-root: checkout loaded instead of candidate",
    stage: "root",
  },
];
function command(cmd, args, cwd, log) {
  const r = spawnSync(cmd, args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  fs.appendFileSync(
    log,
    `$ ${cmd} ${args.join(" ")}\n${r.stdout || ""}${r.stderr || ""}`,
  );
  if (r.error || r.status !== 0)
    throw new Error(
      `mutation setup failed: ${r.error || r.status}; see ${log}`,
    );
  return r.stdout;
}
function installMutant(sourceRoot, candidateRoot, dir, mutation) {
  const source = path.join(dir, "source"),
    log = path.join(dir, "setup.log");
  command(
    "git",
    ["clone", "--quiet", "--no-local", sourceRoot, source],
    dir,
    log,
  );
  const file = path.join(source, mutation.file),
    text = fs.readFileSync(file, "utf8");
  const at = text.indexOf(mutation.from);
  assert.ok(at >= 0, `mutation setup: missing anchor ${mutation.id}`);
  fs.writeFileSync(
    file,
    text.slice(0, at) + mutation.to + text.slice(at + mutation.from.length),
  );
  const platform = `${process.platform}-${process.arch}`,
    dist = path.join(dir, "dist");
  const args = [
    path.join(source, "scripts/build-dist.cjs"),
    "--platform",
    platform,
    "--out",
    dist,
  ];
  if (process.platform === "darwin")
    args.push(
      "--macos-helper",
      path.join(candidateRoot, "runtime/macos-process-start-witness"),
    );
  command(process.execPath, args, source, log);
  const [digest, bytes, asset] = fs
    .readFileSync(path.join(dist, "SHA256SUMS"), "utf8")
    .trim()
    .split(/\s+/);
  const prefix = path.join(dir, "prefix");
  command(
    path.join(dist, asset),
    ["--sha256", digest, "--bytes", bytes, "--prefix", prefix],
    dir,
    log,
  );
  const record = JSON.parse(
    fs.readFileSync(path.join(prefix, "lib/seal/install.json")),
  );
  return {
    root: path.join(prefix, record.store),
    artifact: path.join(dist, asset),
    sha256: digest,
    bytes: Number(bytes),
  };
}
async function runMutations({
  sourceRoot,
  candidateRoot,
  corpusPath,
  oracleAnswers,
  outputDir,
  mutationIds,
}) {
  const results = [];
  fs.mkdirSync(outputDir, { recursive: true });
  for (const mutation of MUTATIONS.filter(
    (m) => !mutationIds || mutationIds.includes(m.id),
  )) {
    const dir = fs.mkdtempSync(path.join(outputDir, mutation.id + "-"));
    let candidate,
      failure,
      setupComplete = false;
    try {
      candidate =
        mutation.stage === "root"
          ? { root: candidateRoot }
          : installMutant(sourceRoot, candidateRoot, dir, mutation);
      setupComplete = true;
      if (mutation.stage === "child")
        await runTraces({
          candidateRoot: candidate.root,
          outputDir: dir,
          corpusPath,
        });
      else
        await compareCandidate({
          candidateRoot:
            mutation.stage === "root" ? sourceRoot : candidate.root,
          expectedCandidateRoot: candidate.root,
          sourceRoot,
          corpusPath,
          oracleAnswers,
          outputDir: dir,
        });
    } catch (error) {
      failure = error;
    }
    // Only the named assertion counts. Startup, timeouts, missing dependencies
    // and integrity refusals are failures of this control, never semantic kills.
    const killed =
      setupComplete &&
      failure?.code === "ERR_ASSERTION" &&
      failure.message.includes(mutation.assertion);
    const record = {
      id: mutation.id,
      killed,
      required_assertion: mutation.assertion,
      actual_failure: failure?.message || "mutant passed",
      candidate,
    };
    results.push(record);
    fs.writeFileSync(
      path.join(dir, "mutation.json"),
      JSON.stringify(record, null, 2) + "\n",
    );
  }
  return results;
}
module.exports = { runMutations, MUTATIONS };
