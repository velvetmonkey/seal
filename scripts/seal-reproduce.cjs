#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const SCHEMA = "seal.artifact-kernel-correspondence/v1";
const LIMIT = "This result covers only the selected artifact's kernel bytes. It is not a proof that the rule is the right rule, and it does not establish independence when the rebuilder and the publisher are the same authority.";
const NATIVE_HELPER_PROVENANCE = "release-produced, not independently reproduced";
const LEAN_LAUNCHER_ENV = "SEAL_LEAN_LAUNCHER";
const TAG_PATTERN = /^v\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const SOURCE_PINS = Object.freeze({
  "v0.2.0": Object.freeze({
    repository: "https://github.com/velvetmonkey/seal-host.git",
    commit: "d1af738b1f17966a18d7f86c51392b5cd3b8b0a1",
  }),
  "v0.2.0-rc.3": Object.freeze({
    repository: "https://github.com/velvetmonkey/seal-host.git",
    commit: "d1af738b1f17966a18d7f86c51392b5cd3b8b0a1",
  }),
});

class Refusal extends Error {}

function sha256Bytes(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function sha256File(file) {
  return sha256Bytes(fs.readFileSync(file));
}

function refuse(message) {
  throw new Refusal(message);
}

function emptyReport(tag, authority = "same-authority", platform = "linux-x64") {
  return {
    schema: SCHEMA,
    tag: tag ?? null,
    platform,
    asset: {
      name: tag && TAG_PATTERN.test(tag) ? `seal-${tag}-${platform}` : null,
      declared_sha256: null,
      declared_bytes: null,
      observed_sha256: null,
      observed_bytes: null,
    },
    published_kernel_sha256: null,
    rebuilt_kernel_sha256: null,
    scope: "selected-artifact-kernel-only",
    native_macos_helper: {
      provenance: NATIVE_HELPER_PROVENANCE,
      covered_by_result: false,
    },
    result: "refused",
    authority,
    limit: LIMIT,
  };
}

function parseArguments(argv) {
  let tag;
  let platform = "linux-x64";
  let requestedAuthority = "same-authority";
  let authorityName;
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--authority" || token === "--authority-name" || token === "--platform") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) refuse(`${token} needs a value`);
      if (token === "--authority") requestedAuthority = value;
      else if (token === "--authority-name") authorityName = value;
      else platform = value;
      index += 1;
    } else if (token.startsWith("--")) {
      refuse(`unknown option: ${token}`);
    } else if (tag === undefined) {
      tag = token;
    } else {
      refuse(`unexpected argument: ${token}`);
    }
  }
  if (!tag) refuse("usage: node scripts/seal-reproduce.cjs <tag> [--platform linux-x64] [--authority same-authority|independent] [--authority-name <string>]");
  return { tag, platform, requestedAuthority, authorityName };
}

function parseBuildPinnedArguments(argv) {
  let tag;
  let output;
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--output") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) refuse("--output needs a value");
      output = value;
      index += 1;
    } else if (token.startsWith("--")) {
      refuse(`unknown option: ${token}`);
    } else if (tag === undefined) {
      tag = token;
    } else {
      refuse(`unexpected argument: ${token}`);
    }
  }
  if (!tag || !output) {
    refuse("usage: node scripts/seal-reproduce.cjs build-pinned-kernel <tag> --output <path>");
  }
  if (!TAG_PATTERN.test(tag)) refuse(`release tag is invalid: ${tag}`);
  return { tag, output: path.resolve(output) };
}

function validateRequest(parsed) {
  if (!TAG_PATTERN.test(parsed.tag)) refuse(`release tag is invalid: ${parsed.tag}`);
  if (parsed.platform !== "linux-x64") {
    refuse(`platform ${parsed.platform} selects artifact seal-${parsed.tag}-${parsed.platform}; this tool only checks the linux-x64 artifact kernel`);
  }
  if (!new Set(["same-authority", "independent"]).has(parsed.requestedAuthority)) {
    refuse(`authority is invalid: ${parsed.requestedAuthority}`);
  }
  if (parsed.requestedAuthority === "independent" && !parsed.authorityName?.trim()) {
    refuse("--authority independent requires --authority-name <string>");
  }
  return parsed.requestedAuthority;
}

