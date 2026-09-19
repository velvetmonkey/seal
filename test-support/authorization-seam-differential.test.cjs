// SPDX-License-Identifier: Apache-2.0
"use strict";
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const argsOf = (effect) => (Object.hasOwn(effect, "args") ? effect.args : {});
const ROOT = path.resolve(__dirname, "..");
const sha256 = (file) =>
  crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
function candidateFile(root, relative) {
  const file = fs.realpathSync(path.join(root, relative));
  assert.ok(
    file.startsWith(root + path.sep),
    `candidate-root: ${relative} escaped candidate`,
  );
  assert.ok(fs.statSync(file).isFile(), `candidate-root: missing ${relative}`);
  return file;
}
function interpretedAnswers(sourceRoot, cases, outputDir) {
  const libraries = [
    path.join(sourceRoot, ".lake/build/lib/lean"),
    path.join(sourceRoot, "kernel-source/.lake/build/lib/lean"),
  ];
  for (const name of fs.readdirSync(path.join(sourceRoot, ".lake/packages"))) {
    const lib = path.join(
      sourceRoot,
      ".lake/packages",
      name,
      ".lake/build/lib/lean",
    );
    if (fs.existsSync(lib)) libraries.push(lib);
  }
  for (const lib of libraries)
    assert.ok(fs.existsSync(lib), `missing Lean import directory: ${lib}`);
  const corpus = path.join(outputDir, "oracle-input.jsonl"),
    output = path.join(outputDir, "oracle-output.jsonl");
  fs.writeFileSync(
    corpus,
    cases.map((c) => JSON.stringify(c)).join("\n") + "\n",
  );
  const env = {
    ...process.env,
    ELAN_TOOLCHAIN: fs
      .readFileSync(path.join(sourceRoot, "lean-toolchain"), "utf8")
      .trim(),
    LEAN_PATH: libraries.join(path.delimiter),
    SEAL_CORRESPONDENCE_LOGICAL: "1",
    SEAL_SEAMDIFF_CORPUS: corpus,
    SEAL_SEAMDIFF_OUTPUT: output,
  };
  const result = spawnSync(
    "lean",
    [path.join(ROOT, "test-support/kernel-authorization-model.lean")],
    { cwd: sourceRoot, env, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
  );
  fs.writeFileSync(
    path.join(outputDir, "oracle-execution.log"),
    (result.stdout || "") + (result.stderr || ""),
  );
  assert.equal(
    result.status,
    0,
    `oracle-execution: ${result.error || result.stderr || result.stdout}`,
  );
  const answers = fs
    .readFileSync(output, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.equal(answers.length, cases.length, "oracle-case-count");
  return answers;
}
async function compareCandidate({
  candidateRoot,
  sourceRoot,
  corpusPath,
  outputDir,
  oracleAnswers,
  expectedCandidateRoot,
}) {
  assert.ok(
    candidateRoot,
    "--candidate-root is required; no checkout fallback",
  );
  const root = fs.realpathSync(candidateRoot);
  if (expectedCandidateRoot)
    assert.equal(
      root,
      fs.realpathSync(expectedCandidateRoot),
      "candidate-root: checkout loaded instead of candidate",
    );
  fs.mkdirSync(outputDir, { recursive: true });
  const files = [
    "contract/kernel-authorization.cjs",
    "contract/kernel-authorization-worker.cjs",
    "runtime/kernel/seal-config.js",
    "runtime/kernel/runner.cjs",
    "runtime/kernel/kernel.js",
    "runtime/kernel/wasm/seal.js",
    "runtime/kernel/wasm/seal.wasm",
    "runtime-manifest.json",
  ];
  const components = Object.fromEntries(
    files.map((file) => [file, sha256(candidateFile(root, file))]),
  );
  const loaded = require(
    candidateFile(root, "contract/kernel-authorization.cjs"),
  );
  assert.equal(
    fs.realpathSync(loaded.DEFAULT_KERNEL_ROOT),
    path.join(root, "runtime/kernel"),
    "candidate-root: runtime root",
  );
  const cases = fs
    .readFileSync(corpusPath, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.ok(cases.length > 0, "empty corpus");
  assert.equal(
    new Set(cases.map((c) => c.id)).size,
    cases.length,
    "duplicate corpus IDs",
  );
  // Logical corpus only: no candidate encoder may produce the oracle input.
  const oracle = oracleAnswers || interpretedAnswers(sourceRoot, cases, outputDir);
  assert.equal(oracle.length, cases.length, "oracle-case-count");
  const adapter = loaded.createKernelAuthorizationAdapter();
  let allows = 0;
  const transcript = [];
  for (const [index, c] of cases.entries()) {
    const expected = oracle[index],
      label = (name) => `${c.id}: ${name}`;
    assert.equal(expected.id, c.id, label("oracle-id"));
    assert.equal(expected.profile_admitted, true, label("profile-admitted"));
    assert.equal(expected.guarded, true, label("guarded"));
    const issued = { tool: c.issued.tool, args: argsOf(c.issued) },
      retry = { tool: c.retry.tool, args: argsOf(c.retry) };
    assert.deepEqual(
      expected.classified_issue_effect,
      issued,
      label("independent-issued-effect"),
    );
    assert.deepEqual(
      expected.classified_retry_effect,
      retry,
      label("independent-retry-effect"),
    );
    const answer = adapter.authorize({
      issuedTool: issued.tool,
      issuedArgs: issued.args,
      retryTool: retry.tool,
      retryArgs: retry.args,
      accepted: c.accepted,
      epoch: 1,
      now: c.now,
    });
    const raw = JSON.parse(answer.raw);
    assert.equal(
      answer.verdict,
      expected.live_before ? "ALLOW" : "BLOCK",
      label("raw-adapter-verdict"),
    );
    assert.equal(
      answer.issued_target,
      expected.issued_target,
      label("independent-issued-target"),
    );
    assert.deepEqual(
      raw,
      JSON.parse(expected.model_raw),
      label("full-raw-decision"),
    );
    assert.equal(
      raw.route,
      expected.expected_route,
      label("independent-route"),
    );
    assert.equal(answer.verdict, c.expected, label("reviewed-corpus-verdict"));
    const audit = JSON.parse(raw.audit),
      safety = audit.certs.filter((cert) => cert.kernel === "safety");
    assert.equal(
      audit.verdict,
      expected.live_before ? "allow" : "deny",
      label("audit-verdict"),
    );
    assert.equal(safety.length, 1, label("nonempty-safety-certificate"));
    assert.match(
      safety[0].certHash,
      /^[0-9]+$/,
      label("safety-certificate-hash"),
    );
    assert.equal(
      safety[0].reason,
      expected.retry_target,
      label("independent-retry-target"),
    );
    assert.equal(safety[0].verdict, audit.verdict, label("safety-verdict"));
    if (answer.verdict === "ALLOW") allows++;
    transcript.push({
      id: c.id,
      raw: answer.raw,
      verdict: answer.verdict,
      issued_target: answer.issued_target,
    });
  }
  assert.ok(
    allows > 0,
    "positive-control: at least one accepted effect must ALLOW",
  );
  for (const [file, digest] of Object.entries(components))
    assert.equal(
      sha256(candidateFile(root, file)),
      digest,
      `candidate-root: changed during comparison: ${file}`,
    );
  const transcriptPath = path.join(outputDir, "candidate-raw.jsonl");
  fs.writeFileSync(
    transcriptPath,
    transcript.map((x) => JSON.stringify(x)).join("\n") + "\n",
  );
  return {
    result: "PASS",
    scope: "adapter-seam-only",
    case_count: cases.length,
    allow_count: allows,
    candidate_root: root,
    components,
    corpus_sha256: sha256(corpusPath),
    transcript: { path: transcriptPath, sha256: sha256(transcriptPath) },
    oracle,
  };
}
if (require.main === module) {
  (async () => {
    const { values } = require("node:util").parseArgs({
      options: {
        "candidate-root": { type: "string" },
        "source-root": { type: "string" },
        corpus: { type: "string" },
        evidence: { type: "string" },
      },
    });
    for (const name of ["candidate-root", "source-root", "corpus", "evidence"])
      assert.ok(values[name], `--${name} is required`);
    const result = await compareCandidate({
      candidateRoot: values["candidate-root"],
      sourceRoot: values["source-root"],
      corpusPath: values.corpus,
      outputDir: path.dirname(path.resolve(values.evidence)),
    });
    fs.writeFileSync(values.evidence, JSON.stringify(result, null, 2) + "\n");
    console.log(
      `adapter seam PASS: ${result.case_count} cases (${result.allow_count} ALLOW)`,
    );
  })().catch((error) => {
    console.error(error.stack);
    process.exitCode = 1;
  });
}
module.exports = { compareCandidate };
