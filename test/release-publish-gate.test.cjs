#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const https = require("node:https");
const path = require("node:path");
const test = require("node:test");

const workflow = fs.readFileSync(path.join(__dirname, "..", ".github", "workflows", "release.yml"), "utf8");

test("publish waits in the release-publish environment after draft verification", () => {
  const publish = workflow.match(/^  publish:\n([\s\S]*?)(?=^  \S|\z)/m)?.[1] || "";
  assert.match(publish, /^    environment: release-publish$/m);
  assert.match(publish, /^    needs: verify-draft$/m);
});

test("release recovers a draft and refuses a published release", () => {
  const create = workflow.match(/      - name: Create the draft release to be verified\n([\s\S]*?)(?=^      - uses: actions\/upload-artifact@v4)/m)?.[1] || "";
  assert.match(create, /REFUSE cannot determine release state: \$GITHUB_REF_NAME/);
  assert.match(create, /REFUSE release already published: \$GITHUB_REF_NAME/);
  assert.match(create, /gh release upload "\$GITHUB_REF_NAME"/);
  assert.doesNotMatch(create, /--clobber/);
  assert.match(create, /gh release create "\$GITHUB_REF_NAME"/);
  assert.match(create, /gh release view "\$GITHUB_REF_NAME" --json assets --jq \.assets/);
  assert.match(create, /candidate_digest="sha256:\$\(sha256sum "\$candidate"/);
  assert.match(create, /upload_missing\+=\("\$candidate"\)/);
  assert.match(create, /REFUSE draft asset digest differs: \$candidate_name/);
  assert.match(create, /gh release upload "\$GITHUB_REF_NAME" "\$\{upload_missing\[@\]\}"/);
});

// Two outcomes that used to be one. A wrong configuration is a 200 whose body
// names no reviewer or lets administrators bypass review; that throws and the
// test fails. An undetermined configuration is GitHub not reached, or reached
// and declining to answer; the body then carries no protection rules to judge,
// so the test reports network_unproven (the test/dist-pin.test.cjs convention)
// instead of calling the configuration wrong.
//
// Undetermined, and why:
//   socket error, DNS failure, timeout   the request never completed
//   response stream error                the body never completed
//   HTTP 403                             GitHub's primary rate limit answers 403 "rate limit
//                                        exceeded" (observed twice on 2026-09-06); any 403 is
//                                        GitHub refusing to answer, not a statement about the rules
//   HTTP 429                             secondary rate limit, a throttle
//   HTTP 5xx                             GitHub's own fault; nothing about this repository
// Kept as failures, and why:
//   HTTP 404 on velvetmonkey/seal        the environment is absent, which is a wrong configuration
//                                        (a fork with no environment still skips, below)
//   every other status, 3xx included     not a transport fault and never observed; failing is the
//                                        side that cannot hide a wrong configuration
//   200 with an unparsable body          GitHub answered; an unreadable answer stays loud
function undeterminedStatus(statusCode) {
  return statusCode === 403 || statusCode === 429 || (statusCode >= 500 && statusCode <= 599);
}

function undeterminedError(reason, statusCode) {
  const error = new Error(`could not determine release-publish environment state: ${reason}`);
  error.undetermined = true;
  if (statusCode !== undefined) error.statusCode = statusCode;
  return error;
}

function getEnvironment(repo, environment) {
  const apiPath = `/repos/${repo}/environments/${encodeURIComponent(environment)}`;
  return new Promise((resolve, reject) => {
    const request = https.get({
      hostname: "api.github.com",
      path: apiPath,
      headers: {
        "User-Agent": "velvetmonkey-seal-release-publish-gate",
        "X-Requested-With": `${process.pid}-${process.hrtime.bigint()}-${crypto.randomUUID()}`,
      },
    }, (response) => {
      let payload = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => { payload += chunk; });
      response.on("error", (error) => {
        reject(undeterminedError(`response error: ${error.message}`));
      });
      response.on("end", () => {
        if (response.statusCode !== 200) {
          if (undeterminedStatus(response.statusCode)) {
            const body = payload.trim().replace(/\s+/g, " ");
            reject(undeterminedError(`HTTP ${response.statusCode} ${response.statusMessage} ${body}`, response.statusCode));
            return;
          }
          const error = new Error(`REFUSE cannot read release-publish environment: HTTP ${response.statusCode} ${response.statusMessage}\n${payload}`);
          error.statusCode = response.statusCode;
          reject(error);
          return;
        }
        try {
          resolve(JSON.parse(payload));
        } catch (error) {
          reject(new Error(`REFUSE cannot read release-publish environment: invalid JSON: ${error.message}`));
        }
      });
    });
    request.setTimeout(10_000, () => {
      request.destroy(new Error("timeout after 10000ms"));
    });
    request.on("error", (error) => {
      reject(undeterminedError(`network error: ${error.message}`));
    });
  });
}

