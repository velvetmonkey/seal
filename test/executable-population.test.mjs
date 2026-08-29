import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { enumerate } from "../scripts/executable-population.mjs";

const ROOT = resolve(new URL("..", import.meta.url).pathname);
const ENUMERATOR = join(ROOT, "scripts/executable-population.mjs");
const ANTI_ROLL = join(ROOT, "scripts/check-executable-population-callers.mjs");

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "seal-enumcanon-"));
  execFileSync("git", ["init", "-q", root]);
  execFileSync("git", ["-C", root, "config", "user.email", "enumcanon@example.invalid"]);
  execFileSync("git", ["-C", root, "config", "user.name", "enumcanon"]);
  writeFileSync(join(root, "VERSION"), "0.0.0\n");
  writeFileSync(join(root, "package.json"), JSON.stringify({ scripts: {} }, null, 2));
  return root;
}
function executable(root, name, source = "#!/usr/bin/env node\nprocess.exit(0);\n") {
  const path = join(root, name);
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, source);
  chmodSync(path, 0o755);
}
function output(root) { return execFileSync(process.execPath, [ENUMERATOR, "--root", root], { encoding: "utf8" }); }
function count(root) { return Number(output(root).match(/^TOTAL (\d+)$/m)?.[1]); }

// This deliberately does not call enumerate().  It separately reconstructs
// the candidate rows using a separate shell-visible route and compares counts.
test("canonical population agrees with a separate direct-route reconstruction", () => {
  const canonical = enumerate(ROOT).length;
  const program = String.raw`
const fs=require('node:fs'),cp=require('node:child_process'),path=require('node:path');
const root=process.argv[1], temporary=path.relative(root,path.resolve(process.argv[2])), temporaryInside=temporary&&!temporary.startsWith('../')&&!path.isAbsolute(temporary), files=cp.execFileSync('git',['-C',root,'ls-files','--cached','--others','--exclude-standard','-z'],{encoding:'utf8'}).split('\0').filter(Boolean).filter(f=>fs.existsSync(path.join(root,f))).filter(f=>!temporaryInside||(f!==temporary&&!f.startsWith(temporary+'/')));
const units=files.filter(f=>{const p=path.join(root,f),s=fs.lstatSync(p);return s.isSymbolicLink()||(s.mode&73)||f.endsWith('.wasm')||fs.readFileSync(p,'utf8').startsWith('#!')});
let rows=new Set(['generated-release -> dist/seal-v'+fs.readFileSync(path.join(root,'VERSION'),'utf8').trim()+'-linux-x64']);
for(const caller of files){let source;try{source=fs.readFileSync(path.join(root,caller),'utf8')}catch{continue}; for(const target of units){if(caller===target)continue;const escaped=target.replace(/[^A-Za-z0-9_/-]/g,'\\$&');for(const m of source.matchAll(new RegExp('(?<![A-Za-z0-9_./-])'+escaped+'(?![A-Za-z0-9_./-])','g')))rows.add(caller+':'+source.slice(0,m.index).split('\n').length+' -> '+target)}
for(const m of source.matchAll(/(?:const|let|var)\s+(\w+)\s*=\s*(?:resolve|join)\(([^\n)]*)\)/g)){const target=[...m[2].matchAll(/["']([^"']+)["']/g)].map(x=>x[1]).join('/'); if(units.includes(target)){const use=new RegExp('(?:spawn(?:Sync)?|execFile(?:Sync)?|exec|node|bash|sh|run)\\s*(?:\\(|\\s+)[^\\n]*?\\b'+m[1]+'\\b|\\$'+m[1]+'\\b','g');for(const hit of source.matchAll(use))rows.add(caller+':'+source.slice(0,hit.index).split('\n').length+' -> '+target)}}}
console.log(rows.size)`;
  const separate = Number(execFileSync(process.execPath, ["-e", program, ROOT, tmpdir()], { encoding: "utf8" }));
  assert.equal(canonical, separate, "separate route must agree with the canonical enumerator");
});

test("marker-free executable unit raises the population by one", (t) => {
  const root = fixture(); t.after(() => rmSync(root, { recursive: true, force: true }));
  const before = count(root);
  executable(root, "scripts/plain.cjs");
  writeFileSync(join(root, "launch.mjs"), 'import { spawnSync } from "node:child_process"; spawnSync(process.execPath, ["scripts/plain.cjs"]);\n');
  assert.equal(count(root), before + 1);
  assert.match(output(root), /launch\.mjs:1 -> scripts\/plain\.cjs/);
});

test("package script alias is a reachable executable unit", (t) => {
  const root = fixture(); t.after(() => rmSync(root, { recursive: true, force: true }));
  const before = count(root);
  executable(root, "scripts/only-alias.cjs");
  writeFileSync(join(root, "package.json"), JSON.stringify({ scripts: { only: "node scripts/only-alias.cjs" } }, null, 2));
  assert.equal(count(root), before + 1);
  assert.match(output(root), /package\.json:\d+ -> scripts\/only-alias\.cjs/);
});

test("computed paths and symlinks resolve to executable behaviour", (t) => {
  const root = fixture(); t.after(() => rmSync(root, { recursive: true, force: true }));
  executable(root, "scripts/real.cjs");
  symlinkSync("real.cjs", join(root, "scripts/link.cjs"));
  writeFileSync(join(root, "launch.mjs"), 'import { resolve } from "node:path"; import { spawnSync } from "node:child_process"; const runner = resolve("scripts", "link.cjs"); spawnSync(process.execPath, [runner]);\n');
  assert.match(output(root), /launch\.mjs:1 -> scripts\/link\.cjs/);
});

test("anti-roll-your-own guard names a rogue population guard", (t) => {
  const rogue = join(ROOT, "scripts/rogue-executable-population-guard.mjs");
  t.after(() => rmSync(rogue, { force: true }));
  writeFileSync(rogue, '// EXECUTABLE-POPULATION-GUARD\nimport { readdirSync } from "node:fs";\nreaddirSync(".");\n');
  const broken = spawnSync(process.execPath, [ANTI_ROLL], { cwd: ROOT, encoding: "utf8" });
  assert.notEqual(broken.status, 0);
  assert.match(broken.stderr, /rogue-executable-population-guard\.mjs/);
  rmSync(rogue);
  const restored = spawnSync(process.execPath, [ANTI_ROLL], { cwd: ROOT, encoding: "utf8" });
  assert.equal(restored.status, 0, restored.stderr);
});
