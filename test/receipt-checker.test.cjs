// SPDX-License-Identifier: Apache-2.0
// V11-RECEIPT-01 acceptance: the EXTERNAL checker accepts a real receipt
// written by `seal demo` and refuses a mutated one, with a DISTINCT refusal
// per mutation site. The checker is run as a separate process; the test
// never asks the seal binary to verify anything.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn, execFileSync } = require("node:child_process");
const test = require("node:test");

const ROOT = path.join(__dirname, "..");
const SEAL = path.join(ROOT, "bin", "seal");
const CHECKER = path.join(ROOT, "checker", "seal-receipt-check.mjs");

// Run seal demo once; return the ALLOW receipt path and the pubkey sidecar.
function makeRealReceipt() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "seal-r3c-"));
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [SEAL, "demo", "--dir", dir], { stdio: ["pipe", "pipe", "pipe"] });
    let out = "";
    child.stdout.on("data", (c) => {
      out += c;
      if (/Approve\? \[y\/N\]/.test(out)) child.stdin.write("y\n");
    });
    child.once("close", (code) => {
      if (code !== 0) return reject(new Error(`demo exited ${code}: ${out}`));
      const allow = fs.readdirSync(path.join(dir, "receipts")).find((f) => f.endsWith("-ALLOW.json"));
      resolve({
        dir,
        receiptPath: path.join(dir, "receipts", allow),
        pubkeyPath: path.join(dir, "receipt-signer.pub"),
      });
    });
  });
}

// Run the external checker as its own process (not imported).
function runChecker(receiptPath, pubkey, opts = {}) {
  try {
    const out = execFileSync(process.execPath, [opts.checker || CHECKER, receiptPath, "--pubkey", pubkey], {
      encoding: "utf8", cwd: opts.cwd || ROOT,
    });
    return { code: 0, out };
  } catch (error) {
    return { code: error.status, out: (error.stdout || "") + (error.stderr || "") };
  }
}

function mutateReceipt(receiptPath, mutate) {
  const receipt = JSON.parse(fs.readFileSync(receiptPath, "utf8"));
  mutate(receipt);
  const target = `${receiptPath}.mutated-${Math.abs([...JSON.stringify(receipt)].reduce((a, c) => a + c.charCodeAt(0), 0))}.json`;
  fs.writeFileSync(target, JSON.stringify(receipt, null, 2));
  return target;
}

test("the external checker ACCEPTS a real receipt from seal demo", async () => {
  const { receiptPath, pubkeyPath } = await makeRealReceipt();
  const result = runChecker(receiptPath, pubkeyPath);
  assert.equal(result.code, 0, result.out);
  assert.match(result.out, /^ACCEPT ALLOW demo\.mutate/);
});

test("three distinct mutation sites each produce a distinct refusal", async () => {
  const { receiptPath, pubkeyPath } = await makeRealReceipt();

  const decision = runChecker(mutateReceipt(receiptPath, (r) => { r.decision = "BLOCK"; }), pubkeyPath);
  const tool = runChecker(mutateReceipt(receiptPath, (r) => { r.tool = "fs.delete"; }), pubkeyPath);
  const argument = runChecker(mutateReceipt(receiptPath, (r) => { r.arguments.line = "rm -rf /"; }), pubkeyPath);

  for (const r of [decision, tool, argument]) assert.equal(r.code, 1, r.out);
  assert.match(decision.out, /^REFUSE decision_binding_mismatch:/m);
  assert.match(tool.out, /^REFUSE tool_binding_mismatch:/m);
  assert.match(argument.out, /^REFUSE arguments_binding_mismatch:/m);

  const codes = [decision, tool, argument].map((r) => r.out.match(/REFUSE (\w+):/)[1]);
  assert.equal(new Set(codes).size, 3, `refusals must be distinct, got ${codes.join(", ")}`);
});

