// SPDX-License-Identifier: Apache-2.0
//
// The Claude Code evidence checker, in both directions.
//
// A checker that only accepts is not a checker, and a checker that only
// refuses is useless. These tests build one real pack with the SYNTHETIC
// stand-in run — no Claude Code, no human — then show the checker accepting
// it and refusing it by name once each fact it rests on is broken.
//
// They also hold the fences that keep the synthetic pack from ever being
// mistaken for a real client run, and the fence that keeps a fabricated pack
// out of this repository.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const ROOT = path.join(__dirname, "..");
const CHECKER = path.join(ROOT, "scripts", "check-cc-evidence.mjs");
const SYNTHETIC_RUN = path.join(ROOT, "harness", "claude-code", "synthetic-run.cjs");
const EVIDENCE_ROOT = path.join(ROOT, "evidence", "claude-code");
const CLAUDE_CODE_DOC = path.join(ROOT, "docs", "CLAUDE-CODE-EVIDENCE.md");
const UNTESTED_ROW = "UNTESTED — real Claude Code call not observed";

let sharedPack = null;

// One synthetic run serves every test in this file: it installs the built
// artifact, protects a fixture server, drives the whole eight-case walk with
// the stand-in client and writes a pack.
function pack() {
  if (sharedPack) return sharedPack;
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "seal-cc-evidence-"));
  const runDir = path.join(workspace, "run");
  const built = spawnSync(process.execPath, [SYNTHETIC_RUN, "--run-dir", runDir], { encoding: "utf8" });
  assert.equal(built.status, 0, `synthetic run failed:\n${built.stdout}\n${built.stderr}`);
  const evidence = path.join(runDir, "pack", "evidence");
  const client = fs.readdirSync(path.join(evidence, "claude-code"))[0];
  const platform = "linux-x64";
  const artifact = fs.readdirSync(path.join(evidence, "claude-code", client, platform))[0];
  sharedPack = {
    workspace,
    evidence,
    dir: path.join(evidence, "claude-code", client, platform, artifact),
    artifact,
    manifest: JSON.parse(fs.readFileSync(path.join(evidence, "claude-code", client, platform, artifact, "manifest.json"), "utf8")),
  };
  return sharedPack;
}

