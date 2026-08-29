// SPDX-License-Identifier: Apache-2.0
// Act 4: the same-resource blind-spot witness and internal-harness controls.
//
// The witness proof reads FILES, not stdout: the protected resource must have
// both the server line and the direct-write line, while the receipts directory
// and the protected server's own count remain unchanged by that second line.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn, execFileSync, spawnSync } = require("node:child_process");
const test = require("node:test");

const ROOT = path.join(__dirname, "..");
const SEAL = path.join(__dirname, "..", "bin", "seal");

// Match the repository's existing path.relative(ROOT, ...) convention used by
// output and inventory diagnostics: semantic output assertions must not depend
// on the checkout's absolute filesystem location.
function repositoryRelativeOutput(text) {
  // A sibling temporary directory can share ROOT's textual prefix without
  // being inside the checkout.
  return text.replaceAll(`${ROOT}${path.sep}`, `.${path.sep}`);
}

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

test("Act 4: the protected resource changes while the server count and Seal decisions do not", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "seal-witness-"));
  const child = spawn(process.execPath, [SEAL, "demo", "--dir", dir], { stdio: ["pipe", "pipe", "pipe"] });
  const run = attach(child);
  t.after(run.kill);
  await run.waitFor(/Approve\? \[y\/N\]/);
  child.stdin.write("y\n");
  const code = await run.exit;
  run.out = repositoryRelativeOutput(run.out);
  run.err = repositoryRelativeOutput(run.err);
  assert.equal(code, 0, run.out + run.err);

  // Printed witness, in the specified shape.
  assert.match(run.out, /OUTSIDE THE SEAL PATH/);
  assert.match(run.out, /Writing directly to .*child\/data\.txt without calling the MCP server\.\.\./);
  assert.match(run.out, /File changed: yes/);
  assert.match(run.out, /Protected-server call count: still 1/);
  assert.match(run.out, /New Seal decisions: 0/);
  assert.match(run.out, /Seal did not observe or authorise this write\./);
  assert.match(run.out, /The separately landed v2 checker replays the recorded kernel decision and reports five rows; a signature alone cannot establish that the event happened\./);
  assert.doesNotMatch(run.out, /separate external checker/, "demo must not call the checker external");
  assert.match(run.out, /From the checkout root: node checker\/seal-receipt-v2\.mjs/, "demo must name the v2 checker path inside the source checkout");
  assert.doesNotMatch(run.out, /same release page/, "demo must not promise an unpublished release asset");
  assert.doesNotMatch(run.out, /https:\/\/velvetmonkey\.github\.io\/seal-check\//, "demo must not advertise the incompatible browser checker");

  // FILE evidence 1: the proxy emitted nothing for it — the receipts
  // directory holds exactly the three gate decisions and no more.
  const receiptFiles = fs.readdirSync(path.join(dir, "receipts")).sort();
  assert.equal(receiptFiles.length, 3, receiptFiles.join(","));
  const decisions = receiptFiles.map((f) => JSON.parse(fs.readFileSync(path.join(dir, "receipts", f), "utf8")).action).sort();
  assert.deepEqual(decisions, ["ALLOW", "BLOCK", "INPUT_REQUIRED"]);
  for (const f of receiptFiles) {
    const receipt = JSON.parse(fs.readFileSync(path.join(dir, "receipts", f), "utf8"));
    assert.equal(receipt.tool, "demo.mutate", "every receipt belongs to the protected MCP call");
  }

  // FILE evidence 2: the direct write did not go through the child.
  assert.equal(fs.readFileSync(path.join(dir, "child", "data.txt.count"), "utf8").trim(), "1");

  // FILE evidence 3: the SAME protected resource genuinely has both writes.
  const sameCallClaim = "Seal makes the approved call and the executed call the same call: same tool,";
  const allowedReceipt = receiptFiles
    .map((f) => JSON.parse(fs.readFileSync(path.join(dir, "receipts", f), "utf8")))
    .find((receipt) => receipt.action === "ALLOW");
  const dataLines = fs.readFileSync(path.join(dir, "child", "data.txt"), "utf8").trimEnd().split("\n");
  assert.equal(dataLines[0], allowedReceipt.arguments.line, sameCallClaim); // CLAIM-COVERAGE: docs/guide/knowing-it-worked.md
  assert.equal(dataLines[1], "seal demo wrote this line directly");
  assert.equal(dataLines.length, 2, "the same resource must contain exactly the protected and direct writes");

  // Four observed child counts on the way: 0, still 0 at the dialog, 1, still 1.
  assert.match(run.out, /child calls observed: 0 \(read from /);
  assert.match(run.out, /child calls observed: still 0 \(read from /);
  assert.match(run.out, /child calls observed: 1 \(read from /);
  assert.match(run.out, /child calls observed: still 1 \(read from /);

  // Output discipline: no verification claims anywhere.
  assert.doesNotMatch(run.out, new RegExp(["PASS", "VERIFIED"].join(" ")));
  assert.doesNotMatch(run.out, /verif/i);
});

test("demo checker route control rejects an absent path and a receipt-version mismatch", () => {
  const outputFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "seal-demo-route-control-")), "demo.txt");
  const demo = runSeal(["demo", "--dir", path.dirname(outputFile)], "y\n");
  assert.equal(demo.code, 0, demo.out + demo.err);
  fs.writeFileSync(outputFile, demo.out);
  const control = path.join(ROOT, "scripts", "check-demo-checker-route.cjs");
  const green = spawnSync(process.execPath, [control, outputFile, ROOT], { encoding: "utf8" });
  assert.equal(green.status, 0, green.stdout + green.stderr);
  assert.match(green.stdout, /PASS demo checker route: checker\/seal-receipt-v2\.mjs accepts emitted v2/);

  const throwingRoot = fs.mkdtempSync(path.join(os.tmpdir(), "seal-demo-route-throwing-checker-"));
  fs.mkdirSync(path.join(throwingRoot, "checker"));
  fs.copyFileSync(path.join(ROOT, "checker", "seal-receipt-v2.mjs"), path.join(throwingRoot, "checker", "seal-receipt-v2.mjs"));
  fs.writeFileSync(path.join(throwingRoot, "checker", "seal-receipt-v2.mjs"), 'throw new Error("physical tamper");\n' + fs.readFileSync(path.join(throwingRoot, "checker", "seal-receipt-v2.mjs"), "utf8"));
  const throwing = spawnSync(process.execPath, [control, outputFile, throwingRoot], { encoding: "utf8" });
  assert.notEqual(throwing.status, 0, throwing.stdout + throwing.stderr);
  assert.match(throwing.stderr, /FAIL demo checker route: named checker failed with exit 1:/);

  const tampered = demo.out.replace("checker/seal-receipt-v2.mjs", "checker/does-not-exist.mjs");
  fs.writeFileSync(outputFile, tampered);
  const red = spawnSync(process.execPath, [control, outputFile, ROOT], { encoding: "utf8" });
  assert.notEqual(red.status, 0, red.stdout + red.stderr);
  assert.match(red.stderr, /FAIL demo checker route: repository path does not exist: checker\/does-not-exist\.mjs/);

  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "seal-demo-route-version-"));
  fs.mkdirSync(path.join(fixtureRoot, "checker"));
  fs.writeFileSync(path.join(fixtureRoot, "checker", "seal-receipt-v1.mjs"), 'if (receipt.receipt !== "seal.spine/v1") throw new Error("unknown format");\n');
  fs.writeFileSync(outputFile, demo.out.replace("checker/seal-receipt-v2.mjs", "checker/seal-receipt-v1.mjs"));
  const mismatch = spawnSync(process.execPath, [control, outputFile, fixtureRoot], { encoding: "utf8" });
  assert.notEqual(mismatch.status, 0, mismatch.stdout + mismatch.stderr);
  assert.match(mismatch.stderr, /FAIL demo checker route: receipt version mismatch: demo emits seal_receipt="v2" \(v2\); checker\/seal-receipt-v1\.mjs accepts receipt="seal\.spine\/v1" \(v1\)/);
});

test("Act 4 appears after replay refusal and before the final screen", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "seal-witness-order-"));
  const result = runSeal(["demo", "--dir", dir], "y\n");
  assert.equal(result.code, 0, result.out + result.err);

  const replayAt = result.out.indexOf("one-use held:");
  const act4At = result.out.indexOf("OUTSIDE THE SEAL PATH");
  const finalScreenAt = result.out.indexOf("ENFORCED");
  assert.ok(replayAt >= 0, "demo output must include the replay refusal");
  assert.ok(act4At > replayAt, "Act 4 must follow the replay refusal");
  assert.ok(finalScreenAt > act4At, "the final screen must follow Act 4");
  assert.ok(result.out.endsWith("authorization rule tested; product state and forwarding tested; client and machine trusted.\n"));
});

// --- the internal-harness controls ------------------------------------------

test("seal client and seal demo-client fail as unknown commands", () => {
  for (const command of ["client", "demo-client"]) {
    const result = runSeal([command]);
    assert.equal(result.code, 2, `${command}: ${result.out}${result.err}`);
    assert.match(result.err, new RegExp(`unknown command: ${command}`));
    assert.doesNotMatch(result.out + result.err, /OUTSIDE THE SEAL PATH|INPUT REQUIRED/);
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
