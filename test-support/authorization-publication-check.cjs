#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
"use strict";
const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path"),
  crypto = require("node:crypto");
const { unpackPayload } = require("../spine/integrity.cjs");
const { verifyTranscript, sha256 } = require("./authorization-transcript.cjs");
const { MUTATIONS } = require("./authorization-mutation-controls.cjs");
function verifyPublication({ evidenceRoot, assetRoot, tag, sourceCommit }) {
  for (const platform of ["linux-x64", "darwin-arm64", "darwin-x64"]) {
    const evidence = JSON.parse(
      fs.readFileSync(
        path.join(
          evidenceRoot,
          `authorization-correspondence-${platform}`,
          `result-${platform}.json`,
        ),
      ),
    );
    assert.equal(
      evidence.schema,
      "seal.authorization-correspondence/v2",
      `${platform}: schema`,
    );
    assert.equal(evidence.result, "PASS", `${platform}: baseline failure`);
    assert.equal(
      evidence.release_eligible,
      true,
      `${platform}: missing rebuild binding`,
    );
    assert.equal(
      evidence.source_commit,
      sourceCommit,
      `${platform}: source commit`,
    );
    for (const stage of ["proof", "adapter", "child"])
      assert.equal(
        evidence.stages[stage].result,
        "PASS",
        `${platform}: ${stage}`,
      );
    assert.deepEqual(
      evidence.mutations.map((m) => m.id),
      MUTATIONS.map((m) => m.id),
      `${platform}: missing mutation control`,
    );
    for (const [index, mutation] of evidence.mutations.entries()) {
      assert.equal(
        mutation.killed,
        true,
        `${platform}: ${mutation.id} survived`,
      );
      assert.equal(
        mutation.required_assertion,
        MUTATIONS[index].assertion,
        `${platform}: semantic assertion`,
      );
      assert.ok(
        mutation.actual_failure.includes(mutation.required_assertion),
        `${platform}: missing semantic kill reason`,
      );
    }
    const filename = `seal-${tag}-${platform}`;
    assert.equal(
      evidence.artifact.filename,
      filename,
      `${platform}: artifact subject`,
    );
    assert.equal(
      evidence.artifact.platform,
      platform,
      `${platform}: artifact platform`,
    );
    const bytes = fs.readFileSync(path.join(assetRoot, filename));
    assert.equal(
      bytes.length,
      evidence.artifact.bytes,
      `${platform}: asset size changed before publish`,
    );
    assert.equal(
      crypto.createHash("sha256").update(bytes).digest("hex"),
      evidence.artifact.sha256,
      `${platform}: asset digest changed before publish`,
    );
    const marker = Buffer.from("\n// --SEAL-PAYLOAD--\n");
    const at = bytes.indexOf(marker);
    assert.ok(at >= 0, `${platform}: payload missing`);
    const payload = unpackPayload(bytes.subarray(at + marker.length));
    const file = name => {
      const matches = payload.files.filter(f => f.path === name);
      assert.equal(matches.length, 1, `${platform}: payload path ${name}`);
      return matches[0].data;
    };
    const wasm = file("runtime/kernel/wasm/seal.wasm");
    assert.equal(sha256(wasm), evidence.wasm_rebuilt_sha256, `${platform}: rebuilt wasm`);
    assert.equal(sha256(wasm), evidence.artifact.wasm_sha256, `${platform}: extracted wasm`);
    assert.equal(payload.manifest.treeSha256, evidence.installed_tree_sha256, `${platform}: executed tree`);
    assert.equal(payload.manifest.treeSha256, evidence.artifact.installed_tree_sha256, `${platform}: artifact tree`);
    const packBytes = file("runtime/observation-guard.json");
    assert.equal(sha256(packBytes), evidence.observation_guard_sha256, `${platform}: observation pack`);
    assert.match(evidence.source_closure_sha256, /^[a-f0-9]{64}$/, `${platform}: source closure`);
    assert.match(evidence.definiens_digest, /^[a-f0-9]{64}$/, `${platform}: definiens digest`);
    assert.equal(evidence.definiens_format, "lean-expr-repr/v1", `${platform}: definiens format`);
    assert.ok(Array.isArray(evidence.definiens) && evidence.definiens.length, `${platform}: missing definiens`);
    assert.equal(sha256(JSON.stringify(evidence.definiens)), evidence.definiens_digest, `${platform}: definiens bytes`);
    assert.ok(evidence.ffi_export_map && typeof evidence.ffi_export_map === "object", `${platform}: export map`);
    assert.ok(Array.isArray(evidence.extract_sources) && evidence.extract_sources.length, `${platform}: extract source set`);
    for (const constant of evidence.definiens) {
      assert.ok(typeof constant.value === "string" && constant.value.length, `${platform}: missing constant body`);
      const mapping = evidence.ffi_export_map[constant.name];
      assert.ok(mapping && ["seal_decide", "seal_init"].includes(mapping.export), `${platform}: unmapped ${constant.name}`);
      assert.ok(evidence.extract_sources.includes(mapping.source), `${platform}: constant outside extract`);
    }
    const exports = WebAssembly.Module.exports(new WebAssembly.Module(wasm)).map(e => e.name).sort();
    assert.deepEqual(evidence.export_names, exports, `${platform}: wasm exports`);
    for (const name of ["seal_init", "seal_decide"]) assert.ok(exports.includes(name), `${platform}: missing ${name}`);
    assert.ok(evidence.residual_assumptions.includes("guarded correspondence is claimed only for tools in runtime/observation-guard.json"), `${platform}: pack scope`);
    for (const residual of ["residual:unguarded-forward", "residual:wall-clock-not-in-ninth",
      "compilation/runtime/IO/crypto", "operator lists other than the pack",
      "harness dialect rather than a third-party client", "human-present unknown"])
      assert.ok(evidence.residual_assumptions.includes(residual), `${platform}: residual ${residual}`);
    verifyTranscript(evidence, JSON.parse(packBytes));
    for (const name of ["live-accept-kernel-BLOCK", "load-fixture-policy-not-artifact", "wrapper-rewrites-worker-input"]) {
      const result = evidence.additional_mutations?.find(m => m.id === name);
      assert.ok(result?.killed && result.required_assertion &&
        result.actual_failure?.includes(result.required_assertion), `${platform}: missing ${name}`);
    }
    const live = evidence.additional_mutations.find(m => m.id === "live-accept-kernel-BLOCK");
    for (const name of ["consumed", "target-mismatch", "context-drift"]) {
      const sequence = live.sequences?.find(s => s.name === name);
      assert.ok(sequence?.live_proxy && sequence.kernel_route === "block" &&
        sequence.child_calls_after_block === 0 && sequence.transcript_rows?.length,
        `${platform}: ninth live sequence ${name}`);
    }
  }
}
function verifyBodies(beforeRoot, afterRoot) {
  const before = fs.readdirSync(beforeRoot).sort(), after = fs.readdirSync(afterRoot).sort();
  assert.ok(before.length > 0, "publication:no-assets");
  assert.deepEqual(after, before, "publication:asset-set-changed");
  for (const name of before) {
    const a = path.join(beforeRoot, name), b = path.join(afterRoot, name);
    assert.ok(fs.lstatSync(a).isFile() && fs.lstatSync(b).isFile(), "publication:nonregular-body");
    assert.equal(sha256(fs.readFileSync(a)), sha256(fs.readFileSync(b)), `publication:body-changed:${name}`);
  }
}
module.exports = { verifyPublication, verifyBodies };
if (require.main === module) {
  try {
    const { values } = require("node:util").parseArgs({
      options: {
        "before-root": { type: "string" },
        "after-root": { type: "string" },
        "evidence-root": { type: "string" },
        "asset-root": { type: "string" },
        tag: { type: "string" },
        "source-commit": { type: "string" },
      },
    });
    if (values["before-root"] || values["after-root"]) {
      assert.ok(values["before-root"] && values["after-root"], "both body roots required");
      verifyBodies(values["before-root"], values["after-root"]);
      console.log("publication re-downloaded bodies PASS");
      return;
    }
    for (const key of ["evidence-root", "asset-root", "tag", "source-commit"])
      assert.ok(values[key], `--${key} is required`);
    verifyPublication({
      evidenceRoot: values["evidence-root"],
      assetRoot: values["asset-root"],
      tag: values.tag,
      sourceCommit: values["source-commit"],
    });
    console.log("publication correspondence subjects PASS");
  } catch (error) {
    console.error(error.stack);
    process.exitCode = 1;
  }
}
