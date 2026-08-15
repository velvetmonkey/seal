// SPDX-License-Identifier: Apache-2.0
// Destructive negative control for roadmap step 2.
//
// This copies the real runnable product into an isolated directory, physically
// breaks contract.retry(), then drives both public consumers through their real
// child-process paths. The test must fail if either consumer can still approve.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync, spawn } = require("node:child_process");
const test = require("node:test");

const ROOT = path.join(__dirname, "..");

function tempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function copyRunnableProduct(destination) {
  for (const name of ["bin", "contract", "spine"]) {
    fs.cpSync(path.join(ROOT, name), path.join(destination, name), { recursive: true });
  }
  for (const name of ["VERSION", "package.json", "runtime-manifest.json"]) {
    fs.copyFileSync(path.join(ROOT, name), path.join(destination, name));
  }
}

function breakSharedRetry(productRoot) {
  const file = path.join(productRoot, "contract", "contract.cjs");
  const original = fs.readFileSync(file, "utf8");
  const signature = "  function retry({ tool, args, requestState, inputResponses, projectId: retryProject, serverId: retryServer }) {";
  const replacement = `${signature}\n    throw new Error("STEP2_NEGATIVE_CONTROL: shared approval transition removed");`;
  assert.equal(original.split(signature).length, 2, "the negative control must find exactly one shared retry transition");
  fs.writeFileSync(file, original.replace(signature, replacement));
}

function attach(child) {
  let out = "";
  let err = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { out += chunk; });
  child.stderr.on("data", (chunk) => { err += chunk; });
  return {
    output: () => `${out}${err}`,
    waitForResponse(id) {
      return new Promise((resolve, reject) => {
        const started = Date.now();
        const timer = setInterval(() => {
          for (const line of out.split("\n")) {
            if (!line.trim()) continue;
            try {
              const message = JSON.parse(line);
              if (message.id === id) {
                clearInterval(timer);
                resolve(message);
                return;
              }
            } catch {}
          }
          if (Date.now() - started > 5000) {
            clearInterval(timer);
            reject(new Error(`timed out waiting for response ${id}\n${out}\n${err}`));
          }
        }, 10);
      });
    },
    exit: new Promise((resolve) => child.once("close", (code) => resolve(code))),
  };
}

function waitForMarker(run, marker, ms = 5000) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const timer = setInterval(() => {
      if (run.output().includes(marker)) {
        clearInterval(timer);
        resolve();
      } else if (Date.now() - started > ms) {
        clearInterval(timer);
        reject(new Error(`timed out waiting for ${marker}\n${run.output()}`));
      }
    }, 10);
  });
}

async function runBrokenDemo(productRoot, dir) {
  const child = spawn(process.execPath, [path.join(productRoot, "bin", "seal"), "demo", "--dir", dir], {
    stdio: ["pipe", "pipe", "pipe"],
  });
  const run = attach(child);
  child.stdin.write("y\n");
  await waitForMarker(run, "STEP2_NEGATIVE_CONTROL: shared approval transition removed");
  child.kill("SIGKILL");
  const code = await run.exit;
  return { code, output: run.output() };
}

async function runBrokenProtected(productRoot, dir) {
  const store = path.join(dir, "approvals.journal");
  const receipts = path.join(dir, "receipts");
  const dataFile = path.join(dir, "child", "data.txt");
  const seal = path.join(productRoot, "bin", "seal");
  execFileSync(process.execPath, [seal, "__proxy", "--init-store", "--store", store]);
  const proxy = spawn(process.execPath, [
    seal, "__proxy", "--guard", "demo.mutate", "--store", store,
    "--receipts", receipts, "--", process.execPath, seal, "__demo-server", dataFile,
  ], { stdio: ["pipe", "pipe", "pipe"] });
  const run = attach(proxy);
  proxy.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: {
    name: "demo.mutate", arguments: { line: "negative control" },
  } }) + "\n");
  const opened = await run.waitForResponse(1);
  assert.equal(opened.result?.resultType, "input_required", run.output());
  proxy.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: {
    name: "demo.mutate", arguments: { line: "negative control" },
    requestState: opened.result.requestState,
    inputResponses: { approval: { action: "accept", content: { approve: true } } },
  } }) + "\n");
  await waitForMarker(run, "STEP2_NEGATIVE_CONTROL: shared approval transition removed");
  proxy.kill("SIGKILL");
  const code = await run.exit;
  return { code, output: run.output() };
}

test("the same broken retry transition kills both demo and protected consumers", async (t) => {
  const product = tempDir("seal-step2-broken-product-");
  const demoDir = tempDir("seal-step2-broken-demo-");
  const protectedDir = tempDir("seal-step2-broken-protected-");
  t.after(() => {
    fs.rmSync(product, { recursive: true, force: true });
    fs.rmSync(demoDir, { recursive: true, force: true });
    fs.rmSync(protectedDir, { recursive: true, force: true });
  });

  copyRunnableProduct(product);
  breakSharedRetry(product);

  const demoRun = await runBrokenDemo(product, demoDir);
  assert.notEqual(demoRun.code, 0, demoRun.output);
  const demoOutput = demoRun.output;
  assert.match(demoOutput, /STEP2_NEGATIVE_CONTROL: shared approval transition removed/);

  const protectedRun = await runBrokenProtected(product, protectedDir);
  assert.notEqual(protectedRun.code, 0, protectedRun.output);
  assert.match(protectedRun.output, /STEP2_NEGATIVE_CONTROL: shared approval transition removed/);
});
