#!/usr/bin/env node
// Fail if the demo names an absent checker or one for another receipt version.
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");

const [outputFile, root = process.cwd()] = process.argv.slice(2);
if (!outputFile) {
  console.error("usage: node scripts/check-demo-checker-route.cjs <demo-output> [checkout-root]");
  process.exit(2);
}

const output = fs.readFileSync(outputFile, "utf8");
const checkerRoutes = [...output.matchAll(/\bnode\s+((?:checker\/[A-Za-z0-9._/-]+\.mjs)|(?:[A-Za-z0-9._/-]*seal-receipt[A-Za-z0-9._/-]*\.mjs))\b/g)].map((match) => match[1]);
const receiptPaths = [...output.matchAll(/^receipt written: (.+)$/gm)].map((match) => match[1]);
const publicKeyPaths = [...output.matchAll(/--pubkey\s+"\$\(cat\s+"([^"]+)"\)"/g)].map((match) => match[1]);

function versionOf(value) {
  const match = String(value).match(/(?:^|\/)v([0-9]+)$/);
  return match ? `v${match[1]}` : null;
}

function isFormatMarker(field, value) {
  return typeof value === "string" && /receipt|format|version/i.test(field) && versionOf(value) !== null;
}

function emittedFormat(receipt) {
  const markers = Object.entries(receipt).filter(([field, value]) => isFormatMarker(field, value));
  if (markers.length !== 1) throw new Error(`cannot derive one emitted receipt version; found ${markers.length} format markers`);
  return { field: markers[0][0], value: markers[0][1], version: versionOf(markers[0][1]) };
}

function acceptedFormat(source) {
  const comparisons = [...source.matchAll(/\b[A-Za-z_$][A-Za-z0-9_$]*\.([A-Za-z_$][A-Za-z0-9_$]*)\s*!==\s*("(?:\\.|[^"\\])*")/g)]
    .map((match) => [match[1], JSON.parse(match[2])])
    .filter(([field, value]) => isFormatMarker(field, value));
  if (comparisons.length !== 1) throw new Error(`cannot derive one accepted receipt version; found ${comparisons.length} format checks`);
  return { field: comparisons[0][0], value: comparisons[0][1], version: versionOf(comparisons[0][1]) };
}

async function checkerSource(route) {
  if (route.startsWith("checker/")) {
    const checkerPath = path.join(root, route);
    if (!fs.existsSync(checkerPath)) throw new Error(`repository path does not exist: ${route}`);
    return fs.readFileSync(checkerPath, "utf8");
  }
  const escaped = route.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const url = output.match(new RegExp(`https://[^\\s]+/${escaped}`))?.[0];
  if (!url) throw new Error(`download URL is absent for checker command: ${route}`);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`checker download failed with HTTP ${response.status}: ${url}`);
  return response.text();
}

function runChecker(route, receiptPath, publicKeyPath) {
  return new Promise((resolve) => {
    const checkerPath = path.join(root, route);
    const child = spawn(process.execPath, [checkerPath, receiptPath, "--pubkey", fs.readFileSync(publicKeyPath, "utf8").trim()], {
      cwd: root,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", (error) => resolve({ status: null, stdout, stderr, error }));
    child.on("close", (status) => resolve({ status, stdout, stderr, error: null }));
  });
}

(async () => {
  if (checkerRoutes.length !== 1) throw new Error(`expected one printed checker command; found ${checkerRoutes.length}`);
  if (receiptPaths.length === 0) throw new Error("demo output names no written receipt");
  if (publicKeyPaths.length !== 1) throw new Error(`expected one printed checker public key; found ${publicKeyPaths.length}`);
  const receipt = JSON.parse(fs.readFileSync(receiptPaths[receiptPaths.length - 1], "utf8"));
  const emitted = emittedFormat(receipt);
  const accepted = acceptedFormat(await checkerSource(checkerRoutes[0]));
  if (emitted.version !== accepted.version) {
    throw new Error(`receipt version mismatch: demo emits ${emitted.field}=${JSON.stringify(emitted.value)} (${emitted.version}); ${checkerRoutes[0]} accepts ${accepted.field}=${JSON.stringify(accepted.value)} (${accepted.version})`);
  }
  const checked = await runChecker(checkerRoutes[0], receiptPaths[receiptPaths.length - 1], publicKeyPaths[0]);
  if (checked.error || checked.status !== 0) {
    const detail = checked.error ? checked.error.message : (checked.stderr || checked.stdout).trim();
    throw new Error(`named checker failed with ${checked.error ? "an error" : `exit ${checked.status}`}: ${detail}`);
  }
  console.log(`PASS demo checker route: ${checkerRoutes[0]} accepts emitted ${emitted.version}`);
})().catch((error) => {
  console.error(`FAIL demo checker route: ${error.message}`);
  process.exitCode = 1;
});
