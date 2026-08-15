// SPDX-License-Identifier: Apache-2.0
// `seal __proxy` — the protected path on stdio, exactly as step 3B will
// consume the spine: MCP client on our stdin/stdout, protected server
// spawned behind the shared proxy, approval state in a durable journal.
// Private subcommand. `--init-store` creates the journal deliberately and
// exits; a missing journal at gate time is a refusal, never an empty store.
const readline = require("node:readline");
const { createProxy, StoreError } = require("./proxy.cjs");
const { createJournal } = require("./store.cjs");
const { activationLease, beforeForwardFromState, ProtectionError } = require("./protection.cjs");
const { requireSupportedPlatform } = require("./platform.cjs");

function parseArgs(argv) {
  const options = { initStore: false };
  let i = 0;
  while (i < argv.length) {
    const flag = argv[i];
    if (flag === "--") return { options, childArgv: argv.slice(i + 1) };
    if (flag === "--init-store") { options.initStore = true; i += 1; continue; }
    const value = argv[i + 1];
    if (value === undefined) throw new Error(`missing value for ${flag}`);
    if (flag === "--guard") options.guardTool = value;
    else if (flag === "--store") options.storePath = value;
    else if (flag === "--receipts") options.receiptsDir = value;
    else if (flag === "--protect-state") options.protectState = value;
    else throw new Error(`unknown flag ${flag}`);
    i += 2;
  }
  return { options, childArgv: [] };
}

async function run(argv) {
  requireSupportedPlatform();
  let parsed;
  try {
    parsed = parseArgs(argv);
  } catch (error) {
    process.stderr.write(`seal __proxy: ${error.message}\n`);
    process.stderr.write("usage: seal __proxy --guard TOOL --store FILE --receipts DIR -- CMD [ARGS...]\n       seal __proxy --protect-state FILE\n       seal __proxy --init-store --store FILE\n");
    process.exit(2);
  }
  const { options, childArgv } = parsed;

  if (options.initStore) {
    if (!options.storePath) { process.stderr.write("seal __proxy: --init-store needs --store FILE\n"); process.exit(2); }
    try {
      createJournal(options.storePath);
    } catch (error) {
      process.stderr.write(`seal __proxy: ${error.message}\n`);
      process.exit(1);
    }
    process.stdout.write(`approval store initialised: ${options.storePath}\n`);
    process.exit(0);
  }

  let proxyOptions = { ...options, childArgv };
  if (options.protectState) {
    try {
      const state = await activationLease(options.protectState, process.env);
      proxyOptions = {
        guardTool: state.guardTool,
        storePath: state.storePath,
        receiptsDir: state.receiptsDir,
        childArgv: state.childArgv,
        childEnv: state.childEnv,
        beforeForward: beforeForwardFromState(options.protectState),
      };
    } catch (error) {
      const prefix = error instanceof ProtectionError ? error.code : "startup failed";
      process.stderr.write(`seal __proxy: ${prefix}: ${error.message}\n`);
      process.exit(1);
    }
  }

  for (const required of ["guardTool", "storePath", "receiptsDir"]) {
    if (!proxyOptions[required]) { process.stderr.write(`seal __proxy: ${required} is required\n`); process.exit(2); }
  }
  if (proxyOptions.childArgv.length === 0) {
    process.stderr.write("seal __proxy: a server command is required after --\n");
    process.exit(2);
  }

  let proxy;
  try {
    proxy = createProxy({
      ...proxyOptions,
      onClientLine: (line) => process.stdout.write(line + "\n"),
      onChildExit: (code) => {
        if (code !== 0 && code !== null) {
          process.stderr.write(`seal __proxy: protected server exited ${code}\n`);
          process.exit(1);
        }
      },
    });
  } catch (error) {
    const prefix = error instanceof StoreError ? "seal __proxy" : "seal __proxy: startup failed";
    process.stderr.write(`${prefix}: ${error.message}\n`);
    process.exit(1);
  }

  const input = readline.createInterface({ input: process.stdin, terminal: false });
  input.on("line", (line) => {
    try {
      proxy.write(line);
    } catch (error) {
      process.stderr.write(`seal __proxy: ${error.message}\n`);
      process.exitCode = 1;
    }
  });
  input.on("close", async () => {
    await proxy.stop();
    process.exit(process.exitCode || 0);
  });
}

module.exports = { run };
