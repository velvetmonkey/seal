// SPDX-License-Identifier: Apache-2.0
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");
const test = require("node:test");
const { testTmpdir } = require("../scripts/temp-root.cjs");

const CLI = path.join(__dirname, "../bin/seal");

function run(args, input = "") {
  try {
    return { code: 0, out: execFileSync(process.execPath, [CLI, ...args], { input, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }) };
  } catch (error) {
    return { code: error.status, out: `${error.stdout || ""}${error.stderr || ""}` };
  }
}

function realReceipt() {
  const dir = testTmpdir(path.join(os.tmpdir(), "seal-verify-v2-"));
  const demo = run(["demo", "--dir", dir], "y\n");
  assert.equal(demo.code, 0, demo.out);
  const name = fs.readdirSync(path.join(dir, "receipts")).find((entry) => entry.endsWith("-ALLOW.json"));
  return {
    dir,
    receipt: path.join(dir, "receipts", name),
    publicKey: fs.readFileSync(path.join(dir, "receipt-signer.pub"), "utf8").trim(),
  };
}

test("seal verify exits successfully only for a signed receipt and the correct key", () => {
  const real = realReceipt();
  const result = run(["verify", real.receipt, "--pubkey", real.publicKey]);
  assert.equal(result.code, 0, result.out);
  assert.match(result.out, /Document structure       VALID/);
  assert.match(result.out, /Signature and bindings   VALID/);
  assert.match(result.out, /Verifier-local verdict   REPRODUCED/);
  assert.match(result.out, /VERIFY    UNVERIFIED/);

  const wrong = crypto.generateKeyPairSync("ed25519").publicKey
    .export({ type: "spki", format: "der" }).subarray(-32).toString("hex");
  const wrongKey = run(["verify", real.receipt, "--pubkey", wrong]);
  assert.notEqual(wrongKey.code, 0, wrongKey.out);
  assert.match(wrongKey.out, /signature_mismatch/);

  const withoutKey = run(["verify", real.receipt]);
  assert.notEqual(withoutKey.code, 0, withoutKey.out);
  assert.match(withoutKey.out, /Signature and bindings   UNVERIFIED/);
  assert.match(withoutKey.out, /VERIFY    UNVERIFIED/);
});

test("seal verify accepts pretty-printed signed receipts", () => {
  const real = realReceipt();
  const body = JSON.parse(fs.readFileSync(real.receipt, "utf8"));
  for (const [name, contents] of [
    ["two-space", JSON.stringify(body, null, 2) + "\n"],
    ["four-space", JSON.stringify(body, null, 4) + "\n"],
    ["crlf", JSON.stringify(body, null, 2).replace(/\n/g, "\r\n")],
  ]) {
    const target = path.join(real.dir, `${name}.json`);
    fs.writeFileSync(target, contents);
    const result = run(["verify", target, "--pubkey", real.publicKey]);
    assert.equal(result.code, 0, `${name}: ${result.out}`);
    assert.match(result.out, /Document structure       VALID/);
    assert.match(result.out, /Signature and bindings   VALID/);
  }
});

test("seal verify exits nonzero for a fabricated unsigned receipt", () => {
  const real = realReceipt();
  const body = JSON.parse(fs.readFileSync(real.receipt, "utf8"));
  delete body.signature;
  const fabricated = path.join(real.dir, "fabricated.json");
  fs.writeFileSync(fabricated, JSON.stringify(body));
  const result = run(["verify", fabricated, "--pubkey", real.publicKey]);
  assert.notEqual(result.code, 0, result.out);
  assert.match(result.out, /Signature and bindings   UNVERIFIED/);
  assert.match(result.out, /VERIFY    UNVERIFIED/);
});

test("verify distinguishes an uninspectable path from unreadable receipt contents", () => {
  const root = testTmpdir(path.join(os.tmpdir(), "seal-verify-inputs-"));
  const absent = path.join(root, "absent.json");
  const missing = run(["verify", absent]);
  assert.notEqual(missing.code, 0, missing.out);
  assert.match(missing.out, /^seal: cannot inspect receipt path:/);
  const unreadable = run(["verify", "/proc/1/mem"]);
  assert.notEqual(unreadable.code, 0, unreadable.out);
  assert.match(unreadable.out, /^seal: cannot read receipt contents:/);
});

