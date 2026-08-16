// SPDX-License-Identifier: Apache-2.0
// Step 3A: the scope witness and the internal-harness controls.
//
// The witness proof reads FILES, not stdout: the direct write must exist on
// disk, the receipts directory must hold exactly the gate's decisions and
// none for the write, and the child's own count file must be untouched.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn, execFileSync } = require("node:child_process");
const test = require("node:test");

const SEAL = path.join(__dirname, "..", "bin", "seal");

function runSeal(args, input) {
  try {
    return { code: 0, out: execFileSync(process.execPath, [SEAL, ...args], { input: input ?? "", encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }), err: "" };
  } catch (error) {
    return { code: error.status, out: error.stdout || "", err: error.stderr || "" };
  }
}

function attach(child) {
  const state = { out: "", err: "", exit: new Promise((resolve) => child.once("close", (code) => resolve(code))), kill: () => { try { child.kill("SIGKILL"); } catch {} } };
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { state.out += chunk; });
  child.stderr.on("data", (chunk) => { state.err += chunk; });
  state.waitFor = (pattern, ms = 15000) => new Promise((resolve, reject) => {
    const started = Date.now();
    const poll = setInterval(() => {
      if (pattern.test(state.out)) { clearInterval(poll); resolve(); }
      else if (Date.now() - started > ms) { clearInterval(poll); reject(new Error(`timed out waiting for ${pattern}\n${state.out}\n${state.err}`)); }
    }, 25);
  });
  return state;
}

// --- the scope witness ------------------------------------------------------

