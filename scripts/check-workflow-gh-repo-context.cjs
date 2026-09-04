#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");

function indentation(line) {
  const match = /^( *)/u.exec(line);
  return match[1].length;
}

function mappingKey(line) {
  const match = /^\s*(?:"([^"]+)"|'([^']+)'|([A-Za-z0-9_-]+)):\s*(.*)$/u.exec(line);
  if (!match) return null;
  return { key: match[1] || match[2] || match[3], value: match[4] };
}

function hasInlineEnv(value, name) {
  if (!value.startsWith("{")) return false;
  return new RegExp(`(?:^|[{,]\\s*)["']?${name}["']?\\s*:`, "u").test(value);
}

function fieldHasEnv(lines, field, end, parentIndent, name) {
  if (hasInlineEnv(field.value, name)) return true;
  for (let index = field.index + 1; index < end; index += 1) {
    const line = lines[index];
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    if (indentation(line) <= parentIndent) break;
    const item = mappingKey(line);
    if (item && item.key === name) return true;
  }
  return false;
}

function directField(lines, start, end, parentIndent, name) {
  let childIndent = null;
  for (let index = start; index < end; index += 1) {
    const line = lines[index];
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const indent = indentation(line);
    if (indent <= parentIndent) continue;
    if (childIndent === null || indent < childIndent) childIndent = indent;
  }
  if (childIndent === null) return null;
  for (let index = start; index < end; index += 1) {
    const line = lines[index];
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const indent = indentation(line);
    if (indent !== childIndent) continue;
    const item = mappingKey(line);
    if (item && item.key === name) return { index, indent, value: item.value };
  }
  return null;
}

function workflowFiles(root) {
  const directory = path.join(root, ".github", "workflows");
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory)
    .filter((name) => /\.ya?ml$/u.test(name))
    .sort()
    .map((name) => path.join(directory, name));
}

function jobRanges(lines, relative) {
  let jobsIndex = -1;
  let jobsIndent = -1;
  for (let index = 0; index < lines.length; index += 1) {
    const item = mappingKey(lines[index]);
    if (item && item.key === "jobs") {
      jobsIndex = index;
      jobsIndent = indentation(lines[index]);
      break;
    }
  }
  if (jobsIndex < 0) return [];

  const starts = [];
  let jobIndent = null;
  for (let index = jobsIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const indent = indentation(line);
    if (indent <= jobsIndent) break;
    const item = mappingKey(line);
    if (!item) continue;
    if (jobIndent === null) jobIndent = indent;
    if (indent === jobIndent) starts.push({ id: item.key, start: index, indent });
  }
  if (jobIndent === null) {
    throw new Error(`${relative}:${jobsIndex + 1}: jobs must contain a mapping`);
  }
  return starts.map((job, offset) => ({
    ...job,
    end: offset + 1 < starts.length ? starts[offset + 1].start : lines.length,
  }));
}

function stepRanges(lines, job) {
  const steps = directField(lines, job.start + 1, job.end, job.indent, "steps");
  if (!steps) return [];
  const starts = [];
  let stepIndent = null;
  for (let index = steps.index + 1; index < job.end; index += 1) {
    const line = lines[index];
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const indent = indentation(line);
    if (indent <= steps.indent) break;
    if (/^\s*-\s+/u.test(line)) {
      if (stepIndent === null) stepIndent = indent;
      if (indent === stepIndent) starts.push({ start: index, indent });
    }
  }
  return starts.map((step, offset) => ({
    ...step,
    end: offset + 1 < starts.length ? starts[offset + 1].start : job.end,
  }));
}

function stepField(lines, step, name) {
  const first = /^\s*-\s+([A-Za-z0-9_-]+):\s*(.*)$/u.exec(lines[step.start]);
  if (first && first[1] === name) {
    return { index: step.start, indent: step.indent + 2, value: first[2] };
  }
  return directField(lines, step.start + 1, step.end, step.indent, name);
}