test("live release-publish environment requires a named reviewer and forbids admin bypass", async (t) => {
  const repo = process.env.GITHUB_REPOSITORY || "velvetmonkey/seal";
  const environment = process.env.SEAL_RELEASE_PUBLISH_ENV_NAME || "release-publish";
  console.log(`EXECUTE live release-publish environment check for ${repo}/${environment} with cache-bypassing unauthenticated Node https GET`);
  let body;
  try {
    body = await getEnvironment(repo, environment);
  } catch (error) {
    if (error.statusCode === 404 && repo !== "velvetmonkey/seal") {
      t.skip(`SKIP ${repo} has no ${environment} environment`);
      return;
    }
    if (error.undetermined) {
      t.skip(`network_unproven: ${error.message}; ${repo}/${environment} was not read, so it was not judged`);
      return;
    }
    throw error;
  }
  const requiredReviewers = (body.protection_rules || []).find((rule) => rule.type === "required_reviewers");
  assert.ok(requiredReviewers, "release-publish has no required_reviewers protection rule");
  const reviewerNames = (requiredReviewers.reviewers || [])
    .map((entry) => entry.reviewer?.login || entry.reviewer?.name || entry.reviewer?.slug)
    .filter(Boolean);
  assert.ok(reviewerNames.length > 0, "release-publish required_reviewers rule names no reviewer");
  assert.equal(body.can_admins_bypass, false, "release-publish allows administrators to bypass protection rules");
});

// Execute the workflow's Bash body. Only GitHub and manifest generation are
// stubbed. These tests check release control flow, not manifest validity.
const { spawnSync } = require("node:child_process");
const { testTmpdir } = require("../scripts/temp-root.cjs");
const os = require("node:os");

function runDraftStep(state, assetMode = "complete") {
  const directory = testTmpdir(path.join(os.tmpdir(), "seal-release-recovery-"));
  const dist = path.join(directory, "dist");
  fs.mkdirSync(dist);
  fs.writeFileSync(path.join(directory, "VERSION"), "1.2.3\n");
  fs.writeFileSync(path.join(directory, "claude-code-label.txt"), "UNTESTED\n");
  const names = ["seal-v1.2.3-linux-x64", "seal-v1.2.3-darwin-arm64", "seal-v1.2.3-darwin-x64", "seal-receipt-v2.mjs", "release-manifest.json"];
  for (const name of names) fs.writeFileSync(path.join(dist, name), `${name}\n`);
  fs.writeFileSync(path.join(dist, "SHA256SUMS"), names.slice(0, 4).map((name) => {
    const bytes = fs.readFileSync(path.join(dist, name));
    return `${crypto.createHash("sha256").update(bytes).digest("hex")}  ${bytes.length}  ${name}\n`;
  }).join(""));
  names.push("SHA256SUMS");
  const assets = names.map((name) => ({ name, digest: `sha256:${crypto.createHash("sha256").update(fs.readFileSync(path.join(dist, name))).digest("hex")}` }));
  if (assetMode === "missing") assets.splice(assets.findIndex((asset) => asset.name === "release-manifest.json"), 1);
  if (assetMode === "different") assets[0].digest = `sha256:${"0".repeat(64)}`;
  fs.writeFileSync(path.join(directory, "assets.json"), JSON.stringify(assets));
  const step = workflow.match(/      - name: Create the draft release to be verified\n([\s\S]*?)(?=^      - uses: actions\/upload-artifact@v4)/m)?.[1];
  assert.ok(step, "draft step must exist");
  const body = step.split("        run: |\n")[1].replace(/^          /gm, "");
  const mock = `
gh() {
  printf '%s\\n' "$*" >> "$RUNNER_TEMP/calls"
  if [[ "$1 $2" = 'release view' ]]; then
    if [[ "$*" = *'--json assets'* ]]; then cat "$RUNNER_TEMP/assets.json"; return; fi
    case "$TEST_RELEASE_STATE" in
      missing) echo 'release not found' >&2; return 1 ;;
      unavailable) echo 'HTTP 503' >&2; return 1 ;;
      *) printf '%s\\n' "$TEST_RELEASE_STATE"; return ;;
    esac
  fi
  if [[ "$1 $2" = 'release create' && "$TEST_RELEASE_STATE" != missing ]]; then
    echo 'release already exists' >&2; return 1
  fi
  if [[ "$1 $2" = 'release create' || "$1 $2" = 'release upload' ]]; then return 0; fi
  echo 'unexpected gh command' >&2; return 99
}
node() {
  [[ "$1" = scripts/create-release-manifest.mjs ]] || return 99
}
`;
  const result = spawnSync("bash", ["--noprofile", "--norc", "-euo", "pipefail", "-c", mock + body], {
    cwd: directory, encoding: "utf8", timeout: 10_000,
    env: { PATH: process.env.PATH, RUNNER_TEMP: directory, GITHUB_REF_NAME: "v1.2.3", GITHUB_SHA: "a".repeat(40), TEST_RELEASE_STATE: state },
  });
  const calls = fs.readFileSync(path.join(directory, "calls"), "utf8").trim().split("\n");
  return { ...result, calls };
}