test("verify refuses empty, malformed, and non-receipt JSON paths", () => {
  const root = testTmpdir(path.join(os.tmpdir(), "seal-verify-invalid-"));
  for (const [name, bytes, pattern] of [
    ["empty.json", "", /receipt is empty/],
    ["bad.json", "{", /read_failed/],
    ["not-a-receipt.json", "{}", /unsupported receipt schema/],
  ]) {
    const target = path.join(root, name);
    fs.writeFileSync(target, bytes);
    const result = run(["verify", target]);
    assert.notEqual(result.code, 0, `${name} unexpectedly passed: ${result.out}`);
    assert.match(result.out, pattern);
  }
});

test("verify refuses a tampered producer receipt", () => {
  const real = realReceipt();
  const body = JSON.parse(fs.readFileSync(real.receipt, "utf8"));
  body.arguments.line = "tampered";
  const target = path.join(real.dir, "tampered.json");
  fs.writeFileSync(target, JSON.stringify(body));
  const result = run(["verify", target]);
  assert.equal(result.code, 1, result.out);
  assert.match(result.out, /commitment_mismatch/);
});

test("verify refuses a changed local kernel before reporting a verdict", () => {
  const real = realReceipt();
  const tree = path.join(real.dir, "verifier");
  const source = path.resolve(__dirname, "..");
  for (const entry of ["bin", "spine", "scripts", "checker", "contract", "runtime", "runtime-manifest.json", "package.json", "VERSION"]) {
    fs.cpSync(path.join(source, entry), path.join(tree, entry), { recursive: true });
  }
  const { spawnSync } = require("node:child_process");
  const verify = () => spawnSync(process.execPath, [path.join(tree, "bin/seal"), "verify", real.receipt, "--pubkey", real.publicKey], {
    encoding: "utf8", env: { ...process.env, SEAL_CACHE_DIR: path.join(real.dir, "empty-cache") },
  });
  const honest = verify();
  assert.equal(honest.status, 0, honest.stdout + honest.stderr);
  assert.match(honest.stdout, /Verifier-local verdict   REPRODUCED/);

  for (const relative of ["kernel/wasm/seal.wasm", "kernel/wasm/seal.js"]) {
    const target = path.join(tree, "runtime", relative);
    const pinned = fs.readFileSync(target);
    try {
      // A valid WASM custom section changes the binary without breaking replay.
      // A JS comment likewise preserves execution, so replay failure cannot
      // accidentally satisfy this integrity-refusal regression.
      fs.appendFileSync(target, relative.endsWith(".wasm")
        ? Buffer.from([0, 2, 1, 120]) : "\n// changed local glue\n");
      const changed = verify();
      assert.equal(changed.status, 1, changed.stdout + changed.stderr);
      const blocked = spawnSync(process.execPath, [path.join(tree, "bin/seal"), "seal_block", "--pubkey", real.publicKey], {
        input: fs.readFileSync(real.receipt), encoding: "utf8",
        env: { ...process.env, SEAL_CACHE_DIR: path.join(real.dir, "empty-cache") },
      });
      assert.equal(blocked.status, 3, blocked.stdout + blocked.stderr);
      assert.equal(JSON.parse(blocked.stdout).error, "kernel_integrity");
      assert.match(changed.stderr, /local kernel runtime integrity check failed/);
      assert.ok(changed.stderr.includes(`${relative} hash mismatch`), changed.stderr);
      assert.doesNotMatch(changed.stdout + changed.stderr, /REPRODUCED|Document structure/);
      const json = spawnSync(process.execPath, [path.join(tree, "bin/seal"), "verify", real.receipt, "--pubkey", real.publicKey, "--json"], {
        encoding: "utf8", env: { ...process.env, SEAL_CACHE_DIR: path.join(real.dir, "empty-cache") },
      });
      assert.equal(json.status, 1, json.stdout + json.stderr);
      assert.equal(json.stderr, "");
      const refused = JSON.parse(json.stdout);
      assert.equal(refused.code, "runtime_unavailable");
      assert.equal(refused.ok, false);
      assert.equal(refused.replay, false);
    } finally {
      fs.writeFileSync(target, pinned);
    }
  }
});

