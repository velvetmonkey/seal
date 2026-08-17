import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import test from "node:test";

const ROOT = path.resolve(import.meta.dirname, "..");
const SCRIPT = path.join(ROOT, "scripts/claim-coverage-inventory.mjs");
const REPOS = ["seal", "seal-check", "seal-demo", "seal-live-demo", "seal-verify-action", "seal-assurance-kit", "mcp-seal-dev"];

function fixture() {
  const family = fs.mkdtempSync(path.join(os.tmpdir(), "claiminventory-"));
  const roots = Object.fromEntries(REPOS.map((repo) => [repo, path.join(family, repo)]));
  for (const root of Object.values(roots)) fs.mkdirSync(path.join(root, "scripts"), { recursive: true });
  for (const root of Object.values(roots)) fs.writeFileSync(path.join(root, "scripts/claims-drift.mjs"), "");
  fs.writeFileSync(path.join(roots.seal, "scripts/claims-drift.mjs"), [
    'const CLAIM_MANIFEST = [["substring.md", "fixture"]];',
    'const COPY = { canonical: "covered.md", mirrors: [] };',
  ].join("\n"));
  fs.writeFileSync(path.join(roots.seal, "scripts/claim-coverage-allowlist.json"), JSON.stringify({
    version: 1,
    uncovered: ["seal/README.md", "seal-check/CLAIMS.md"],
  }));
  fs.writeFileSync(path.join(roots.seal, "covered.md"), "covered claims");
  fs.writeFileSync(path.join(roots.seal, "substring.md"), "substring claims");
  fs.writeFileSync(path.join(roots.seal, "README.md"), "fixture overview");
  fs.writeFileSync(path.join(roots["seal-check"], "CLAIMS.md"), "fixture claim ledger");
  return { family, roots };
}

function run(roots, extra = {}) {
  const env = { ...process.env };
  for (const [repo, root] of Object.entries(roots)) env[`FAMILY_${repo.replaceAll("-", "_").toUpperCase()}_ROOT`] = root;
  for (const [repo, root] of Object.entries(extra)) env[`FAMILY_${repo.replaceAll("-", "_").toUpperCase()}_ROOT`] = root;
  try { return { code: 0, out: execFileSync(process.execPath, [SCRIPT], { cwd: ROOT, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }) }; }
  catch (error) { return { code: error.status, out: `${error.stdout}${error.stderr}` }; }
}

test("inventory reports fixture three-way accounting", (t) => {
  const { family, roots } = fixture();
  t.after(() => fs.rmSync(family, { recursive: true, force: true }));
  const result = run(roots);
  assert.equal(result.code, 0, result.out);
  assert.match(result.out, /full=1 substring=1 uncovered=2 allowlisted=2/);
});

test("an uncovered claim-bearing file fails until allowlisted", (t) => {
  const { family, roots } = fixture();
  t.after(() => fs.rmSync(family, { recursive: true, force: true }));
  fs.writeFileSync(path.join(roots.seal, "new-claim.md"), "This is proven and tested.");
  const result = run(roots);
  if (process.env.CLAIM_INVENTORY_EVIDENCE) console.log(`NEW_FILE_EVIDENCE\n${result.out}`);
  assert.equal(result.code, 1, result.out);
  assert.match(result.out, /seal\/new-claim\.md/);
});

test("removing an uncovered file from the allowlist fails", (t) => {
  const { family, roots } = fixture();
  t.after(() => fs.rmSync(family, { recursive: true, force: true }));
  const allow = path.join(roots.seal, "scripts/claim-coverage-allowlist.json");
  const data = JSON.parse(fs.readFileSync(allow, "utf8"));
  data.uncovered = data.uncovered.filter((file) => file !== "seal/README.md");
  fs.writeFileSync(allow, JSON.stringify(data));
  const result = run(roots);
  if (process.env.CLAIM_INVENTORY_EVIDENCE) console.log(`REMOVED_ALLOWLIST_EVIDENCE\n${result.out}`);
  assert.equal(result.code, 1, result.out);
  assert.match(result.out, /seal\/README\.md/);
});

test("a non-claim-bearing file does not fail the inventory", (t) => {
  const { family, roots } = fixture();
  t.after(() => fs.rmSync(family, { recursive: true, force: true }));
  fs.writeFileSync(path.join(roots.seal, "ordinary-notes.md"), "A list of shell aliases.");
  const result = run(roots);
  assert.equal(result.code, 0, result.out);
  assert.doesNotMatch(result.out, /ordinary-notes/);
});

test("a missing sibling is a named finding, never a skip", (t) => {
  const { family, roots } = fixture();
  t.after(() => fs.rmSync(family, { recursive: true, force: true }));
  fs.rmSync(roots["seal-check"], { recursive: true, force: true });
  const result = run(roots);
  assert.equal(result.code, 1, result.out);
  assert.match(result.out, /FINDING required family checkout missing: seal-check/);
});

test("an empty family claim-bearing population is a refusal, not complete coverage", (t) => {
  const { family, roots } = fixture();
  t.after(() => fs.rmSync(family, { recursive: true, force: true }));
  for (const root of Object.values(roots)) {
    for (const entry of fs.readdirSync(root)) fs.rmSync(path.join(root, entry), { recursive: true, force: true });
    fs.mkdirSync(path.join(root, "scripts"), { recursive: true });
    fs.writeFileSync(path.join(root, "scripts/claims-drift.mjs"), "");
  }
  fs.writeFileSync(path.join(roots.seal, "scripts/claim-coverage-allowlist.json"), JSON.stringify({ version: 1, uncovered: [] }));
  const result = run(roots);
  assert.equal(result.code, 1, result.out);
  assert.match(result.out, /family claim-bearing population is empty/);
});