for (const [name, state, assets, expected, mutation, refusal] of [
  ["creates an absent draft", "missing", "complete", 0, "release create", null],
  ["adopts an identical draft without writes", "true", "complete", 0, null, null],
  ["uploads only the missing draft asset", "true", "missing", 0, "release upload", null],
  ["refuses different draft bytes without writes", "true", "different", 1, null, "REFUSE draft asset digest differs"],
  ["refuses a published release without writes", "false", "complete", 1, null, "REFUSE release already published"],
  ["refuses an unreadable release state without writes", "unavailable", "complete", 1, null, "REFUSE cannot determine release state"],
]) {
  test(`draft shell ${name}`, () => {
    const result = runDraftStep(state, assets);
    assert.equal(result.status, expected, result.stderr);
    if (refusal) assert.match(result.stderr, new RegExp(refusal));
    const writes = result.calls.filter((call) => !call.startsWith("release view "));
    assert.equal(writes.length, mutation ? 1 : 0, JSON.stringify(writes));
    if (mutation) assert.ok(writes[0].startsWith(`${mutation} v1.2.3 `), writes[0]);
    if (assets === "missing") {
      assert.match(writes[0], /\/release-manifest\.json$/);
      assert.equal(writes[0].split(" ").length, 4, "upload exactly one asset without clobber");
    }
    if (state === "missing") assert.match(writes[0], /--draft --verify-tag/);
  });
}