test("verify JSON preserves checker results and legacy text for signed and unverifiable receipts", async () => {
  const { spawnSync } = require("node:child_process");
  const verifier = await import("../checker/seal-receipt-v2.mjs");
  const real = realReceipt();
  const body = JSON.parse(fs.readFileSync(real.receipt));
  const unsigned = path.join(real.dir, "unsigned.json");
  delete body.signature;
  fs.writeFileSync(unsigned, JSON.stringify(body));
  for (const [file, key, exit, code] of [
    [real.receipt, real.publicKey, 0, null],
    [real.receipt, undefined, 1, "signature_unverifiable"],
    [real.receipt, "bad-key", 1, "signature_unverifiable"],
    [unsigned, real.publicKey, 1, "signature_unverifiable"],
  ]) {
    const args = [CLI, "verify", file, ...(key === undefined ? [] : ["--pubkey", key])];
    const expected = await verifier.verify(fs.readFileSync(file), { publicKeyHex: key });
    const json = spawnSync(process.execPath, [...args, "--json"], { encoding: "utf8" });
    assert.equal(json.status, exit, json.stdout + json.stderr);
    assert.equal(json.stderr, "");
    assert.equal(json.stdout.trim().split("\n").length, 1);
    assert.deepEqual(JSON.parse(json.stdout), { ...expected, ok: exit === 0, code });
    const text = spawnSync(process.execPath, args, { encoding: "utf8" });
    assert.equal(text.status, exit, text.stderr);
    assert.equal(text.stderr, "");
    assert.equal(text.stdout, verifier.format(expected) + "\n");
  }
});

test("verify JSON retains typed input, signature and replay refusals with distinct exit classes", () => {
  const { spawnSync } = require("node:child_process");
  const { generateSigner, sealReceipt } = require("../spine/receipt-v2.cjs");
  const real = realReceipt();
  const text = fs.readFileSync(real.receipt, "utf8");
  const body = JSON.parse(text);
  const signer = generateSigner();
  const tampered = structuredClone(body);
  tampered.signature.value = (tampered.signature.value[0] === "0" ? "1" : "0") + tampered.signature.value.slice(1);
  const unexpected = structuredClone(body);
  unexpected.signature.extra = true;
  const commitment = structuredClone(body);
  commitment.arguments.line = "tampered";
  const replay = sealReceipt(signer, { ...body, verdict: "BLOCK" }, "BLOCK");
  for (const [name, contents, key, exit, code] of [
    ["missing", undefined, real.publicKey, 2, "read_failed"],
    ["empty", "", real.publicKey, 2, "read_failed"],
    ["json", "{", real.publicKey, 2, "read_failed"],
    ["utf8", Buffer.from([0xff]), real.publicKey, 2, "read_failed"],
    ["schema", text.replace('"v2"', '"v3"'), real.publicKey, 2, "invalid_receipt"],
    ["duplicate", text.replace('"seal_receipt":', '"seal_receipt":"v2","seal_receipt":'), real.publicKey, 2, "duplicate_member"],
    ["extra", JSON.stringify(unexpected), real.publicKey, 2, "unexpected_member"],
    ["signature", JSON.stringify(tampered), real.publicKey, 1, "signature_mismatch"],
    ["commitment", JSON.stringify(commitment), real.publicKey, 1, "commitment_mismatch"],
    ["replay", JSON.stringify(replay), signer.publicKeyHex, 1, "verdict_mismatch"],
  ]) {
    const file = path.join(real.dir, `${name}.json`);
    if (contents !== undefined) fs.writeFileSync(file, contents);
    const args = [CLI, "verify", file, "--pubkey", key];
    const json = spawnSync(process.execPath, [...args, "--json"], { encoding: "utf8" });
    assert.equal(json.status, exit, `${name}: ${json.stdout}${json.stderr}`);
    assert.equal(json.stderr, "", name);
    assert.equal(json.stdout.trim().split("\n").length, 1, name);
    const out = JSON.parse(json.stdout);
    assert.equal(out.code, code, name);
    for (const check of ["read", "validate", "signature", "replay", "verify"]) assert.equal(typeof out[check], "boolean", name);
    assert.equal(out.ok, false, name);
    assert.equal(out.verify, false, name);
    assert.equal(out.authority, "NOT ESTABLISHED", name);
    assert.equal(out.occurrence, "NOT ESTABLISHED", name);
    const plain = spawnSync(process.execPath, args, { encoding: "utf8" });
    assert.equal(plain.status, exit, name);
    assert.equal(plain.stdout, "", name);
    assert.equal(plain.stderr, `seal: ${["missing", "empty"].includes(name) ? "" : `${code}: `}${out.message}\n`, name);
  }
});

