#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Resolve the target-branch candidate range from a GitHub Actions event. Both
// push and pull-request events use the merge base of the target branch and head;
// unanswerable event data is a finding, never permission to inspect a smaller range.
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

function targetBranchBase(event) {
  const branch = event?.repository?.default_branch;
  if (typeof branch !== "string" || !branch) {
    fail("target default branch is missing from event payload");
    return "";
  }
  return requireCommit(`refs/remotes/origin/${branch}`, `target branch origin/${branch}`);
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
    const base = targetBranchBase(event);
    if (base && head) process.stdout.write(`${base} ${head}\n`);
  } else if (event) {
    fail(`unsupported event ${options.eventName}`);
  }
}