// Synthetic validator controls; these do not stand in for the live release gate.
test("v2 publication re-derives transcript assertions and rejects body changes and v1 PASS", () => {
  const assert = require('node:assert/strict');
  const fs = require('node:fs');
  const path = require('node:path');
  const root = path.resolve(__dirname, "..");
  const {ordered, sha256, hop, ENCODING, verifyTranscript} = require(root+'/test-support/authorization-transcript.cjs');
  const {verifyBodies, verifyPublication} = require(root+'/test-support/authorization-publication-check.cjs');
  const pack = {guardTools:['demo.mutate']};
  const guarded = JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'demo.mutate',arguments:{x:1}}});
  const residual = JSON.stringify({jsonrpc:'2.0',id:2,method:'tools/call',params:{name:'other',arguments:{x:1}}});
  const input = JSON.stringify({line:guarded});
  const oracle = {route:'forward',target:'synthetic-test-target',tool:'demo.mutate',arguments:{x:1}};
  const raw = JSON.stringify({route:'forward',audit:JSON.stringify({tool:oracle.tool,certs:[{kernel:'safety',reason:oracle.target}]})});
  const paramsHash = sha256(ordered(JSON.parse(guarded).params));
  const rows = [
   {inbound_index:0,child_index:0,corpus_id:'case',hops:[guarded,input,JSON.stringify(oracle),input,raw,guarded,JSON.stringify({tool:oracle.tool,arguments:oracle.arguments}),paramsHash].map(hop)},
   {inbound_index:1,child_index:1,residual:'residual:unguarded-forward',hops:[residual,null,JSON.stringify({route:'passthrough'}),null,null,residual,JSON.stringify({tool:'other',arguments:{x:1}}),sha256(ordered(JSON.parse(residual).params))].map(hop)}
  ];
  const base = {schema:'seal.authorization-correspondence/v2',encoding:ENCODING,joined_transcript:rows,
   inbound_lines:[guarded,residual],child_lines:[guarded,residual],required_corpus_ids:['case'],
   injectivity_table:[{target:oracle.target,params_sha256:paramsHash}],transcript_root_sha256:sha256(ordered(rows))};
  assert.equal(verifyTranscript(base,pack).forwarded,1);
  let controls=0;
  function reject(edit, message){const bad=structuredClone(base);edit(bad);bad.transcript_root_sha256=sha256(ordered(bad.joined_transcript));assert.throws(()=>verifyTranscript(bad,pack),message);controls++;}
  reject(e=>e.schema='seal.authorization-correspondence/v1',/schema/);
  reject(e=>e.joined_transcript=[],/missing-rows/);
  reject(e=>e.child_lines.push(guarded),/child-coverage/);
  reject(e=>e.inbound_lines.push(guarded),/inbound-coverage/);
  reject(e=>e.joined_transcript[0].hops[0].sha256='0'.repeat(64),/hop-digest/);
  reject(e=>e.joined_transcript[0].hops[4]=hop(JSON.stringify({route:'block',audit:JSON.stringify({tool:oracle.tool,certs:[{kernel:'safety',reason:oracle.target}]})})),/route/);
  reject(e=>{let x=JSON.parse(guarded);x.params.arguments.x=2;let wire=JSON.stringify(x);e.child_lines[0]=wire;e.joined_transcript[0].hops[5]=hop(wire);e.joined_transcript[0].hops[6]=hop(JSON.stringify({tool:x.params.name,arguments:x.params.arguments}));e.joined_transcript[0].hops[7]=hop(sha256(ordered(x.params)));},/child-effect/);
  reject(e=>{let x=JSON.parse(guarded);x.params._meta={extra:true};const wire=JSON.stringify(x),row=structuredClone(e.joined_transcript[0]);row.inbound_index=2;row.child_index=2;row.hops[0]=hop(wire);row.hops[5]=hop(wire);row.hops[7]=hop(sha256(ordered(x.params)));e.inbound_lines.push(wire);e.child_lines.push(wire);e.joined_transcript.push(row);},/injectivity/);
  reject(e=>e.required_corpus_ids.push('missing-case'),/corpus/);
  const work = testTmpdir(path.join(os.tmpdir(), "seal-correspondence-publication-"));
  for(const dir of ['before','after','evidence/authorization-correspondence-linux-x64'])fs.mkdirSync(path.join(work,dir),{recursive:true});
  const artifact=Buffer.from("test download body");
  fs.writeFileSync(work+'/before/candidate',artifact);fs.writeFileSync(work+'/after/candidate',artifact);
  verifyBodies(work+'/before',work+'/after');
  const changed=Buffer.from(artifact);changed[changed.length-1]^=1;fs.writeFileSync(work+'/after/candidate',changed);
  assert.throws(()=>verifyBodies(work+'/before',work+'/after'),/body-changed/);controls++;
  fs.writeFileSync(work+'/evidence/authorization-correspondence-linux-x64/result-linux-x64.json',JSON.stringify({schema:'seal.authorization-correspondence/v1',result:'PASS',release_eligible:true}));
  assert.throws(()=>verifyPublication({evidenceRoot:work+'/evidence',assetRoot:work+'/before',tag:'test',sourceCommit:'test'}),/schema/);controls++;
  assert.equal(controls, 11);
});