function readPublishedEntry(checksumsFile, assetName) {
  let text;
  try {
    text = fs.readFileSync(checksumsFile, "utf8");
  } catch (error) {
    refuse(`cannot read SHA256SUMS: ${error.message}`);
  }
  const matches = text.split(/\r?\n/).filter(Boolean).map((line) => line.trim().split(/\s+/))
    .filter((fields) => fields.length === 3 && fields[2] === assetName);
  if (matches.length !== 1 || !/^[0-9a-f]{64}$/.test(matches[0][0]) || !/^\d+$/.test(matches[0][1])) {
    refuse(`SHA256SUMS has no unique valid three-field entry for ${assetName}`);
  }
  const bytes = Number(matches[0][1]);
  if (!Number.isSafeInteger(bytes)) refuse(`SHA256SUMS byte count is not a safe integer for ${assetName}`);
  return { sha256: matches[0][0], bytes };
}

function verifyAsset(assetFile, declared, report) {
  let observedBytes;
  try {
    const stat = fs.lstatSync(assetFile);
    if (!stat.isFile()) refuse(`downloaded asset is not a regular file: ${report.asset.name}`);
    observedBytes = stat.size;
  } catch (error) {
    if (error instanceof Refusal) throw error;
    refuse(`cannot inspect downloaded asset ${report.asset.name}: ${error.message}`);
  }
  report.asset.observed_bytes = observedBytes;
  if (observedBytes !== declared.bytes) {
    refuse(`asset byte count mismatch for ${report.asset.name}: declared ${declared.bytes}, observed ${observedBytes}`);
  }
  const observedSha256 = sha256File(assetFile);
  report.asset.observed_sha256 = observedSha256;
  if (observedSha256 !== declared.sha256) {
    refuse(`asset digest mismatch for ${report.asset.name}: declared ${declared.sha256}, observed ${observedSha256}`);
  }
}

function child(command, args, options = {}) {
  const { label, missingMessage, ...execOptions } = options;
  try {
    execFileSync(command, args, { ...execOptions, stdio: ["ignore", 2, 2] });
  } catch (error) {
    if (error.code === "ENOENT" && missingMessage) refuse(missingMessage);
    refuse(`${label || path.basename(command)} failed (exit ${error.status ?? "unknown"})`);
  }
}