test("CLI and MCP verification have identical typed results including code", async (t) => {
  const real = realReceipt();
  const unsigned = path.join(real.dir, "unsigned-parity.json");
  const body = JSON.parse(fs.readFileSync(real.receipt));
  delete body.signature;
  fs.writeFileSync(unsigned, JSON.stringify(body));
  const malformed = path.join(real.dir, "malformed-parity.json");
  fs.writeFileSync(malformed, "{");
  const wrong = crypto.generateKeyPairSync("ed25519").publicKey
    .export({ type: "spki", format: "der" }).subarray(-32).toString("hex");
  for (const [name, file, key, code, exit] of [
    ["signed", real.receipt, real.publicKey, null, 0],
    ["no key", real.receipt, undefined, "signature_unverifiable", 1],
    ["wrong key", real.receipt, wrong, "signature_mismatch", 1],
    ["unsigned", unsigned, real.publicKey, "signature_unverifiable", 1],
    ["malformed JSON", malformed, real.publicKey, "read_failed", 2],
    ["missing file", path.join(real.dir, "absent"), real.publicKey, "read_failed", 2],
    ["non-regular file", real.dir, real.publicKey, "read_failed", 2],
  ]) await t.test(name, () => {
    const cli = run(["verify", file, "--json", ...(key === undefined ? [] : ["--pubkey", key])]);
    assert.equal(cli.code, exit, cli.out);
    const mcp = run(["__verify-server"], JSON.stringify({ jsonrpc: "2.0", id: 1,
      method: "tools/call", params: { name: "seal_verify", arguments: { receiptPath: file, pubkeyHex: key } } }) + "\n");
    assert.equal(mcp.code, 0, mcp.out);
    assert.equal(JSON.parse(mcp.out).result.isError, exit !== 0);
    const result = JSON.parse(JSON.parse(mcp.out).result.content[0].text);
    assert.deepEqual(result, JSON.parse(cli.out));
    // Equality alone cannot detect both transports losing a required field.
    assert.equal(result.code, code);
    assert.equal(result.ok, exit === 0);
  });
});

test("seal_block preserves stdin bytes and separates missing keys from invalid signatures", () => {
  const real = realReceipt();
  const bytes = fs.readFileSync(real.receipt);
  const good = run(["seal_block", "--pubkey", real.publicKey], bytes);
  assert.equal(good.code, 0, good.out);
  const result = JSON.parse(good.out);
  assert.equal(result.seal_block, "v1");
  assert.equal(result.ok, true);
  assert.equal(result.verify, false);
  assert.equal(result.authority, "UNPINNED / CALLER-SUPPLIED");
  assert.equal(result.occurrence, "NOT ESTABLISHED");
  for (const args of [[], ["--pubkey"], ["--pubkey", "bad"]]) {
    const missing = run(["seal_block", ...args], bytes);
    assert.equal(missing.code, 5, missing.out);
    assert.equal(JSON.parse(missing.out).error, "no_key");
  }
  const wrong = crypto.generateKeyPairSync("ed25519").publicKey
    .export({ type: "spki", format: "der" }).subarray(-32).toString("hex");
  const mismatch = run(["seal_block", "--pubkey", wrong], bytes);
  assert.equal(mismatch.code, 1, mismatch.out);
  assert.equal(JSON.parse(mismatch.out).error, "signature_mismatch");
  // Parsing/reserializing stdin would hide a duplicate; lossy UTF-8 decoding
  // would replace the invalid byte and turn its refusal into a different error.
  for (const [input, error] of [
    [Buffer.from(bytes.toString().replace('"tool":', '"tool":"duplicate","tool":')), "duplicate_member"],
    [Buffer.concat([Buffer.from([0xff]), bytes]), "read_failed"],
  ]) {
    const bad = run(["seal_block", "--pubkey", real.publicKey], input);
    assert.equal(bad.code, 1, bad.out);
    assert.equal(JSON.parse(bad.out).error, error);
  }
  const legacy = run(["verify", real.receipt, "--pubkey", "bad"]);
  assert.equal(legacy.code, 1, legacy.out);
});