test("the scope witness: the direct write happened and the proxy emitted zero decisions for it", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "seal-witness-"));
  const child = spawn(process.execPath, [SEAL, "demo", "--dir", dir], { stdio: ["pipe", "pipe", "pipe"] });
  const run = attach(child);
  t.after(run.kill);
  await run.waitFor(/Approve\? \[y\/N\]/);
  child.stdin.write("y\n");
  const code = await run.exit;
  assert.equal(code, 0, run.out + run.err);

  // Printed witness, in the specified shape.
  assert.match(run.out, /SCOPE WITNESS/);
  const pathLine = "demo client -> Seal -> demo MCP server -> demo.mutate";
  const rule = "If a route to the same effect does not pass through the printed Seal path, Seal did not control it.";
  const pathAt = run.out.indexOf(pathLine);
  const ruleAt = run.out.indexOf(rule);
  const directWriteAt = run.out.indexOf("Now the demo performs a harmless direct local write");
  assert.ok(pathAt >= 0, "demo output must print the authority path");
  assert.ok(ruleAt > pathAt, "demo output must print the boundary rule after the authority path");
  assert.ok(directWriteAt > ruleAt, "demo output must print the direct write after the boundary rule");
  assert.match(run.out, /DIRECT WRITE SUCCEEDED/);
  assert.match(run.out, /Seal decisions emitted: 0/);
  assert.match(run.out, /a gate, not a sandbox/);
  assert.match(
    run.out,
    /receipts are claims, not proofs\. Check one with the separate-process checker \(V11-RECEIPT-01\)\. It imports no Seal module at check time, but carries a byte-identical copy of Seal's canonicalisation rule and uses the same Node crypto platform\. It can detect a changed receipt against your trusted key; it cannot detect a defect shared by that rule or platform\. It ships in this same artifact, so it also cannot protect against a replaced artifact:/,
    "demo must state the runtime/process boundary, copied canonicalisation and shared crypto limit, and same-artifact limit",
  );
  assert.doesNotMatch(run.out, /separate external checker/, "demo must not call its same-artifact checker external");
  assert.match(run.out, /https:\/\/velvetmonkey\.github\.io\/seal-check\//, "demo must name the online browser instrument beside the checker command");
  assert.match(run.out, /does not establish that this setup routes calls through Seal/, "demo must state the online page's setup limit");

  // FILE evidence 1: the write really happened, outside the gate.
  const outside = fs.readFileSync(path.join(dir, "outside.txt"), "utf8");
  assert.match(outside, /without crossing the Seal gate/);

  // FILE evidence 2: the proxy emitted nothing for it — the receipts
  // directory holds exactly the three gate decisions and no more.
  const receiptFiles = fs.readdirSync(path.join(dir, "receipts")).sort();
  assert.equal(receiptFiles.length, 3, receiptFiles.join(","));
  const decisions = receiptFiles.map((f) => JSON.parse(fs.readFileSync(path.join(dir, "receipts", f), "utf8")).decision).sort();
  assert.deepEqual(decisions, ["ALLOW", "BLOCK", "INPUT_REQUIRED"]);
  for (const f of receiptFiles) {
    const receipt = JSON.parse(fs.readFileSync(path.join(dir, "receipts", f), "utf8"));
    assert.equal(receipt.tool, "demo.mutate", "no receipt may name the outside write");
  }

  // FILE evidence 3: the write did not go through the child.
  assert.equal(fs.readFileSync(path.join(dir, "child", "data.txt.count"), "utf8").trim(), "1");
  assert.doesNotMatch(fs.readFileSync(path.join(dir, "child", "data.txt"), "utf8"), /without crossing/);

  // Four observed child counts on the way: 0, still 0 at the dialog, 1, still 1.
  assert.match(run.out, /child calls observed: 0 \(read from /);
  assert.match(run.out, /child calls observed: still 0 \(read from /);
  assert.match(run.out, /child calls observed: 1 \(read from /);
  assert.match(run.out, /child calls observed: still 1 \(read from /);

  // Output discipline: no verification claims anywhere.
  assert.doesNotMatch(run.out, new RegExp(["PASS", "VERIFIED"].join(" ")));
  assert.doesNotMatch(run.out, /verif/i);
});

test("the scope rule appears between the printed path and the direct write", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "seal-witness-order-"));
  const result = runSeal(["demo", "--dir", dir], "y\n");
  assert.equal(result.code, 0, result.out + result.err);

  const pathAt = result.out.indexOf("demo client -> Seal -> demo MCP server -> demo.mutate");
  const ruleAt = result.out.indexOf("If a route to the same effect does not pass through the printed Seal path, Seal did not control it.");
  const directWriteAt = result.out.indexOf("Now the demo performs a harmless direct local write");
  assert.ok(pathAt >= 0, "demo output must print the authority path");
  assert.ok(ruleAt > pathAt, "demo output must print the boundary rule after the authority path");
  assert.ok(directWriteAt > ruleAt, "demo output must print the direct write after the boundary rule");
});

// --- the internal-harness controls ------------------------------------------

test("seal client and seal demo-client fail as unknown commands", () => {
  for (const command of ["client", "demo-client"]) {
    const result = runSeal([command]);
    assert.equal(result.code, 2, `${command}: ${result.out}${result.err}`);
    assert.match(result.err, new RegExp(`unknown command: ${command}`));
    assert.doesNotMatch(result.out + result.err, /SCOPE WITNESS|INPUT REQUIRED/);
  }
});

test("the demo harness accepts no server, URI, transport or configuration", () => {
  for (const args of [["demo", "--server", "http://x"], ["demo", "--transport", "tcp"], ["demo", "node", "evil.js"]]) {
    const result = runSeal(args);
    assert.notEqual(result.code, 0, args.join(" "));
    assert.match(result.err, /accepts only --dir PATH/);
  }
});

test("the public command surface inventory lists only public commands and nothing hidden in help", () => {
  const help = runSeal([]);
  assert.equal(help.code, 0);
  const listed = [...help.out.matchAll(/^  seal ([a-z-]+)/gm)].map((m) => m[1]).sort();
  assert.deepEqual(listed, ["demo", "doctor", "protect", "status", "unprotect", "verify"], help.out);
  assert.doesNotMatch(help.out, /__/, "private subcommands must be absent from help");
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8"));
  assert.deepEqual(Object.keys(pkg.bin), ["seal"], "one binary, no harness export");
  assert.equal(pkg.exports, undefined, "no package exports expose the harness");
});
