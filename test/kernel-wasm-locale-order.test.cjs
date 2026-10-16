const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', 'wasm-spike');
for (const name of ['build_runtime_wasm.sh', 'build_base.sh', 'build_closure.sh']) {
  test(`${name} fixes file-list collation before toolchain setup`, () => {
    const source = fs.readFileSync(path.join(root, name), 'utf8');
    assert.match(source, /^export LC_ALL=C$/m);
    assert.ok(source.indexOf('export LC_ALL=C') < source.indexOf('source ./emsdk/emsdk_env.sh'));
  });
}

test('closure sorts fallback source candidates before selecting one', () => {
  const source = fs.readFileSync(path.join(root, 'build_closure.sh'), 'utf8');
  assert.match(source, /cand=\$\(find "\$STDLIB" -path "\*\/\$rel" 2>\/dev\/null \| sort \| head -1\)/);
});

const workflowPath = path.join(__dirname, '..', '.github', 'workflows', 'kernel-reproduce.yml');

function nestedBlock(lines, indent, key) {
  const start = lines.findIndex((line) => line === `${' '.repeat(indent)}${key}:`);
  assert.notEqual(start, -1, `missing ${key} block`);
  const end = lines.findIndex((line, index) => index > start && line.trim() &&
    !line.trimStart().startsWith('#') && line.search(/\S/) <= indent);
  return lines.slice(start + 1, end === -1 ? undefined : end);
}

function kernelJob() {
  const source = fs.readFileSync(workflowPath, 'utf8');
  return nestedBlock(nestedBlock(source.split(/\r?\n/), 0, 'jobs'), 2, 'kernel-reproduce');
}

test('kernel reproduce job runs under C and UTF-8 host locales', () => {
  const job = kernelJob();
  const matrix = nestedBlock(nestedBlock(job, 4, 'strategy'), 6, 'matrix');
  const locales = matrix.filter((line) => /^ {8}host_locale:/u.test(line));
  assert.equal(locales.length, 1, 'matrix must declare one host_locale key');
  const inline = locales[0].match(/^ {8}host_locale:\s*\[([^\]]*)\]\s*$/u);
  const values = inline
    ? inline[1].split(',').map((value) => value.trim().replace(/^['"]|['"]$/gu, ''))
    : nestedBlock(matrix, 8, 'host_locale').map((line) => {
      const item = line.match(/^ {10}-\s+(.+?)\s*$/u);
      assert.ok(item, 'host_locale must declare a list of values');
      return item[1].replace(/^['"]|['"]$/gu, '');
    });
  assert.ok(values.length >= 2 && values.every(Boolean), 'host_locale needs at least two values');
  assert.ok(values.includes('C'), 'host_locale must include C');
  assert.ok(values.some((value) => /\.UTF-?8$/iu.test(value)), 'host_locale needs a UTF-8 locale');

  const env = nestedBlock(job, 4, 'env');
  for (const variable of ['LANG', 'LC_ALL']) {
    const assignments = env.filter((line) => new RegExp(`^ {6}${variable}:`, 'u').test(line));
    assert.equal(assignments.length, 1, `job env must set ${variable} once`);
    assert.match(assignments[0], new RegExp(`^ {6}${variable}:\\s*['"]?\\$\\{\\{\\s*matrix\\.host_locale\\s*\\}\\}['"]?\\s*$`, 'u'),
      `job env ${variable} must use matrix.host_locale`);
  }
});

test('kernel reproduce build steps do not override the host locale', () => {
  const steps = nestedBlock(kernelJob(), 4, 'steps');
  const starts = [];
  for (let index = 0; index < steps.length; index += 1) {
    if (/^ {6}- /u.test(steps[index])) starts.push(index);
  }
  const stepAt = (index) => steps.slice(starts[index], starts[index + 1]);
  const stepName = (step) => step.find((line) => /^ {6}- name:|^ {8}name:/u.test(line));
  const build = starts.findIndex((_, index) => /Build Lean sources/u.test(stepName(stepAt(index)) || ''));
  assert.notEqual(build, -1, 'missing Build Lean sources step');
  for (let index = build; index < starts.length; index += 1) {
    const step = stepAt(index);
    const name = (stepName(step) || step[0]).trim().replace(/^-?\s*(?:name|uses):\s*/u, '');
    for (const line of step) {
      assert.doesNotMatch(line, /(?:^|[^\w])(?:LANG|LC_ALL)\s*(?:=|:)/u,
        `${name} must not assign LANG or LC_ALL`);
    }
  }
});
