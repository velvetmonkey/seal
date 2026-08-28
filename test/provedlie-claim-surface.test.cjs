// SPDX-License-Identifier: Apache-2.0
// Standing rule "proven means strict", ruled 2026-08-27.
// Declaration: the exact assertions lock only the last line of `seal demo` stdout and the
// first README line matching /^authorization rule /. They do not cover demo
// stdout non-last lines, extra README lines, docs/assurance/architecture.md,
// docs/assurance/RELEASE-NOTES-*.md, `seal --help` output, checker output, or
// receipt fields. This control deliberately does not
// scan prose; those surfaces are a declared queue item, not covered here.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const test = require("node:test");

const ROOT = path.join(__dirname, "..");
const SEAL = path.join(ROOT, "bin", "seal");
const EXPECTED_DEMO_CLOSING_LINE = "authorization rule tested; product state and forwarding tested; client and machine trusted.";
const EXPECTED_README_LINE = "The decision rule is proved. The product seam and state machine are tested. The client and machine remain trusted.";

function assertExactSurfaces(output, readme) {
  const closingLine = output.trimEnd().split("\n").at(-1);
  assert.equal(closingLine, EXPECTED_DEMO_CLOSING_LINE, "seal demo closing line changed");
  const readmeLine = readme.match(/^The decision rule [^\n]+$/mu)?.[0];
  assert.equal(readmeLine, EXPECTED_README_LINE, "README must carry the banked proved/tested/trusted sentence");
}

function runDemo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "seal-provedlie-control-"));
  try {
    const output = execFileSync(process.execPath, [SEAL, "demo", "--dir", dir], {
      cwd: ROOT, input: "y\n", encoding: "utf8", stdio: ["pipe", "pipe", "pipe"],
    });
    return { output };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test("the two exact authorization claim surfaces stay aligned", () => {
  const { output } = runDemo();
  assertExactSurfaces(output, fs.readFileSync(path.join(ROOT, "README.md"), "utf8"));
});

test("the two exact surfaces go red when physically tampered", () => {
  const { output } = runDemo();
  const readme = fs.readFileSync(path.join(ROOT, "README.md"), "utf8");

  const tamperedOutput = output.replace(EXPECTED_DEMO_CLOSING_LINE, "authorization rule proved; product state and forwarding tested; client and machine trusted.");
  assert.throws(() => assertExactSurfaces(tamperedOutput, readme), /seal demo closing line changed/);
  console.log("RED demo closing line tamper: seal demo closing line changed");

  const tamperedReadme = readme.replace(EXPECTED_README_LINE, "The decision rule is tested. The product seam and state machine are tested. The client and machine remain trusted.");
  assert.throws(() => assertExactSurfaces(output, tamperedReadme), /README must carry the banked proved\/tested\/trusted sentence/);
  console.log("RED README assurance line tamper: banked proved/tested/trusted sentence changed");
});
