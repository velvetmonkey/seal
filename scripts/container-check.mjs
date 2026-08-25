#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Execute the README's bash fences in one clean, throw-away HOME and compare
// the output fences which immediately follow them. This is deliberately a
// small parser: an unlabelled or unknown fence is not silently guessed.
import { chmodSync, lstatSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(import.meta.dirname, "..");
const readmePath = process.env.CONTAINERWALK_README || join(root, "README.md");
const keepHome = process.env.CONTAINERWALK_KEEP_HOME === "1";

function fail(message) {
  console.error(`CONTAINERWALK FAIL: ${message}`);
  process.exitCode = 1;
}

function firstLine(text) {
  return (text || "").split(/\r?\n/, 1)[0] || "(no error output)";
}

function parse(text) {
  const lines = text.split(/\r?\n/);
  const fences = [];
  for (let i = 0; i < lines.length; i += 1) {
    const open = lines[i].match(/^\s*```([^\s`]*)\s*$/);
    if (!open) continue;
    const start = i + 1;
    let end = start;
    while (end < lines.length && !/^\s*```\s*$/.test(lines[end])) end += 1;
    if (end === lines.length) throw new Error(`unclosed fence at README.md:${i + 1}`);
    const language = open[1];
    const body = lines.slice(start, end).join("\n");
    const preceding = lines.slice(Math.max(0, i - 3), i).join(" ");
    let role;
    if (language === "bash") role = "command";
    else if (language === "output") role = "output";
    else if (language === "text" && /real output|transcript|output/i.test(preceding)) role = "output";
    else if (["json", "yaml", "yml", "javascript", "js", "svg", "html"].includes(language)) role = "data";
    else throw new Error(`ambiguous fence at README.md:${i + 1}: language ${language || "<unlabelled>"}`);
    fences.push({ line: i + 1, language, role, body });
    i = end;
  }
  return fences;
}

function normalize(text, home) {
  return text.replaceAll("\\r", "").replaceAll("/home/you", home).replaceAll(home, "<HOME>").replaceAll("/tmp/", "<TMP>/");
}

function removeWritableTree(path) {
  const stat = lstatSync(path);
  if (stat.isDirectory()) {
    chmodSync(path, 0o700);
    for (const name of readdirSync(path)) removeWritableTree(join(path, name));
  } else {
    chmodSync(path, 0o600);
  }
}

let readme;
try {
  readme = readFileSync(readmePath, "utf8");
} catch (error) {
  fail(`README unreadable: ${error.message}`);
  process.exit(1);
}

let fences;
try {
  fences = parse(readme);
} catch (error) {
  fail(error.message);
  process.exit(1);
}
const commands = fences.filter((fence) => fence.role === "command");
if (commands.length === 0) {
  fail("README contains no bash command fences");
  process.exit(1);
}
for (const fence of commands) {
  if (/\/home\//.test(fence.body)) {
    fail(`README.md:${fence.line} command fence contains /home/ absolute path`);
  }
}
for (const fence of fences.filter((item) => item.role === "output")) {
  if (/\/home\/monkey\/scratch\//.test(fence.body)) {
    fail(`README.md:${fence.line} output fence contains builder-local path /home/monkey/scratch/`);
  }
}
if (process.exitCode === 1) process.exit(1);

// A following output fence is the expected capture for the preceding command.
// Output elsewhere is still classified and reported, never accidentally run.
const expected = new Map();
for (let i = 0; i < fences.length - 1; i += 1) {
  if (fences[i].role === "command" && fences[i + 1].role === "output") expected.set(fences[i].line, fences[i + 1]);
}

const home = mkdtempSync(join(tmpdir(), "seal-containerwalk-home-"));
const work = mkdtempSync(join(tmpdir(), "seal-containerwalk-work-"));
const script = join(work, "readme-commands.sh");
writeFileSync(script, "set -euo pipefail\n" + commands.map((fence, index) => `\nprintf '\\nCONTAINERWALK_COMMAND ${index + 1} README.md:${fence.line}\\n'\n${fence.body}\n`).join(""));

try {
  const result = spawnSync("bash", ["--noprofile", "--norc", script], {
    cwd: work,
    encoding: "utf8",
    env: {
      HOME: home,
      PATH: "/usr/bin:/bin",
      LANG: "C",
      LC_ALL: "C",
      RUNNER_TEMP: work,
      XDG_CONFIG_HOME: join(home, ".config"),
      XDG_DATA_HOME: join(home, ".local", "share"),
      XDG_CACHE_HOME: join(home, ".cache"),
    },
  });
  const output = `${result.stdout || ""}${result.stderr || ""}`;
  const status = result.status === null ? 128 + (result.signal ? 1 : 0) : result.status;
  if (status !== 0) {
    const marker = output.match(/CONTAINERWALK_COMMAND (\d+) README\.md:(\d+)/g)?.at(-1) || "unknown command";
    const command = commands.find((fence, index) => marker.includes(` ${index + 1} `));
    const shown = command ? command.body.replace(/\n/g, "\\n") : marker;
    fail(`command ${JSON.stringify(shown)} exit ${status}; first error: ${firstLine(result.stderr || result.stdout)}`);
  }
  for (const fence of commands) {
    const outputFence = expected.get(fence.line);
    if (!outputFence) continue;
    const actual = normalize(output, home);
    const wanted = normalize(outputFence.body, home);
    for (const line of wanted.split("\n").map((item) => item.trimEnd()).filter(Boolean)) {
      if (!actual.includes(line)) {
        fail(`output for command at README.md:${fence.line} does not contain expected line from README.md:${outputFence.line}: ${line}`);
        break;
      }
    }
  }
  if (status === 0 && process.exitCode !== 1) {
    console.log(`CONTAINERWALK PASS: extracted ${commands.length} bash commands and ${expected.size} output samples`);
  }
} finally {
  if (!keepHome) {
    removeWritableTree(home);
    rmSync(home, { recursive: true, force: true });
  }
  rmSync(work, { recursive: true, force: true });
}
