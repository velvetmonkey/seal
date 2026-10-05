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
