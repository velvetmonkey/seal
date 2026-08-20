#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Resolve the exact candidate range from a GitHub Actions event. Unanswerable
// event data is a finding, never permission to silently inspect a smaller range.
const { readFileSync } = require("node:fs");
const { spawnSync } = require("node:child_process");
const path = require("node:path");

const ROOT = process.env.SEAL_CI_RANGE_ROOT || path.join(__dirname, "..");
const ZERO_SHA = /^0+$/;

function fail(reason, detail = "") {
  process.stderr.write(`CI_DIFF_RANGE_UNREADABLE: ${reason}.${detail ? ` ${detail}` : ""}\n`);
  process.exitCode = 1;
}

function parseArgs(argv) {
  const options = { eventName: "", eventPath: "" };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--event-name") options.eventName = argv[++index] || "";
    else if (value === "--event-path") options.eventPath = argv[++index] || "";
    else return null;
  }
  return options.eventName && options.eventPath ? options : null;
}

function git(args) {
  return spawnSync("git", ["-C", ROOT, ...args], { encoding: "utf8" });
}

function requireCommit(revision, label) {
  if (typeof revision !== "string" || !revision || ZERO_SHA.test(revision)) {
    fail(`${label} is missing or is the all-zero object id`);
    return "";
  }
  const resolved = git(["rev-parse", "--verify", `${revision}^{commit}`]);
  if (resolved.status !== 0) {
    fail(`${label} is not an available commit`, resolved.stderr.trim());
    return "";
  }
  return resolved.stdout.trim();
}

const options = parseArgs(process.argv.slice(2));
if (!options) {
  process.stderr.write("usage: node scripts/resolve-ci-diff-range.cjs --event-name <push|pull_request> --event-path <json>\n");
  process.exitCode = 2;
} else {
  let event;
  try {
    event = JSON.parse(readFileSync(options.eventPath, "utf8"));
  } catch (error) {
    fail("event payload cannot be read", error.message);
  }

  if (event && options.eventName === "pull_request") {
    const base = requireCommit(event.pull_request?.base?.sha, "pull request base");
    const head = requireCommit(event.pull_request?.head?.sha, "pull request head");
    if (base && head) process.stdout.write(`${base} ${head}\n`);
  } else if (event && options.eventName === "push") {
    const head = requireCommit(event.after, "push after");
    if (head && !ZERO_SHA.test(event.before || "")) {
      const base = requireCommit(event.before, "push before");
      if (base) process.stdout.write(`${base} ${head}\n`);
    } else if (head) {
      const commits = event.commits;
      if (!Array.isArray(commits) || commits.length === 0) {
        fail("FIRST_PUSH_COMMITS_MISSING: all-zero before has no first pushed commit");
      } else if (Number.isInteger(event.size) && event.size > commits.length) {
        fail(`FIRST_PUSH_COMMITS_TRUNCATED: payload has ${commits.length} of ${event.size} pushed commits`);
      } else {
        const first = requireCommit(commits[0]?.id, "first pushed commit");
        const last = requireCommit(commits.at(-1)?.id, "last pushed commit");
        if (first && last && last !== head) {
          fail("FIRST_PUSH_HEAD_MISMATCH: last pushed commit is not push after");
        } else if (first && last) {
          const ancestry = git(["merge-base", "--is-ancestor", first, head]);
          if (ancestry.status !== 0) {
            fail("FIRST_PUSH_ANCESTRY_UNREADABLE: first pushed commit is not an ancestor of push after");
          } else {
            const parents = git(["rev-list", "--parents", "-n", "1", first]);
            if (parents.status !== 0) {
              fail("FIRST_PUSH_PARENT_UNREADABLE: cannot read first pushed commit parents", parents.stderr.trim());
            } else {
              const fields = parents.stdout.trim().split(/\s+/);
              if (fields.length === 1) {
                fail("FIRST_PUSH_ROOT_UNCOMPUTABLE: first pushed commit has no parent");
              } else if (fields.length > 2) {
                fail("FIRST_PUSH_MERGE_UNCOMPUTABLE: first pushed commit has multiple parents");
              } else {
                process.stdout.write(`${fields[1]} ${head}\n`);
              }
            }
          }
        }
      }
    }
  } else if (event) {
    fail(`unsupported event ${options.eventName}`);
  }
}