// Regression witnesses: these fail against the original CLI/MCP boundary.
test("verify refuses extra receipt paths by name", () => {
  const real = realReceipt();
  const tampered = path.join(real.dir, "extra-tampered.json");
  const body = JSON.parse(fs.readFileSync(real.receipt));
  body.now = 1;
  fs.writeFileSync(tampered, JSON.stringify(body));
  const result = run(["verify", real.receipt, tampered, "--pubkey", real.publicKey]);
  assert.notEqual(result.code, 0, result.out);
  assert.ok(result.out.includes(tampered), result.out);
});

test("verify checks the receipt with flags before the path", () => {
  const real = realReceipt();
  const result = run(["verify", "--pubkey", real.publicKey, "--json", real.receipt]);
  assert.equal(result.code, 0, result.out);
  assert.equal(JSON.parse(result.out).ok, true);
});

test("MCP verification failures mark tool errors and permit a corrected next call", () => {
  const real = realReceipt();
  const tampered = path.join(real.dir, "mcp-tampered.json");
  const body = JSON.parse(fs.readFileSync(real.receipt));
  body.now = 1;
  fs.writeFileSync(tampered, JSON.stringify(body));
  const calls = [
    { receiptPath: tampered, pubkeyHex: real.publicKey },
    { receiptPath: path.join(real.dir, "missing") },
    { receiptPath: 17 },
    { receiptPath: real.receipt, pubkeyHex: real.publicKey },
  ];
  const response = run(["__verify-server"], calls.map((arguments_, id) => JSON.stringify({
    jsonrpc: "2.0", id, method: "tools/call", params: { name: "seal_verify", arguments: arguments_ },
  })).join("\n") + "\n");
  assert.equal(response.code, 0, response.out);
  const replies = response.out.trim().split("\n").map(JSON.parse);
  for (const reply of replies.slice(0, 3)) assert.equal(reply.result.isError, true);
  assert.equal(JSON.parse(replies[0].result.content[0].text).code, "signature_mismatch");
  assert.equal(JSON.parse(replies[1].result.content[0].text).code, "read_failed");
  assert.equal(JSON.parse(replies[3].result.content[0].text).ok, true);
  assert.notEqual(replies[3].result.isError, true);
});

test("verify argument boundaries keep one JSON result and support dash paths", () => {
  const real = realReceipt();
  for (const args of [
    [real.receipt, "--pubkey"],
    [real.receipt, "--pubkey", real.publicKey, "--pubkey", real.publicKey],
    [real.receipt, real.receipt],
    [real.receipt, "--unknown"],
  ]) {
    const result = run(["verify", "--json", ...args]);
    assert.equal(result.code, 2, result.out);
    assert.equal(JSON.parse(result.out).code, "invalid_arguments");
  }
  const empty = run(["verify", "--json"]);
  assert.equal(empty.code, 2, empty.out);
  assert.equal(JSON.parse(empty.out).message, "usage: seal verify PATH");
  const { spawnSync } = require("node:child_process");
  for (const dash of ["-receipt.json", "--json"]) {
  fs.copyFileSync(real.receipt, path.join(real.dir, dash));
  const result = spawnSync(process.execPath, [CLI, "verify", "--json", "--pubkey", real.publicKey, "--", dash], {
    cwd: real.dir, encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(JSON.parse(result.stdout).ok, true);
  }
});
