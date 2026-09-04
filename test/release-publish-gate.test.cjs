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
        reject(new Error(`REFUSE cannot read release-publish environment: response error: ${error.message}`));
      });
      response.on("end", () => {
        if (response.statusCode !== 200) {
          const prefix = response.statusCode === 403 || response.statusCode === 429
            ? "REFUSE could not determine release-publish environment state"
            : "REFUSE cannot read release-publish environment";
          const error = new Error(`${prefix}: HTTP ${response.statusCode} ${response.statusMessage}\n${payload}`);
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
      reject(new Error(`REFUSE cannot read release-publish environment: network error: ${error.message}`));
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
