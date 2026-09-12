// SPDX-License-Identifier: Apache-2.0
// `seal __proxy` — the protected path on stdio, exactly as step 3B will
// consume the spine: MCP client on our stdin/stdout, protected server
// spawned behind the shared proxy, approval state in a durable journal.
// Private subcommand. `--init-store` creates the journal deliberately and
// exits; a missing journal at gate time is a refusal, never an empty store.
const readline = require("node:readline");
const { createRuntimeTreeCheck } = require("./integrity.cjs");
const { createProxy, StoreError } = require("./proxy.cjs");
const { createJournal } = require("./store.cjs");
const { activationLease, beforeForwardFromState, loadReceiptSigner, protectedToolSelections, ProtectionError } = require("./protection.cjs");
const { requireProtectSupportedPlatform } = require("./platform.cjs");
const { printKernelTiming } = require("./presentation.cjs");

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
  let proxy;
  let input;
  let stopping = false;
  let shutdownTask;
  let childClosed;
  const childDone = new Promise((resolve) => { childClosed = resolve; });

  // The first failure wins, including a status selected before shutdown.
  // Mark stopping before closing input: readline's close event is synchronous.
  function shutdown(code = 0) {
    process.exitCode = process.exitCode || code;
    if (stopping) return shutdownTask;
    stopping = true;
    shutdownTask = Promise.resolve().then(async () => {
      input?.close();
      process.stdin.destroy();
      try {
        if (proxy) {
          await proxy.stop(); // clears pending approvals and their timers
          await childDone; // stop can resolve before the child's stdout closes
        }
      } catch (error) {
        process.exitCode = process.exitCode || 1;
        process.stderr.write(`seal __proxy: shutdown failed: ${error.message}\n`);
      }
      // Journal and receipt writes complete synchronously inside proxy.write.
      // Empty writes wait behind all queued output without closing shared stdio.
      await Promise.all([process.stdout, process.stderr].map((stream) =>
        new Promise((resolve) => {
          if (stream.destroyed || !stream.writable) return resolve();
          stream.write("", resolve);
        })));
      process.exit(process.exitCode || 0);
    });
    return shutdownTask;
  }

  function fail(error) {
    process.stderr.write(`seal __proxy: ${error?.message ?? String(error)}\n`);
    printKernelTiming(error, (message) => process.stderr.write(`${message}\n`));
    void shutdown(1);
  }

  requireProtectSupportedPlatform();
  let parsed;
  try {
    parsed = parseArgs(argv);
  } catch (error) {
    process.stderr.write(`seal __proxy: ${error.message}\n`);
    process.stderr.write("usage: seal __proxy --protect-state FILE\n       seal __proxy --init-store --store FILE\n");
    await shutdown(2); return;
  }
  const { options, childArgv } = parsed;

  if (options.initStore) {
    if (!options.storePath) { process.stderr.write("seal __proxy: --init-store needs --store FILE\n"); await shutdown(2); return; }
    try {
      createJournal(options.storePath);
    } catch (error) {
      process.stderr.write(`seal __proxy: ${error.message}\n`);
      await shutdown(1); return;
    }
    process.stdout.write(`approval store initialised: ${options.storePath}\n`);
    await shutdown(0); return;
  }

  if (!options.protectState) {
    process.stderr.write("seal __proxy: legacy invocation without a receipt signer is refused; use --protect-state FILE\n");
    await shutdown(2); return;
  }

  let proxyOptions = { ...options, childArgv };
  if (options.protectState) {
    try {
      const state = await activationLease(options.protectState, process.env);
      const signer = loadReceiptSigner(process.env, (message) => process.stderr.write(message));
      if (state.lockRecovered) process.stderr.write("seal __proxy: recovered stale project lock\n");
      proxyOptions = {
        guardSelections: protectedToolSelections(state),
        storePath: state.storePath,
        receiptsDir: state.receiptsDir,
        signer,
        childArgv: state.childArgv,
        childEnv: state.childEnv,
        childCwd: state.projectRoot,
        beforeForward: beforeForwardFromState(options.protectState, state.leaseToken),
        runtimeTreeCheck: createRuntimeTreeCheck(),
        onRuntimeObservation: (message) => process.stderr.write(`${message}\n`),
        leaseFence: () => {
          const current = require("./protection.cjs").readState(options.protectState);
          const lease = current?.lease;
          const token = state.leaseToken;
          const ok = lease && token && lease.pid === token.pid &&
            lease.startWitness === token.startWitness && lease.generation === token.generation;
          return ok ? { ok: true } : { ok: false, detail: "this proxy no longer owns the active lease generation" };
        },
      };
    } catch (error) {
      if (error instanceof ProtectionError && error.code === "proxy_lease_active") {
        process.stderr.write(`REFUSED proxy_lease_active\n${error.message}\n`);
        await shutdown(1); return;
      }
      const prefix = error instanceof StoreError ? "seal __proxy"
        : `seal __proxy: ${error instanceof ProtectionError ? error.code : "startup failed"}`;
      process.stderr.write(`${prefix}: ${error.message}\n`);
      await shutdown(1); return;
    }
  }

  for (const required of ["storePath", "receiptsDir"]) {
    if (!proxyOptions[required]) { process.stderr.write(`seal __proxy: ${required} is required\n`); await shutdown(2); return; }
  }
  if ((!Array.isArray(proxyOptions.guardSelections) || proxyOptions.guardSelections.length === 0) &&
      (!Array.isArray(proxyOptions.guardTools) || proxyOptions.guardTools.length === 0) && !proxyOptions.guardTool) {
    process.stderr.write("seal __proxy: guardTools is required\n"); await shutdown(2); return;
  }
  if (proxyOptions.childArgv.length === 0) {
    process.stderr.write("seal __proxy: a server command is required after --\n");
    await shutdown(2); return;
  }

  try {
    proxy = createProxy({
      ...proxyOptions,
      onClientLine: (line) => process.stdout.write(line + "\n"),
      onChildExit: (code, signal) => {
        childClosed();
        if (stopping) return;
        if (code !== 0) {
          process.stderr.write(`seal __proxy: protected server exited ${code === null ? signal : code}\n`);
        }
        void shutdown(code === 0 ? 0 : 1);
      },
    });
  } catch (error) {
    const prefix = error instanceof StoreError ? "seal __proxy" : "seal __proxy: startup failed";
    process.stderr.write(`${prefix}: ${error.message}\n`);
    await shutdown(1);
    return;
  }
  process.once("SIGINT", () => { void shutdown(130); });
  process.once("SIGTERM", () => { void shutdown(143); });
  process.once("uncaughtException", fail);
  process.once("unhandledRejection", fail);
  process.stdout.on("error", () => { void shutdown(1); });
  process.stderr.on("error", () => { void shutdown(1); });
  input = readline.createInterface({ input: process.stdin, terminal: false });
  input.on("line", (line) => {
    if (stopping) return;
    try {
      proxy.write(line);
    } catch (error) {
      fail(error);
    }
  });
  input.on("close", () => { void shutdown(); });
}

module.exports = { run };
