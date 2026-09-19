#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
"use strict";
const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path"),
  crypto = require("node:crypto");
const { verifyTranscript, ENCODING } = require("./authorization-transcript.cjs");
const { unpackPayload } = require("../spine/integrity.cjs");
const { checkProof } = require("./authorization-proof-check.cjs");
const {
  compareCandidate,
} = require("./authorization-seam-differential.test.cjs");
const { runTraces } = require("./authorization-child-traces.cjs");
const {
  runMutations,
  MUTATIONS,
} = require("./authorization-mutation-controls.cjs");
const hash = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
function artifactBinding(candidateRoot, artifact) {
  const root = fs.realpathSync(candidateRoot),
    bytes = fs.readFileSync(artifact),
    marker = Buffer.from("\n// --SEAL-PAYLOAD--\n"),
    at = bytes.indexOf(marker);
  assert.ok(at >= 0, "artifact-binding: missing payload");
  const payload = unpackPayload(bytes.subarray(at + marker.length));
  assert.equal(
    payload.manifest.platform,
    `${process.platform}-${process.arch}`,
    "artifact-binding: unsupported platform",
  );
  const actual = [];
  function walk(dir, prefix = "") {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const relative = prefix + entry.name,
        full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full, relative + "/");
      else {
        assert.ok(entry.isFile(), `artifact-binding: nonregular ${relative}`);
        actual.push(relative);
      }
    }
  }
  walk(root);
  assert.deepEqual(
    actual.sort(),
    payload.files.map((f) => f.path).sort(),
    "artifact-binding: complete installed payload",
  );
  for (const file of payload.files) {
    assert.ok(
      !file.path.split("/").includes("..") && !path.isAbsolute(file.path),
      "artifact-binding: invalid path",
    );
    assert.equal(
      hash(fs.readFileSync(path.join(root, file.path))),
      file.sha256,
      `artifact-binding: ${file.path}`,
    );
  }
  return {
    filename: path.basename(artifact),
    sha256: hash(bytes),
    bytes: bytes.length,
    platform: payload.manifest.platform,
    installed_tree_sha256: payload.manifest.treeSha256,
    wasm_sha256: payload.files.find(
      (f) => f.path === "runtime/kernel/wasm/seal.wasm",
    ).sha256,
  };
}
async function correspondence(options) {
  const outputDir = path.dirname(path.resolve(options.evidence));
  fs.mkdirSync(outputDir, { recursive: true });
  const evidence = {
    schema: "seal.authorization-correspondence/v2",
    encoding: ENCODING,
    scope: "source-model-wasm-child-finite-corpus",
    authority: "same-authority",
    result: "FAIL",
    release_eligible: false,
    stages: { proof: { result: "NOT_RUN" }, adapter: { result: "NOT_RUN" }, child: { result: "NOT_RUN" } },
    mutations: [],
    residual_assumptions: [
      "guarded correspondence is claimed only for tools in runtime/observation-guard.json",
      "residual:unguarded-forward",
      "residual:wall-clock-not-in-ninth",
      "compilation/runtime/IO/crypto",
      "operator lists other than the pack",
      "harness dialect rather than a third-party client",
      "human-present unknown",
      "compiler correctness",
      "runtime",
      "opaque IO",
      "hash collision resistance",
      "human approval provenance",
      "uncontrolled routes and complete mediation",
      "Node lifecycle beyond the retained traces",
    ],
  };
  const save = () =>
    fs.writeFileSync(
      options.evidence,
      JSON.stringify(evidence, null, 2) + "\n",
    );
  try {
    evidence.artifact = artifactBinding(
      options.candidateRoot,
      options.artifact,
    );
    fs.copyFileSync(options.corpus, path.join(outputDir, "corpus.jsonl"));
    save();
    evidence.stages.proof = { result: "RUNNING" };
    save();
    const proof = checkProof({
      sourceRoot: path.resolve(options.sourceRoot),
      evidencePath: path.join(outputDir, "source-proof.json"),
    });
    evidence.source_commit = proof.source.commit;
    evidence.source_closure_sha256 = proof.closure_sha256;
    evidence.stages.proof = {
      result: proof.result,
      evidence: "source-proof.json",
    };
    save();
    const source = path.join(proof.work_root, "source");
    evidence.corpus = {
      sha256: hash(fs.readFileSync(options.corpus)),
      finite: true,
      seed: null,
    };
    // The source proof's clean checkout also owns the interpreted oracle code.
    assert.equal(
      hash(
        fs.readFileSync(
          path.join(source, "test-support/kernel-authorization-model.lean"),
        ),
      ),
      hash(
        fs.readFileSync(
          path.join(__dirname, "kernel-authorization-model.lean"),
        ),
      ),
      "source-binding: oracle program",
    );
    evidence.stages.adapter = { result: "RUNNING" };
    save();
    const adapter = await compareCandidate({
      candidateRoot: options.candidateRoot,
      expectedCandidateRoot: options.candidateRoot,
      sourceRoot: source,
      corpusPath: options.corpus,
      outputDir: path.join(outputDir, "adapter"),
    });
    evidence.stages.adapter = adapter;
    save();
    evidence.stages.child = { result: "RUNNING" };
    save();
    evidence.stages.child = await runTraces({
      candidateRoot: options.candidateRoot,
      outputDir: path.join(outputDir, "child"),
      corpusPath: options.corpus,
    });
    save();
    evidence.mutations = await runMutations({
      sourceRoot: source,
      candidateRoot: options.candidateRoot,
      corpusPath: options.corpus,
      oracleAnswers: adapter.oracle,
      outputDir: path.join(outputDir, "mutations"),
    });
    save();
    assert.deepEqual(
      evidence.mutations.map((m) => m.id),
      MUTATIONS.map((m) => m.id),
      "mutation-roster",
    );
    assert.ok(
      evidence.mutations.every((m) => m.killed),
      "all-eight-semantic-controls",
    );
    assert.deepEqual(
      artifactBinding(options.candidateRoot, options.artifact),
      evidence.artifact,
      "artifact-binding: changed during run",
    );
    if (options.rebuiltWasm) {
      const digest = hash(fs.readFileSync(options.rebuiltWasm));
      assert.equal(
        digest,
        evidence.artifact.wasm_sha256,
        "fresh-kernel-rebuild",
      );
      evidence.kernel_rebuild = { sha256: digest, path: options.rebuiltWasm };
      evidence.wasm_rebuilt_sha256 = digest;
      evidence.installed_tree_sha256 = evidence.artifact.installed_tree_sha256;
      evidence.observation_guard_sha256 = evidence.stages.child.observation_guard_sha256;
      // A v1 stage PASS is never a v2 release PASS. The joined bytes, rather
      // than stage booleans, are a mandatory precondition for eligibility.
      verifyTranscript(evidence, evidence.stages.child.observation_pack);
      assert.ok(evidence.definiens_digest && evidence.ffi_export_map,
        "release-binding:missing-definiens-and-export-map");
      assert.ok(evidence.additional_mutations?.length >= 3,
        "release-binding:missing-live-mutations");
      evidence.release_eligible = true;
    }
    const transcriptFiles = [
      path.join(outputDir, "adapter/oracle-input.jsonl"),
      path.join(outputDir, "adapter/oracle-output.jsonl"),
      adapter.transcript.path,
      evidence.stages.child.effect_file,
      evidence.stages.child.process_transcript,
      ...evidence.stages.child.checks
        .filter((c) => c.effect_file)
        .map((c) => c.effect_file),
    ];
    evidence.transcripts = transcriptFiles.map((file) => ({
      path: file,
      sha256: hash(fs.readFileSync(file)),
      bytes: fs.statSync(file).size,
    }));
    evidence.result = "PASS";
    save();
    return evidence;
  } catch (error) {
    for (const stage of Object.values(evidence.stages)) {
      if (stage.result === "RUNNING") {
        stage.result = "FAIL";
        stage.failure = error.message;
      }
    }
    evidence.failure = error.message;
    save();
    throw error;
  }
}
module.exports = { correspondence, artifactBinding };
if (require.main === module) {
  (async () => {
    const { values } = require("node:util").parseArgs({
      options: {
        "candidate-root": { type: "string" },
        artifact: { type: "string" },
        "source-root": { type: "string" },
        corpus: { type: "string" },
        evidence: { type: "string" },
        "rebuilt-wasm": { type: "string" },
      },
    });
    for (const key of [
      "candidate-root",
      "artifact",
      "source-root",
      "corpus",
      "evidence",
    ])
      assert.ok(values[key], `--${key} is required`);
    const result = await correspondence({
      candidateRoot: values["candidate-root"],
      artifact: values.artifact,
      sourceRoot: values["source-root"],
      corpus: values.corpus,
      evidence: values.evidence,
      rebuiltWasm: values["rebuilt-wasm"],
    });
    console.log(
      `authorization correspondence ${result.result}; release eligible: ${result.release_eligible}`,
    );
  })().catch((error) => {
    console.error(error.stack);
    process.exitCode = 1;
  });
}
