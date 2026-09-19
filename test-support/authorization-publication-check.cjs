#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
"use strict";
const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path"),
  crypto = require("node:crypto");
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
      "seal.authorization-correspondence/v1",
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
    assert.equal(
      evidence.kernel_rebuild.sha256,
      evidence.artifact.wasm_sha256,
      `${platform}: rebuilt kernel`,
    );
  }
}
module.exports = { verifyPublication };
if (require.main === module) {
  try {
    const { values } = require("node:util").parseArgs({
      options: {
        "evidence-root": { type: "string" },
        "asset-root": { type: "string" },
        tag: { type: "string" },
        "source-commit": { type: "string" },
      },
    });
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
