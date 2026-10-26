const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

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

test('every kernel rebuild stage keeps file-list collation fixed', () => {
  const steps = nestedBlock(kernelJob(), 4, 'steps');
  const starts = [];
  for (let index = 0; index < steps.length; index += 1) {
    if (/^ {6}- /u.test(steps[index])) starts.push(index);
  }
  const rebuild = starts.map((start, index) => steps.slice(start, starts[index + 1]))
    .find((step) => step[0] === '      - name: Rebuild the published wasm artifact');
  assert.ok(rebuild, 'missing Rebuild the published wasm artifact step');
  const runStart = rebuild.indexOf('        run: |');
  assert.notEqual(runStart, -1, 'rebuild step needs a run: | block');
  const stages = rebuild.slice(runStart + 1)
    .map((line) => line.match(/^\s+bash wasm-spike\/([\w.-]+\.sh)(?:\s|$)/u))
    .filter(Boolean).map((match) => match[1]);
  assert.ok(stages.length > 0, 'rebuild run block names no stage script');

  for (const name of stages) {
    const source = fs.readFileSync(path.join(root, name), 'utf8');
    const lines = source.split(/\r?\n/u).filter((line) => !/^\s*#/u.test(line));
    const pin = lines.findIndex((line) => line.trim() === 'export LC_ALL=C');
    const setup = lines.findIndex((line) => line.includes('source ./emsdk/emsdk_env.sh'));
    const isCount = (tail) => /\|\s*(?:wc\s+-l\b|grep\s+-[^\s|]*c[^\s|]*)/u.test(tail);
    const hasList = lines.some((line) => {
      for (const match of line.matchAll(/\b(?:ls|find)\b/gu)) {
        if (!isCount(line.slice(match.index).split(')')[0])) return true;
      }
      return /[*?]\.[\w]+/u.test(line) && !/^\s*rm\b/u.test(line) && !isCount(line);
    });

    if (hasList) {
      const assignments = lines.filter((line) => /\bLC_ALL\s*=/u.test(line));
      assert.equal(assignments.length, 1, `${name}: file list needs exactly one LC_ALL assignment`);
      assert.equal(assignments[0].trim(), 'export LC_ALL=C',
        `${name}: file list needs export LC_ALL=C`);
      assert.ok(pin >= 0 && setup >= 0 && pin < setup,
        `${name}: export LC_ALL=C must precede emsdk setup`);
    }

    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      if (/\bfind\b/u.test(line)) {
        for (const match of line.matchAll(/\bfind\b/gu)) {
          const tail = line.slice(match.index).split(')')[0];
          assert.match(tail, /\|\s*(?:sort\b|wc\s+-l\b|grep\s+-c\b)/u,
            `${name}: find output must be piped to sort or a count`);
        }
      }
      if (index !== pin && (pin < 0 || index > pin)) {
        assert.doesNotMatch(line,
          /\b(?:LC_ALL|LANG|LC_COLLATE|LC_CTYPE)\s*=|\bunset\s+[^#\n]*\b(?:LC_ALL|LANG|LC_COLLATE|LC_CTYPE)\b|\benv\s+-i\b/u,
          `${name}: locale change after pin or without pin`);
      }
    }
  }
});

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

test('kernel reproduce rebuild step runs each stage under the host locale', () => {
  const steps = nestedBlock(kernelJob(), 4, 'steps');
  const starts = [];
  for (let index = 0; index < steps.length; index += 1) {
    if (/^ {6}- /u.test(steps[index])) starts.push(index);
  }
  const rebuild = starts.map((start, index) => steps.slice(start, starts[index + 1]))
    .find((step) => step[0] === '      - name: Rebuild the published wasm artifact');
  assert.ok(rebuild, 'missing Rebuild the published wasm artifact step');

  const keys = rebuild.map((line) => line.match(/^ {6}- ([\w-]+):|^ {8}([\w-]+):/u))
    .filter(Boolean).map((match) => match[1] || match[2]);
  const extra = keys.filter((key) => key !== 'name' && key !== 'run');
  assert.deepEqual(extra, [], `unexpected rebuild step key(s): ${extra.join(', ')}`);
  assert.deepEqual(keys.slice().sort(), ['name', 'run'], 'rebuild step needs only name and run');

  const runStart = rebuild.indexOf('        run: |');
  assert.notEqual(runStart, -1, 'rebuild step needs a run: | block');
  const runLines = rebuild.slice(runStart + 1);
  const nonblank = runLines.filter((line) => line.trim());
  assert.ok(nonblank.length > 0, 'rebuild step needs commands in its run block');
  const indent = Math.min(...nonblank.map((line) => line.search(/\S/u)));
  const block = runLines.map((line) => line.trim() ? line.slice(indent) : '').join('\n') + '\n';
  const stages = [...block.matchAll(/\bwasm-spike\/([\w.-]+\.sh)\b/gu)]
    .map((match) => match[1]);
  assert.ok(stages.length > 0, 'rebuild step needs a wasm-spike stage script');

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seal-rebuild-locale-'));
  try {
    const stageDir = path.join(dir, 'wasm-spike');
    const record = path.join(dir, 'stages.tsv');
    const script = path.join(dir, 'rebuild.sh');
    fs.mkdirSync(stageDir);
    const shellQuote = (value) => `'${value.replaceAll("'", "'\\''")}'`;
    for (const name of new Set(stages)) {
      // Bash builtins only: the stub records the environment at script entry.
      fs.writeFileSync(path.join(stageDir, name), `#!/usr/bin/env bash
variables=()
for variable in "\${!LC_@}"; do variables+=("$variable"); done
if [[ -v LANG ]]; then variables+=(LANG); fi
sorted=()
for variable in "\${variables[@]}"; do
  index=0
  while (( index < \${#sorted[@]} )) && [[ \${sorted[index]} < $variable ]]; do
    (( index += 1 ))
  done
  sorted=("\${sorted[@]:0:index}" "$variable" "\${sorted[@]:index}")
done
line=${shellQuote(name)}
for variable in "\${sorted[@]}"; do line+=$'\\t'"$variable=\${!variable}"; done
printf '%s\\n' "$line" >> ${shellQuote(record)}
`);
    }
    fs.writeFileSync(script, block);

    for (const locale of ['C', 'C.UTF-8']) {
      fs.writeFileSync(record, '');
      const result = spawnSync('bash', ['--noprofile', '--norc', '-e', script], {
        cwd: dir,
        env: { PATH: process.env.PATH, HOME: dir, LANG: locale, LC_ALL: locale },
        encoding: 'utf8',
      });
      assert.equal(result.status, 0,
        `rebuild step under ${locale} exited ${result.status}: ${result.stderr || result.error || ''}`);
      const lines = fs.readFileSync(record, 'utf8').trimEnd().split('\n');
      assert.equal(lines.length, stages.length,
        `rebuild step under ${locale} recorded ${lines.length} stages; expected ${stages.length}`);
      for (let index = 0; index < stages.length; index += 1) {
        const [name, ...variables] = lines[index].split('\t');
        assert.equal(name, stages[index],
          `${stages[index]} under ${locale} ran as ${name} with ${variables.join(', ')}`);
        assert.deepEqual(variables, [`LANG=${locale}`, `LC_ALL=${locale}`],
          `${name} under ${locale} recorded ${variables.join(', ') || '(none)'}`);
      }
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