// Each refusal test works on its own copy, so one broken pack cannot leak
// into another test's evidence.
function copyOfPack() {
  const original = pack();
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "seal-cc-copy-"));
  fs.cpSync(original.evidence, path.join(workspace, "evidence"), { recursive: true });
  const relative = path.relative(original.evidence, original.dir);
  const dir = path.join(workspace, "evidence", relative);
  return {
    dir,
    manifestPath: path.join(dir, "manifest.json"),
    manifest: () => JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8")),
    rewriteManifest(edit) {
      const manifest = this.manifest();
      edit(manifest);
      fs.writeFileSync(path.join(dir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    },
  };
}

function check(args) {
  const result = spawnSync(process.execPath, [CHECKER, ...args], { encoding: "utf8" });
  return { code: result.status, out: `${result.stdout}${result.stderr}` };
}

function rehash(copy, name) {
  const bytes = fs.readFileSync(path.join(copy.dir, name));
  copy.rewriteManifest((manifest) => {
    const entry = manifest.files.find((file) => file.path === name);
    entry.sha256 = require("node:crypto").createHash("sha256").update(bytes).digest("hex");
    entry.bytes = bytes.length;
  });
}

function promotedSyntheticPack() {
  const copy = copyOfPack();
  fs.rmSync(path.join(copy.dir, "SYNTHETIC-NOT-A-REAL-RUN.txt"));
  copy.rewriteManifest((manifest) => {
    manifest.files = manifest.files.filter((entry) => entry.path !== "SYNTHETIC-NOT-A-REAL-RUN.txt");
    manifest.synthetic = false;
    delete manifest.synthetic_banner;
    manifest.client.name = "claude-code";
    manifest.client.version = "9.9.9";
    manifest.client.version_output = "9.9.9 (Claude Code)";
    manifest.label = `Claude Code 9.9.9 integration:\nPASS — manually exercised on Linux x86-64 against artifact sha256 ${manifest.artifact.sha256}\nNot automated in CI.`;
  });
  const correctlyNamed = path.join(path.dirname(path.dirname(path.dirname(copy.dir))), "9.9.9", "linux-x64", pack().artifact);
  fs.mkdirSync(path.dirname(correctlyNamed), { recursive: true });
  fs.renameSync(copy.dir, correctlyNamed);
  copy.dir = correctlyNamed;
  return copy;
}

test("the checker ACCEPTS a correct pack", () => {
  const correct = pack();
  const result = check([correct.dir, "--allow-synthetic"]);
  assert.equal(result.code, 0, result.out);
  for (const caseId of ["activation", "negotiation", "approval_shown", "before_approval", "accept", "decline", "missing_launcher", "unprotect"]) {
    assert.match(result.out, new RegExp(`^OK\\s+${caseId}: OBSERVED`, "m"), `${caseId} was not accepted:\n${result.out}`);
  }
  assert.match(result.out, /^OK\s+the child log carries exactly one child call/m);
  assert.match(result.out, /1 pack\(s\), 1 accepted, 0 refused/);
});

test("the checker refuses a manifest whose file hash does not match", () => {
  const copy = copyOfPack();
  fs.appendFileSync(path.join(copy.dir, "child.jsonl"), `${JSON.stringify({ kind: "child-call", tool: "append_note" })}\n`);
  const result = check([copy.dir, "--allow-synthetic"]);
  assert.equal(result.code, 1, result.out);
  assert.match(result.out, /^REFUSE evidence_file_digest_mismatch: child\.jsonl is sha256 [0-9a-f]{64}, not the recorded [0-9a-f]{64}$/m, result.out);
});

test("the checker refuses a manifest naming the wrong artifact", () => {
  const correct = pack();
  const other = "0".repeat(64);
  const result = check([correct.dir, "--allow-synthetic", "--artifact-sha256", other]);
  assert.equal(result.code, 1, result.out);
  assert.match(
    result.out,
    new RegExp(`^REFUSE artifact_mismatch: manifest names artifact sha256 ${correct.artifact}, not the release artifact ${other}$`, "m"),
    result.out,
  );
});

test("the checker refuses a manifest referencing a file that is absent", () => {
  const copy = copyOfPack();
  fs.rmSync(path.join(copy.dir, "terminal.cast"));
  const result = check([copy.dir, "--allow-synthetic"]);
  assert.equal(result.code, 1, result.out);
  assert.match(result.out, /^REFUSE evidence_file_absent: manifest names terminal\.cast, which is not present in the pack$/m, result.out);
});

test("the checker refuses evidence added beside the manifest", () => {
  const copy = copyOfPack();
  fs.writeFileSync(path.join(copy.dir, "extra-evidence.txt"), "added after the run\n");
  const result = check([copy.dir, "--allow-synthetic"]);
  assert.equal(result.code, 1, result.out);
  assert.match(result.out, /^REFUSE evidence_file_unrecorded: extra-evidence\.txt is in the pack but the manifest records no hash for it$/m, result.out);
});

test("the checker refuses a pack whose reported call count its own child log contradicts", () => {
  const copy = copyOfPack();
  copy.rewriteManifest((manifest) => {
    manifest.observed.find((entry) => entry.case === "accept").facts.child_call_records_total = 2;
  });
  const result = check([copy.dir, "--allow-synthetic"]);
  assert.equal(result.code, 1, result.out);
  assert.match(result.out, /^REFUSE child_call_count_disagrees: the manifest reports 2 child call\(s\) but child\.jsonl carries 1 child-call record\(s\)$/m, result.out);
});

test("the checker refuses a softened case requirement and a forged label", () => {
  const softened = copyOfPack();
  softened.rewriteManifest((manifest) => {
    manifest.observed.find((entry) => entry.case === "accept").required = "Child call count becomes at least 1";
  });
  const softenedResult = check([softened.dir, "--allow-synthetic"]);
  assert.equal(softenedResult.code, 1, softenedResult.out);
  assert.match(softenedResult.out, /^REFUSE case_requirement_altered: accept records the requirement/m, softenedResult.out);

  const forged = copyOfPack();
  forged.rewriteManifest((manifest) => {
    manifest.observed.find((entry) => entry.case === "decline").result = "NOT OBSERVED";
  });
  const forgedResult = check([forged.dir, "--allow-synthetic"]);
  assert.equal(forgedResult.code, 1, forgedResult.out);
  assert.match(forgedResult.out, /^REFUSE case_not_observed: decline is recorded as "NOT OBSERVED", not OBSERVED$/m, forgedResult.out);
  assert.match(forgedResult.out, /^REFUSE label_mismatch: /m, forgedResult.out);
});

test("a synthetic pack can never discharge a release", () => {
  const correct = pack();
  const released = check([correct.dir, "--release", "--artifact-sha256", correct.artifact]);
  assert.equal(released.code, 1, released.out);
  assert.match(released.out, /^REFUSE synthetic_pack_in_release_evidence: /m, released.out);

  // …and it is not checked by accident either: naming it takes a flag.
  const unflagged = check([correct.dir]);
  assert.equal(unflagged.code, 1, unflagged.out);
  assert.match(unflagged.out, /^REFUSE synthetic_pack_not_permitted: /m, unflagged.out);
});

test("stripping one synthetic marker does not launder a synthetic pack", () => {
  const undeclared = copyOfPack();
  undeclared.rewriteManifest((manifest) => { manifest.synthetic = false; });
  const undeclaredResult = check([undeclared.dir, "--release", "--artifact-sha256", pack().artifact]);
  assert.equal(undeclaredResult.code, 1, undeclaredResult.out);
  assert.match(undeclaredResult.out, /^REFUSE synthetic_marker_conflict: /m, undeclaredResult.out);
  assert.match(undeclaredResult.out, /^REFUSE synthetic_pack_in_release_evidence: /m, undeclaredResult.out);

  // The marker file alone is enough, even with every other trace removed.
  const scrubbed = copyOfPack();
  scrubbed.rewriteManifest((manifest) => {
    manifest.synthetic = false;
    delete manifest.synthetic_banner;
    manifest.client.version = "9.9.9";
    manifest.client.version_output = "9.9.9 (Claude Code)";
    manifest.environment.recordings = [];
  });
  const scrubbedResult = check([scrubbed.dir, "--release", "--artifact-sha256", pack().artifact]);
  assert.equal(scrubbedResult.code, 1, scrubbedResult.out);
  assert.match(scrubbedResult.out, /SYNTHETIC-NOT-A-REAL-RUN\.txt/, scrubbedResult.out);
});

test("the frisk's exact synthetic promotion is refused by fixture-observed process provenance", () => {
  const promoted = promotedSyntheticPack();
  const result = check([promoted.dir, "--release", "--artifact-sha256", pack().artifact]);
  assert.equal(result.code, 1, result.out);
  assert.match(result.out, /^REFUSE synthetic_marker_conflict: this pack carries synthetic evidence \(fixture-observed stand-in process: true,/m, result.out);
  assert.match(result.out, /^REFUSE synthetic_pack_in_release_evidence: /m, result.out);
  assert.doesNotMatch(result.out, /^Claude Code 9\.9\.9 integration:$/m, result.out);
});

test("a rehashed self-consistent tail truncation contradicts the separate boundary commitment", () => {
  const copy = copyOfPack();
  const childPath = path.join(copy.dir, "child.jsonl");
  const raw = fs.readFileSync(childPath);
  const finalLine = raw.lastIndexOf(0x0a, raw.length - 2) + 1;
  fs.writeFileSync(childPath, raw.subarray(0, finalLine + 7));
  rehash(copy, "child.jsonl");
  const result = check([copy.dir, "--allow-synthetic"]);
  assert.equal(result.code, 1, result.out);
  assert.match(result.out, /^REFUSE child_log_truncated: child\.jsonl does not end at a newline-delimited record boundary$/m, result.out);
  assert.match(result.out, /^REFUSE child_log_malformed: child\.jsonl record \d+ is not valid JSON$/m, result.out);
  assert.match(result.out, /^REFUSE child_log_commitment_mismatch: /m, result.out);
});

test("the checker refuses a pack filed under a path that contradicts its manifest", () => {
  const copy = copyOfPack();
  const misfiled = path.join(path.dirname(copy.dir), "f".repeat(64));
  fs.renameSync(copy.dir, misfiled);
  const result = check([misfiled, "--allow-synthetic"]);
  assert.equal(result.code, 1, result.out);
  assert.match(result.out, /^REFUSE pack_path_mismatch: the manifest names artifact sha256 [0-9a-f]{64} but the pack sits under f{64}$/m, result.out);
});

test("a release refuses evidence counted by a fixture this tree no longer ships", () => {
  const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), "seal-cc-fixture-drift-"));
  const fixture = path.join(elsewhere, "harness", "claude-code");
  fs.mkdirSync(fixture, { recursive: true });
  fs.writeFileSync(path.join(fixture, "fixture-server.cjs"), "// a different instrument\n");
  const result = check([pack().dir, "--release", "--artifact-sha256", pack().artifact, "--repo-root", elsewhere]);
  assert.equal(result.code, 1, result.out);
  assert.match(result.out, /^REFUSE fixture_revision_mismatch: harness\/claude-code\/fixture-server\.cjs in this tree is sha256 /m, result.out);
});