test("the signature is the unforgeable backstop: repairing commitments still refuses", async () => {
  const { receiptPath, pubkeyPath } = await makeRealReceipt();
  const crypto = require("node:crypto");
  const canonical = (v) => {
    if (v === null || typeof v === "number" || typeof v === "boolean" || typeof v === "string") return JSON.stringify(v);
    if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
    const names = Object.keys(v).sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)));
    return `{${names.map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(",")}}`;
  };
  const sha = (t) => crypto.createHash("sha256").update(Buffer.from(t, "utf8")).digest("hex");
  const forged = mutateReceipt(receiptPath, (r) => {
    r.tool = "fs.delete";
    r.seal.tool_sha256 = sha("fs.delete");
    r.seal.effect_sha256 = sha(canonical({ args: r.arguments, tool: "fs.delete" }));
  });
  const result = runChecker(forged, pubkeyPath);
  assert.equal(result.code, 1, result.out);
  assert.match(result.out, /^REFUSE signature_invalid:/m);
});

test("the checker does not import, require, spawn or shell out to seal's code", () => {
  const source = fs.readFileSync(CHECKER, "utf8");
  // Clause ONE, precisely: every import resolves to a node: builtin, there is
  // no require(), no child_process, and no spawn/exec CALL form. (A plain
  // grep would also flag the receipt format tag "seal.spine/v1" and the word
  // "spawns" in a comment — those are data/prose, not dependencies, so the
  // test targets the actual mechanisms of pulling in or shelling to code.)
  const imports = [...source.matchAll(/from "([^"]+)"/g)].map((m) => m[1]);
  assert.ok(imports.length > 0, "checker must have imports to inspect");
  for (const spec of imports) assert.ok(spec.startsWith("node:"), `checker imports only node builtins, saw ${spec}`);
  assert.ok(!/\brequire\s*\(/.test(source), "checker must not use require()");
  assert.ok(!/child_process/.test(source), "checker must not touch child_process");
  assert.ok(!/\b(spawn|spawnSync|exec|execSync|execFile|execFileSync)\s*\(/.test(source), "checker must not spawn or shell out");
  // And nothing it imports names a path under the product tree.
  for (const spec of imports) {
    for (const productPath of ["bin/seal", "/spine/", "/contract/"]) {
      assert.ok(!spec.includes(productPath), `checker import must not reach ${productPath}`);
    }
  }
});

test("the checker runs with the seal binary absent (copied to a clean dir)", async () => {
  const { receiptPath, pubkeyPath } = await makeRealReceipt();
  // Copy ONLY the checker into a fresh directory with no seal repo near it,
  // then run it there. If it needed bin/seal/spine/contract it would fail.
  const clean = fs.mkdtempSync(path.join(os.tmpdir(), "seal-r3c-isolated-"));
  const isolatedChecker = path.join(clean, "seal-receipt-check.mjs");
  fs.copyFileSync(CHECKER, isolatedChecker);
  fs.copyFileSync(receiptPath, path.join(clean, "receipt.json"));
  fs.copyFileSync(pubkeyPath, path.join(clean, "signer.pub"));
  const result = runChecker(path.join(clean, "receipt.json"), path.join(clean, "signer.pub"), { checker: isolatedChecker, cwd: clean });
  assert.equal(result.code, 0, result.out);
  assert.match(result.out, /^ACCEPT ALLOW demo\.mutate/);
});

test("the checker refuses to take its verifying key from inside the receipt", async () => {
  const { receiptPath } = await makeRealReceipt();
  // A wrong (attacker-chosen) key must refuse — the checker never trusts a
  // key embedded in the receipt; it uses only the out-of-band --pubkey.
  const wrongKey = require("node:crypto").generateKeyPairSync("ed25519").publicKey
    .export({ type: "spki", format: "der" }).subarray(-32).toString("hex");
  const result = runChecker(receiptPath, wrongKey);
  assert.equal(result.code, 1, result.out);
  assert.match(result.out, /^REFUSE signature_invalid:/m);
});
