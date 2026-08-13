import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import test from "node:test";

const ROOT = path.resolve(import.meta.dirname, "..");
const SCRIPT = path.join(ROOT, "scripts/claim-coverage-inventory.mjs");
const base = {
  seal: ROOT,
  "seal-check": process.env.FAMILY_SEAL_CHECK_ROOT ?? path.join(ROOT, ".family/seal-check"),
  "seal-demo": process.env.FAMILY_SEAL_DEMO_ROOT ?? path.join(ROOT, ".family/seal-demo"),
  "seal-live-demo": process.env.FAMILY_SEAL_LIVE_DEMO_ROOT ?? path.join(ROOT, ".family/seal-live-demo"),
  "seal-verify-action": process.env.FAMILY_SEAL_VERIFY_ACTION_ROOT ?? path.join(ROOT, ".family/seal-verify-action"),
  "seal-assurance-kit": process.env.FAMILY_SEAL_ASSURANCE_KIT_ROOT ?? path.join(ROOT, ".family/seal-assurance-kit"),
  "mcp-seal-dev": process.env.FAMILY_MCP_SEAL_DEV_ROOT ?? path.join(ROOT, ".family/mcp-seal-dev"),
};

function run(extra = {}) {
  const env = { ...process.env };
  for (const [repo, root] of Object.entries(base)) env[`FAMILY_${repo.replaceAll("-", "_").toUpperCase()}_ROOT`] = root;
  for (const [repo, root] of Object.entries(extra)) env[`FAMILY_${repo.replaceAll("-", "_").toUpperCase()}_ROOT`] = root;
  try { return { code: 0, out: execFileSync(process.execPath, [SCRIPT], { cwd: ROOT, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }) }; }
  catch (error) { return { code: error.status, out: `${error.stdout}${error.stderr}` }; }
}

test("inventory reports the current three-way accounting", () => {
  const result = run();
  assert.equal(result.code, 0, result.out);
  assert.match(result.out, /full=22 substring=13 uncovered=75 allowlisted=75/);
});

test("an uncovered claim-bearing file fails until allowlisted", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "claiminventory-"));
  fs.cpSync(ROOT, temp, { recursive: true, filter: (source) => !source.includes(`${path.sep}.git`) });
  fs.writeFileSync(path.join(temp, "new-claim.md"), "This is proven and tested.");
  const result = run({ seal: temp });
  if (process.env.CLAIM_INVENTORY_EVIDENCE) console.log(`NEW_FILE_EVIDENCE\n${result.out}`);
  assert.equal(result.code, 1, result.out);
  assert.match(result.out, /seal\/new-claim\.md/);
  fs.rmSync(temp, { recursive: true, force: true });
});

test("removing an uncovered file from the allowlist fails", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "claiminventory-"));
  fs.cpSync(ROOT, temp, { recursive: true, filter: (source) => !source.includes(`${path.sep}.git`) });
  const allow = path.join(temp, "scripts/claim-coverage-allowlist.json");
  const data = JSON.parse(fs.readFileSync(allow, "utf8"));
  data.uncovered = data.uncovered.filter((file) => file !== "seal/README.md");
  fs.writeFileSync(allow, JSON.stringify(data));
  const result = run({ seal: temp });
  if (process.env.CLAIM_INVENTORY_EVIDENCE) console.log(`REMOVED_ALLOWLIST_EVIDENCE\n${result.out}`);
  assert.equal(result.code, 1, result.out);
  assert.match(result.out, /seal\/README\.md/);
  fs.rmSync(temp, { recursive: true, force: true });
});

test("a non-claim-bearing file does not fail the inventory", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "claiminventory-"));
  fs.cpSync(ROOT, temp, { recursive: true, filter: (source) => !source.includes(`${path.sep}.git`) });
  fs.writeFileSync(path.join(temp, "ordinary-notes.md"), "A list of shell aliases.");
  const result = run({ seal: temp });
  assert.equal(result.code, 0, result.out);
  assert.doesNotMatch(result.out, /ordinary-notes/);
  fs.rmSync(temp, { recursive: true, force: true });
});