function scalarLines(lines, field, end) {
  if (/^[|>][+-]?\d*\s*(?:#.*)?$/u.test(field.value)) {
    const values = [];
    for (let index = field.index + 1; index < end; index += 1) {
      const line = lines[index];
      if (line.trim() && indentation(line) <= field.indent) break;
      values.push({ line: index + 1, text: line.trim() ? line.slice(field.indent + 2) : "" });
    }
    return values;
  }
  if (!field.value) return [];
  let value = field.value;
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1);
  }
  return [{ line: field.index + 1, text: value }];
}

function shellCommands(runLines) {
  const commands = [];
  let current = [];
  for (const source of runLines) {
    const trimmed = source.text.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    current.push(source);
    if (!/\\\s*$/u.test(trimmed)) {
      commands.push(current);
      current = [];
    }
  }
  if (current.length > 0) commands.push(current);
  return commands;
}

function directGhLines(command) {
  return command.filter(({ text }) => /(^|[;&|($`\s])gh(?=\s)/u.test(text));
}

function parseWorkflow(file, root) {
  const relative = path.relative(root, file);
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/u);
  const calls = [];
  for (const job of jobRanges(lines, relative)) {
    const nameField = directField(lines, job.start + 1, job.end, job.indent, "name");
    const jobName = nameField ? nameField.value.replace(/^['"]|['"]$/gu, "") : job.id;
    const jobEnv = directField(lines, job.start + 1, job.end, job.indent, "env");
    const jobHasRepo = jobEnv ? fieldHasEnv(lines, jobEnv, job.end, jobEnv.indent, "GH_REPO") : false;
    let earlierCheckout = false;
    for (const step of stepRanges(lines, job)) {
      const uses = stepField(lines, step, "uses");
      const isCheckout = Boolean(uses && /^['"]?actions\/checkout@/u.test(uses.value));
      const stepEnv = stepField(lines, step, "env");
      const stepHasRepo = stepEnv ? fieldHasEnv(lines, stepEnv, step.end, stepEnv.indent, "GH_REPO") : false;
      const run = stepField(lines, step, "run");
      if (run) {
        for (const command of shellCommands(scalarLines(lines, run, step.end))) {
          const ghLines = directGhLines(command);
          if (ghLines.length === 0) continue;
          const commandText = command.map(({ text }) => text.trim()).join(" ");
          const commandHasRepo = /(^|\s)--repo(?:=|\s)/u.test(commandText);
          for (const ghLine of ghLines) {
            calls.push({
              file: relative,
              line: ghLine.line,
              jobId: job.id,
              jobName,
              command: ghLine.text.trim(),
              earlierCheckout,
              jobHasRepo,
              stepHasRepo,
              commandHasRepo,
            });
          }
        }
      }
      if (isCheckout) earlierCheckout = true;
    }
  }
  return calls;
}

function auditWorkflowGhRepoContext(root = ROOT) {
  const calls = workflowFiles(root).flatMap((file) => parseWorkflow(file, root));
  const findings = calls.filter((call) => !(
    call.earlierCheckout || call.jobHasRepo || call.stepHasRepo || call.commandHasRepo
  ));
  return { calls, findings };
}

function formatFinding(call) {
  return `${call.file}:${call.line}: job "${call.jobId}" (${call.jobName}) calls gh without an earlier checkout or repository context: ${call.command}`;
}

function main() {
  try {
    const { calls, findings } = auditWorkflowGhRepoContext();
    if (findings.length > 0) {
      process.stderr.write("REFUSE workflow_gh_repo_context: an inline gh call has no repository context:\n");
      process.stderr.write(`${findings.map(formatFinding).join("\n")}\n`);
      process.exitCode = 1;
      return;
    }
    process.stdout.write(`PASS workflow_gh_repo_context: ${calls.length} inline gh calls have repository context\n`);
  } catch (error) {
    process.stderr.write(`REFUSE workflow_gh_repo_context: cannot parse workflows: ${error.message}\n`);
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = { auditWorkflowGhRepoContext, formatFinding };
