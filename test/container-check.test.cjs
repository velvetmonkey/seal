// SPDX-License-Identifier: Apache-2.0
const assert = require("node:assert/strict");
const { mkdtempSync, rmSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join, resolve } = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const ROOT = resolve(__dirname, "..");
const CHECK = join(ROOT, "scripts", "container-check.mjs");

function run(readme) {
  const dir = mkdtempSync(join(tmpdir(), "seal-container-check-test-"));
  const path = join(dir, "README.md");
  writeFileSync(path, readme);
  const result = spawnSync(process.execPath, [CHECK], {
    cwd: ROOT,
    encoding: "utf8",
    env: { PATH: "/usr/bin:/bin", CONTAINERWALK_README: path },
  });
  rmSync(dir, { recursive: true, force: true });
  return result;
}

test("extracts bash and compares a following output fence", () => {
  const result = run("before\n```bash\nprintf 'hello\\n'\n```\n```output\nhello\n```\n");
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /extracted 1 bash commands and 1 output samples/);
});

test("an ambiguous fence fails closed", () => {
  const result = run("```\nprintf 'hello\\n'\n```\n");
  assert.equal(result.status, 1);
  assert.match(result.stderr, /ambiguous fence/);
});

test("a command failure names the command, exit code, and first error line", () => {
  const result = run("```bash\nprintf 'visible error\\n' >&2\nexit 7\n```\n");
  assert.equal(result.status, 1);
  assert.match(result.stderr, /exit 7/);
  assert.match(result.stderr, /first error: visible error/);
  assert.match(result.stderr, /printf 'visible error/);
});

test("an output path from the builder is not normalized away", () => {
  const result = run("```bash\nprintf 'safe\\n'\n```\n```output\n\/home\/monkey\/scratch\/builder\/x\n```\n");
  assert.equal(result.status, 1);
  assert.match(result.stderr, /output fence contains builder-local \/home\/ absolute path/);
});

test("a command fence with an absolute home path fails before it runs", () => {
  for (const [pathText, diagnostic] of [
    ["/home/monkey/not-a-reader-path", /command fence contains \/home\/ absolute path/],
    ["/Users/reader/not-a-reader-path", /command fence contains \/Users\/ absolute path/],
    ["'C:\\Users\\reader\\not-a-reader-path'", /command fence contains C:\\Users\\ absolute path/],
  ]) {
    const result = run(`\`\`\`bash\nprintf '%s\\n' ${pathText}\n\`\`\`\n`);
    assert.equal(result.status, 1, pathText);
    assert.match(result.stderr, diagnostic);
  }
});
