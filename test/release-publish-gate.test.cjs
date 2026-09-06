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