function installerBinDirectory(installerFile, environment) {
  let source;
  try {
    source = fs.readFileSync(installerFile, "utf8");
  } catch {
    return null;
  }
  const declaration = source.match(/^\s*bin_directory\s*=\s*Path\.home\(\)(?<suffix>(?:\s*\/\s*(?:"[^"\r\n]+"|'[^'\r\n]+'))+)\s*$/mu);
  if (!declaration) return null;
  const components = [];
  const componentPattern = /\s*\/\s*(?:"([^"\r\n]+)"|'([^'\r\n]+)')/gmu;
  let consumed = "";
  for (const match of declaration.groups.suffix.matchAll(componentPattern)) {
    consumed += match[0];
    const component = match[1] ?? match[2];
    if (component === "." || component === ".." || component.includes("/") || component.includes("\\")) return null;
    components.push(component);
  }
  if (components.length === 0 || consumed.trim() !== declaration.groups.suffix.trim()) return null;
  return path.join(environment.HOME || os.homedir(), ...components);
}

function leanLauncher(environment = process.env, installerFile) {
  if (environment[LEAN_LAUNCHER_ENV]) return environment[LEAN_LAUNCHER_ENV];
  if (installerFile) {
    const binDirectory = installerBinDirectory(installerFile, environment);
    const installed = binDirectory && path.join(binDirectory, "lake");
    if (installed) {
      try {
        if (fs.statSync(installed).isFile()) {
          fs.accessSync(installed, fs.constants.X_OK);
          return installed;
        }
      } catch {}
    }
  }
  return "lake";
}

function leanLauncherMissingMessage(launcher) {
  return `Lean launcher ${JSON.stringify(launcher)} was not found. Install elan from https://lean-lang.org/install/ and ensure its lake executable is on PATH, or set ${LEAN_LAUNCHER_ENV} to an executable name or path.`;
}

function download(url, destination) {
  child("curl", ["-fsSL", "--retry", "3", "--retry-delay", "1", "-o", destination, url], {
    label: `download ${url}`,
  });
}

function pathWithin(candidate, parent) {
  const relative = path.relative(parent, candidate);
  return relative !== "" && !relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative);
}

function makeTreeRemovable(root) {
  let stat;
  try { stat = fs.lstatSync(root); } catch { return; }
  if (!stat.isDirectory() || stat.isSymbolicLink()) return;
  fs.chmodSync(root, 0o700);
  for (const name of fs.readdirSync(root)) makeTreeRemovable(path.join(root, name));
}

function installPublished(assetFile, declared, work) {
  const prefix = fs.mkdtempSync(path.join(work, "prefix-"));
  const installerCwd = fs.mkdtempSync(path.join(work, "installer-cwd-"));
  if (pathWithin(installerCwd, ROOT) || pathWithin(prefix, ROOT)) {
    refuse("installer workspace must be outside the source checkout");
  }
  fs.chmodSync(assetFile, 0o555);
  child(assetFile, ["--sha256", declared.sha256, "--bytes", String(declared.bytes), "--prefix", prefix], {
    cwd: installerCwd,
    label: "published installer",
  });

  let record;
  try {
    record = JSON.parse(fs.readFileSync(path.join(prefix, "lib", "seal", "install.json"), "utf8"));
  } catch (error) {
    refuse(`cannot read installer record: ${error.message}`);
  }
  if (!record || !/^[0-9a-f]{64}$/.test(record.treeSha256 || "") ||
      record.store !== path.posix.join("lib", "seal", "store", record.treeSha256)) {
    refuse(`installer recorded an invalid store value: ${record?.store}`);
  }
  const installed = path.join(prefix, record.store, "runtime", "kernel", "wasm", "seal.wasm");
  let resolved;
  try {
    const stat = fs.lstatSync(installed);
    if (!stat.isFile()) refuse(`installed kernel is not a regular file: ${installed}`);
    resolved = fs.realpathSync(installed);
  } catch (error) {
    if (error instanceof Refusal) throw error;
    refuse(`cannot inspect installed kernel: ${error.message}`);
  }
  const resolvedPrefix = fs.realpathSync(prefix);
  if (!pathWithin(resolved, resolvedPrefix)) refuse(`installed kernel escapes clean prefix: ${resolved}`);
  return installed;
}

function clonePinnedSource(pin, destination) {
  fs.mkdirSync(destination);
  child("git", ["init", "--quiet"], { cwd: destination, label: "initialize pinned source checkout" });
  child("git", ["remote", "add", "origin", pin.repository], { cwd: destination, label: "configure pinned source remote" });
  child("git", ["fetch", "--quiet", "--depth", "1", "origin", pin.commit], { cwd: destination, label: `fetch pinned source ${pin.commit}` });
  child("git", ["checkout", "--quiet", "--detach", "FETCH_HEAD"], { cwd: destination, label: `checkout pinned source ${pin.commit}` });
  let observed;
  try {
    observed = execFileSync("git", ["rev-parse", "HEAD"], { cwd: destination, encoding: "utf8" }).trim();
  } catch (error) {
    refuse(`cannot identify pinned source checkout (exit ${error.status ?? "unknown"})`);
  }
  if (observed !== pin.commit) refuse(`pinned source checkout mismatch: requested ${pin.commit}, observed ${observed}`);
}

function buildPinnedKernel(tag, work) {
  const pin = SOURCE_PINS[tag];
  if (!pin) refuse(`no pinned kernel source recipe is recorded for release tag ${tag}`);
  const source = path.join(work, "pinned-source");
  clonePinnedSource(pin, source);

  child("bash", ["wasm-spike/provision_toolchain.sh"], { cwd: source, label: "provision pinned wasm toolchains" });
  const installer = path.join(source, "scripts", "install_pinned_elan.py");
  child("python3", [installer, "--mathlib-cache"], { cwd: source, label: "install repository-pinned elan and Mathlib cache" });
  const launcher = leanLauncher(process.env, installer);
  const missingMessage = leanLauncherMissingMessage(launcher);
  if (!fs.existsSync(path.join(source, ".lake", "packages", "mcp-seal"))) {
    child(launcher, ["update"], { cwd: source, label: "materialize manifest-pinned dependencies", missingMessage });
  }
  child("bash", [".lake/packages/mcp-seal/c/build.sh"], { cwd: source, label: "build pinned kernel C dependency" });
  child(launcher, ["build"], { cwd: source, label: "build Lean sources once for wasm C inputs", missingMessage });
  for (const [script, args] of [
    ["./build_runtime_wasm.sh", []],
    ["./build_base.sh", []],
    ["./build_core.sh", []],
    ["./build_closure.sh", []],
    ["./build_wasm.sh", ["strict"]],
  ]) {
    child(script, args, { cwd: path.join(source, "wasm-spike"), label: `rebuild kernel with ${script}` });
  }
  const rebuilt = path.join(source, "wasm-spike", "build-core", "seal.wasm");
  if (!fs.existsSync(rebuilt)) refuse(`pinned source build did not produce ${rebuilt}`);
  return rebuilt;
}

const DEFAULT_DEPS = Object.freeze({ download, installPublished, buildPinnedKernel });

function executeBuildPinned(argv, deps = DEFAULT_DEPS) {
  let parsed;
  let work;
  try {
    parsed = parseBuildPinnedArguments(argv);
    work = fs.mkdtempSync(path.join(os.tmpdir(), "seal-rebuild-pinned-"));
    if (pathWithin(work, ROOT) || work === ROOT) refuse(`work directory must be outside the source checkout: ${work}`);
    const rebuiltKernel = deps.buildPinnedKernel(parsed.tag, work);
    fs.copyFileSync(rebuiltKernel, parsed.output);
    return { tag: parsed.tag, output: parsed.output, exitCode: 0, error: null };
  } catch (error) {
    const message = error instanceof Refusal ? error.message : `unexpected failure: ${error.message}`;
    return { tag: parsed?.tag ?? null, output: parsed?.output ?? null, exitCode: 1, error: message };
  } finally {
    if (work) {
      try {
        makeTreeRemovable(work);
        fs.rmSync(work, { recursive: true, force: true });
      } catch {}
    }
  }
}

function execute(argv, deps = DEFAULT_DEPS) {
  let parsed;
  let work;
  let report = emptyReport(null);
  try {
    parsed = parseArguments(argv);
    report = emptyReport(parsed.tag, "same-authority", parsed.platform);
    const authority = validateRequest(parsed);
    report.authority = authority;

    work = fs.mkdtempSync(path.join(os.tmpdir(), "seal-reproduce-"));
    if (pathWithin(work, ROOT) || work === ROOT) refuse(`work directory must be outside the source checkout: ${work}`);
    const assetFile = path.join(work, report.asset.name);
    const checksumsFile = path.join(work, "SHA256SUMS");
    const base = `https://github.com/velvetmonkey/seal/releases/download/${encodeURIComponent(parsed.tag)}`;
    deps.download(`${base}/SHA256SUMS`, checksumsFile);
    deps.download(`${base}/${report.asset.name}`, assetFile);

    const declared = readPublishedEntry(checksumsFile, report.asset.name);
    report.asset.declared_sha256 = declared.sha256;
    report.asset.declared_bytes = declared.bytes;
    verifyAsset(assetFile, declared, report);

    const publishedKernel = deps.installPublished(assetFile, declared, work);
    if (deps.afterPublishedKernel) deps.afterPublishedKernel(publishedKernel);
    report.published_kernel_sha256 = sha256File(publishedKernel);

    const rebuiltKernel = deps.buildPinnedKernel(parsed.tag, work);
    report.rebuilt_kernel_sha256 = sha256File(rebuiltKernel);
    report.result = report.published_kernel_sha256 === report.rebuilt_kernel_sha256 ? "artifact-kernel-match" : "artifact-kernel-mismatch";
    return { report, exitCode: report.result === "artifact-kernel-match" ? 0 : 1, error: null };
  } catch (error) {
    const message = error instanceof Refusal ? error.message : `unexpected failure: ${error.message}`;
    return { report, exitCode: 1, error: message };
  } finally {
    if (work) {
      try {
        makeTreeRemovable(work);
        fs.rmSync(work, { recursive: true, force: true });
      } catch {}
    }
  }
}

function main() {
  const argv = process.argv.slice(2);
  if (argv[0] === "build-pinned-kernel") {
    const outcome = executeBuildPinned(argv.slice(1));
    if (outcome.error) process.stderr.write(`REFUSE seal-rebuild-pinned ${outcome.tag ?? "<no-tag>"}: ${outcome.error}\n`);
    else process.stdout.write(`BUILT pinned kernel ${outcome.tag} at ${outcome.output}\n`);
    process.exitCode = outcome.exitCode;
    return;
  }
  const outcome = execute(argv);
  if (outcome.error) process.stderr.write(`REFUSE seal-reproduce ${outcome.report.tag ?? "<no-tag>"}: ${outcome.error}\n`);
  process.stdout.write(`${JSON.stringify(outcome.report, null, 2)}\n`);
  process.exitCode = outcome.exitCode;
}

if (require.main === module) main();

module.exports = {
  LIMIT,
  LEAN_LAUNCHER_ENV,
  SCHEMA,
  SOURCE_PINS,
  TAG_PATTERN,
  download,
  execute,
  executeBuildPinned,
  installPublished,
  leanLauncher,
  leanLauncherMissingMessage,
  makeTreeRemovable,
  readPublishedEntry,
  sha256Bytes,
};