test("a release with no evidence pack reports the untested state instead of passing", () => {
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), "seal-cc-empty-"));
  const result = check([path.join(empty, "claude-code"), "--release", "--artifact-sha256", "a".repeat(64)]);
  assert.equal(result.code, 0, result.out);
  assert.match(result.out, /^Claude Code integration: UNTESTED — real Claude Code call not observed$/m, result.out);
});

test("a pack recorded against another artifact neither passes nor fails this release", () => {
  const correct = pack();
  const result = check([path.join(correct.evidence, "claude-code"), "--release", "--artifact-sha256", "b".repeat(64)]);
  assert.equal(result.code, 0, result.out);
  assert.match(result.out, /^SKIP\s+records artifact sha256 [0-9a-f]{64}, not the release artifact$/m, result.out);
  assert.match(result.out, /^Claude Code integration: UNTESTED — real Claude Code call not observed$/m, result.out);
});

// The fence. A pack in this tree is a claim that a human ran the acceptance
// walk. No agent and no automated change may add one: adding a real pack is
// the act of the person who performed the run, and it must break this test
// so that it cannot happen quietly.
test("this repository ships no Claude Code evidence pack while the row is untested", () => {
  const packs = [];
  const walk = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory()) walk(path.join(directory, entry.name));
      else if (entry.name === "manifest.json") packs.push(path.join(directory, entry.name));
    }
  };
  if (fs.existsSync(EVIDENCE_ROOT)) walk(EVIDENCE_ROOT);
  assert.deepEqual(packs, [], [
    "An evidence pack appeared under evidence/claude-code/.",
    "That is a claim that a named Claude Code version was exercised by a human.",
    "If that run really happened, the person who performed it replaces this test",
    "with one that runs scripts/check-cc-evidence.mjs over the committed pack and",
    "updates the Claude Code row in docs/CLAUDE-CODE-EVIDENCE.md in the same commit.",
  ].join("\n"));
});

test("the Claude Code row stays untested until a checked pack exists", () => {
  const document = fs.readFileSync(CLAUDE_CODE_DOC, "utf8");
  assert.ok(document.includes(UNTESTED_ROW), `docs/CLAUDE-CODE-EVIDENCE.md must carry the row "${UNTESTED_ROW}"`);
  assert.ok(
    !document.includes("| Claude Code | PASS"),
    "the Claude Code row may only claim PASS from a pack the checker accepts",
  );
});

test.after(() => {
  // The installed store is deliberately read-only; make it writable to clean up.
  if (!sharedPack) return;
  spawnSync("chmod", ["-R", "u+w", sharedPack.workspace]);
  fs.rmSync(sharedPack.workspace, { recursive: true, force: true });
});
