#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// The Usage header in checker/seal-receipt-check.mjs is copied into the
// standalone release asset. A path with a directory component would not
// resolve after that file is downloaded by itself.
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const DEFAULT = path.join(ROOT, "checker", "seal-receipt-check.mjs");
const PUBLISHED_NAME = "seal-receipt-check.mjs";

let checkedFile;

function fail(code, message, line = 1) {
  const file = checkedFile || checkerPath();
  process.stderr.write(`FAIL  ${code}: ${file}:${line}: ${message}\n`);
  process.exit(1);
}

function checkerPath() {
  if (process.argv[2]) return path.resolve(process.argv[2]);
  if (process.env.SEAL_CHECKER_USAGE_FILE) return path.resolve(process.env.SEAL_CHECKER_USAGE_FILE);
  return DEFAULT;
}

function readChecker(file) {
  let stat;
  try {
    stat = fs.statSync(file);
  } catch (error) {
    if (error.code === "ENOENT") fail("checker_file_absent", `published checker is absent: ${file}`);
    fail("checker_file_unreadable", `published checker is unreadable: ${file}: ${error.message}`);
  }
  if (!stat.isFile()) fail("checker_file_absent", `published checker is absent: ${file}`);
  if (stat.size === 0) fail("checker_file_empty", `published checker is empty: ${file}`);
  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch (error) {
    fail("checker_file_unreadable", `published checker is unreadable: ${file}: ${error.message}`);
  }
  if (text.length === 0) fail("checker_file_empty", `published checker is empty: ${file}`);
  return text;
}

function usageCommand(text, file) {
  if (!/^\/\/ Usage:\s*$/m.test(text)) {
    fail("usage_header_absent", `published checker has no Usage header: ${file}`);
  }
  const match = text.match(/^\/\/ Usage:\s*\n\/\/\s+(\S.*)$/m);
  if (!match) {
    const headerLine = text.search(/^\/\/ Usage:\s*$/m);
    fail(
      "usage_header_command_absent",
      `Usage header has no command line: ${file}`,
      text.slice(0, headerLine).split("\n").length,
    );
  }
  return {
    command: match[1].trim(),
    line: text.slice(0, match.index).split("\n").length + 1,
  };
}

function scriptFromCommand(command, line) {
  const match = command.match(/^node\s+(\S+)/);
  if (!match) {
    fail("usage_header_command_absent", `Usage header is not a node invocation: ${command}`, line);
  }
  return match[1];
}

const file = checkerPath();
checkedFile = file;
const text = readChecker(file);
const usage = usageCommand(text, file);
const script = scriptFromCommand(usage.command, usage.line);
if (script.includes("/") || script.includes("\\") || script !== PUBLISHED_NAME) {
  fail(
    "usage_header_unresolvable_path",
    `Usage header names ${script}, which would not resolve for a reader who downloaded the asset alone`,
    usage.line,
  );
}

process.stdout.write(`PASS  published checker Usage header runs as node ${PUBLISHED_NAME}\n`);
