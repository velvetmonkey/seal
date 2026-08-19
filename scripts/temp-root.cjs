const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

function makeTempRoot(repoRoot, name) {
  const configured = process.env.TMPDIR || process.env.TMP || process.env.TEMP;
  const parent = configured || path.join(repoRoot, ".tmp");
  fs.mkdirSync(parent, { recursive: true });
  const root = fs.mkdtempSync(path.join(parent, `${name}-`));
  process.env.TMPDIR = root;
  process.env.TMP = root;
  process.env.TEMP = root;
  process.env.TMPFIX_RUN_ROOT = root;
  const cleanup = () => {
    // Never remove anything below /tmp: that is an operator-owned boundary.
    if (path.resolve(root) === "/tmp" || path.resolve(root).startsWith("/tmp/")) return;
    try { fs.rmSync(root, { recursive: true, force: true }); } catch {}
  };
  process.once("exit", cleanup);
  process.once("SIGTERM", () => { cleanup(); process.exit(143); });
  process.once("SIGINT", () => { cleanup(); process.exit(130); });
  return root;
}

function install(repoRoot, name) {
  if (process.env.TMPFIX_RUN_ROOT) return process.env.TMPFIX_RUN_ROOT;
  return makeTempRoot(repoRoot, name);
}

module.exports = { install, makeTempRoot };
