// SPDX-License-Identifier: Apache-2.0
// Named product adapter for the authorization kernel. Node owns retry
// state; this adapter answers only whether the issue-time authorization binds
// the exact retried tool, arguments, context, and affirmative answer.
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const PRODUCT_ROOT = path.resolve(__dirname, "..");
const DEFAULT_KERNEL_ROOT = path.join(PRODUCT_ROOT, "runtime", "kernel");
const DEFAULT_MANIFEST = path.join(PRODUCT_ROOT, "runtime-manifest.json");
const DEFAULT_KERNEL_TIMEOUT_MS = 5000;

class KernelAuthorizationError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "KernelAuthorizationError";
    this.code = code;
  }
}

function sha256File(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function measuredPhase(clock, started, finished) {
  if (typeof started !== "bigint" || typeof finished !== "bigint" || finished < started) {
    throw new KernelAuthorizationError("kernel_output_refused", `invalid ${clock} timing phase`);
  }
  return {
    timestamps: { started_ns: started.toString(), finished_ns: finished.toString() },
    milliseconds: Number(finished - started) / 1e6,
  };
}

const CHILD_PHASE_NAMES = [
    "child_bootstrap_to_module_load",
    "child_request_read",
    "child_request_parse",
    "wasm_load",
    "decision_execution",
    "child_response_construction_and_serialization",
];

const CHILD_GAP_NAMES = [
  ["child_bootstrap_to_module_load", "child_request_read", "module_load_to_request_read"],
  ["child_request_read", "child_request_parse", "request_read_to_request_parse"],
  ["child_request_parse", "wasm_load", "request_parse_to_wasm_load"],
  ["wasm_load", "decision_execution", "wasm_load_to_decision_execution"],
  ["decision_execution", "child_response_construction_and_serialization", "decision_execution_to_response_construction"],
];

const NO_ACTIVE_PHASE = "child_died_before_first_instruction";

function workerTiming(stderr, { requireAll } = { requireAll: true }) {
  const prefix = "SEAL_KERNEL_TIMING_PHASE ";
  const startPrefix = "SEAL_KERNEL_TIMING_PHASE_START ";
  const phases = {};
  const starts = {};
  for (const line of stderr.split(/\r?\n/)) {
    const isStart = line.startsWith(startPrefix);
    if (!isStart && !line.startsWith(prefix)) continue;
    let record;
    try {
      record = JSON.parse(line.slice(isStart ? startPrefix.length : prefix.length));
    } catch {
      if (requireAll) throw new KernelAuthorizationError("kernel_output_refused", "kernel worker returned unreadable timing timestamps");
      continue;
    }
    const { name, clock, timestamps } = record;
    const validStart = isStart && /^\d+$/.test(record.started_ns || "");
    const validFinish = !isStart && timestamps && /^\d+$/.test(timestamps.started_ns || "")
      && /^\d+$/.test(timestamps.finished_ns || "")
      && BigInt(timestamps.finished_ns) >= BigInt(timestamps.started_ns);
    if (clock !== "child_process_hrtime_ns" || !CHILD_PHASE_NAMES.includes(name) || (!validStart && !validFinish)) {
      if (requireAll) throw new KernelAuthorizationError("kernel_output_refused", "kernel worker returned invalid timing timestamps");
      continue;
    }
    if (isStart) starts[name] = record.started_ns;
    else phases[name] = timestamps;
  }
  if (requireAll && !CHILD_PHASE_NAMES.every((name) => phases[name])) {
    throw new KernelAuthorizationError("kernel_output_refused", "kernel worker returned no timing timestamps");
  }
  const active = Object.keys(starts).filter((name) => !phases[name]);
  if (active.length > 1) {
    throw new KernelAuthorizationError("kernel_output_refused", "kernel worker published more than one active timing phase");
  }
  return { phases, starts, activePhase: active[0] || NO_ACTIVE_PHASE };
}

function timingPublication({ requestSerializationStarted, requestSerializationFinished, parentSpawnInvoked, parentSpawnReturned, childPhases, activePhase }) {
  const parentPhases = {
    parent_request_serialization: measuredPhase(
      "parent_process_hrtime_ns", requestSerializationStarted, requestSerializationFinished,
    ),
  };
  const publishedChildPhases = Object.fromEntries(Object.entries(childPhases).map(([name, timestamps]) => [name, {
    timestamps,
    milliseconds: Number(BigInt(timestamps.finished_ns) - BigInt(timestamps.started_ns)) / 1e6,
  }]));
  const childGaps = Object.fromEntries(CHILD_GAP_NAMES.flatMap(([finished, started, name]) => {
    const left = childPhases[finished];
    const right = childPhases[started];
    if (!left || !right) return [];
    return [[name, {
      timestamps: { started_ns: left.finished_ns, finished_ns: right.started_ns },
      milliseconds: Number(BigInt(right.started_ns) - BigInt(left.finished_ns)) / 1e6,
    }]];
  }));
  const parentWorkerWait = measuredPhase(
    "parent_process_hrtime_ns", parentSpawnInvoked, parentSpawnReturned,
  );
  const unmeasured = {
    parent_spawn_to_first_child_instruction: "UNMEASURED: parent_process_hrtime_ns and child_process_hrtime_ns have no shared epoch; no cross-clock subtraction is reported.",
    request_pipe_delivery: "UNMEASURED: parent request serialization and child request-read timestamps are on separate process clocks.",
    response_pipe_return: "UNMEASURED: child response serialization and parent response-deserialization timestamps are on separate process clocks.",
  };
  if (Object.keys(childPhases).length) {
    unmeasured.child_last_completed_phase_to_parent_timeout_return = "UNMEASURED: the last completed child phase and the parent timeout return use process clocks with no shared epoch.";
  }
  if (activePhase !== NO_ACTIVE_PHASE) {
    unmeasured.child_active_phase_start_to_parent_timeout_return = "UNMEASURED: the active child phase start and the parent timeout return use process clocks with no shared epoch.";
  }
  if (activePhase === "decision_execution") {
    unmeasured.decision_execution_start_to_parent_timeout_return = "UNMEASURED: the decision execution start and the parent timeout return use process clocks with no shared epoch.";
  }
  return {
    kernel_timing_timestamps: {
      parent_process_hrtime_ns: {
        parent_request_serialization: parentPhases.parent_request_serialization.timestamps,
        parent_kernel_worker_wait: parentWorkerWait.timestamps,
        parent_spawn_invoked_ns: parentSpawnInvoked.toString(),
      },
      child_process_hrtime_ns: Object.fromEntries([
        ...Object.entries(publishedChildPhases), ...Object.entries(childGaps),
      ].map(([name, phase]) => [name, phase.timestamps])),
    },
    kernel_timing_ms: Object.fromEntries([
      ...Object.entries(parentPhases), ["parent_kernel_worker_wait", parentWorkerWait],
      ...Object.entries(publishedChildPhases), ...Object.entries(childGaps),
    ].map(([name, phase]) => [name, phase.milliseconds])),
    kernel_timing_active_phase: activePhase,
    kernel_timing_unmeasured: unmeasured,
  };
}

function expectedWasmSha(manifestPath) {
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  } catch (error) {
    throw new KernelAuthorizationError("kernel_manifest_refused", `cannot read the kernel manifest: ${error.message}`);
  }
  const expected = manifest.files?.["kernel/wasm/seal.wasm"];
  if (!/^[0-9a-f]{64}$/.test(expected || "")) {
    throw new KernelAuthorizationError("kernel_manifest_refused", "the kernel manifest has no valid wasm pin");
  }
  return expected;
}

function createKernelAuthorizationAdapter({
  kernelRoot = DEFAULT_KERNEL_ROOT,
  manifestPath = DEFAULT_MANIFEST,
  workerPath = path.join(__dirname, "kernel-authorization-worker.cjs"),
  workerTimeoutMs = DEFAULT_KERNEL_TIMEOUT_MS,
} = {}) {
  return {
    authorize(input) {
      const wasmPath = path.join(kernelRoot, "wasm", "seal.wasm");
      const expected = expectedWasmSha(manifestPath);
      let computed;
      try {
        computed = sha256File(wasmPath);
      } catch (error) {
        throw new KernelAuthorizationError("kernel_integrity_refused", `cannot hash the vendored wasm: ${error.message}`);
      }
      if (computed !== expected) {
        throw new KernelAuthorizationError(
          "kernel_integrity_refused",
          `vendored wasm sha256 ${computed} does not match pinned ${expected}; no JavaScript fallback exists`,
        );
      }

      const requestSerializationStarted = process.hrtime.bigint();
      const serializedRequest = JSON.stringify(input);
      const requestSerializationFinished = process.hrtime.bigint();
      // This timestamp is deliberately retained although it cannot form a
      // duration with the child's first-instruction timestamp: hrtime clocks
      // are process-local. See the explicit UNMEASURED entry below.
      const parentSpawnInvoked = process.hrtime.bigint();
      const child = spawnSync(process.execPath, [workerPath, kernelRoot], {
        input: serializedRequest,
        encoding: "utf8",
        timeout: workerTimeoutMs,
        killSignal: "SIGKILL",
        maxBuffer: 8 * 1024 * 1024,
      });
      const parentSpawnReturned = process.hrtime.bigint();
      if (child.error?.code === "ETIMEDOUT") {
        const timeout = new KernelAuthorizationError(
          "kernel_execution_refused",
          `kernel worker exceeded its ${workerTimeoutMs} ms deadline`,
        );
        const childTiming = workerTiming(child.stderr || "", { requireAll: false });
        Object.assign(timeout, timingPublication({
          requestSerializationStarted,
          requestSerializationFinished,
          parentSpawnInvoked,
          parentSpawnReturned,
          childPhases: childTiming.phases,
          activePhase: childTiming.activePhase,
        }));
        throw timeout;
      }
      if (child.error) {
        throw new KernelAuthorizationError("kernel_execution_refused", `kernel worker could not start: ${child.error.message}`);
      }
      if (child.status !== 0) {
        const detail = (child.stderr || child.stdout || `worker exited ${child.status}`).trim();
        throw new KernelAuthorizationError("kernel_execution_refused", detail);
      }
      const responseDeserializationStarted = process.hrtime.bigint();
      let answer;
      try {
        answer = JSON.parse(child.stdout);
      } catch (error) {
        throw new KernelAuthorizationError("kernel_output_refused", `kernel worker returned unreadable output: ${error.message}`);
      }
      if (answer.verdict !== "ALLOW" && answer.verdict !== "BLOCK") {
        throw new KernelAuthorizationError("kernel_output_refused", `kernel returned unexpected verdict ${JSON.stringify(answer.verdict)}`);
      }
      const responseDeserializationFinished = process.hrtime.bigint();
      const childTiming = workerTiming(child.stderr || "");
      const parentPhases = {
        parent_request_serialization: measuredPhase(
          "parent_process_hrtime_ns", requestSerializationStarted, requestSerializationFinished,
        ),
        parent_response_deserialization: measuredPhase(
          "parent_process_hrtime_ns", responseDeserializationStarted, responseDeserializationFinished,
        ),
      };
      const childPhases = Object.fromEntries(CHILD_PHASE_NAMES.map((name) => {
        const phase = childTiming.phases[name];
        return [name, {
          timestamps: phase,
          milliseconds: Number(BigInt(phase.finished_ns) - BigInt(phase.started_ns)) / 1e6,
        }];
      }));
      return {
        ...answer,
        wasm_sha256: computed,
        kernel_timing_timestamps: {
          parent_process_hrtime_ns: {
            ...Object.fromEntries(Object.entries(parentPhases).map(([name, phase]) => [name, phase.timestamps])),
            parent_spawn_invoked_ns: parentSpawnInvoked.toString(),
            parent_kernel_worker_wait: measuredPhase(
              "parent_process_hrtime_ns", parentSpawnInvoked, parentSpawnReturned,
            ).timestamps,
          },
          child_process_hrtime_ns: Object.fromEntries([
            ...Object.entries(childPhases),
            ...CHILD_GAP_NAMES.map(([finished, started, name]) => [name, {
              timestamps: {
                started_ns: childTiming.phases[finished].finished_ns,
                finished_ns: childTiming.phases[started].started_ns,
              },
              milliseconds: Number(BigInt(childTiming.phases[started].started_ns) - BigInt(childTiming.phases[finished].finished_ns)) / 1e6,
            }]),
          ].map(([name, phase]) => [name, phase.timestamps])),
          },
        kernel_timing_ms: Object.fromEntries([
          ...Object.entries(parentPhases),
          ["parent_kernel_worker_wait", measuredPhase(
            "parent_process_hrtime_ns", parentSpawnInvoked, parentSpawnReturned,
          )],
          ...Object.entries(childPhases),
          ...CHILD_GAP_NAMES.map(([finished, started, name]) => [name, {
            milliseconds: Number(BigInt(childTiming.phases[started].started_ns) - BigInt(childTiming.phases[finished].finished_ns)) / 1e6,
          }]),
        ].map(([name, phase]) => [name, phase.milliseconds])),
        kernel_timing_active_phase: null,
        kernel_timing_unmeasured: {
          parent_spawn_to_first_child_instruction: "UNMEASURED: parent_process_hrtime_ns and child_process_hrtime_ns have no shared epoch; no cross-clock subtraction is reported.",
          request_pipe_delivery: "UNMEASURED: parent request serialization and child request-read timestamps are on separate process clocks.",
          response_pipe_return: "UNMEASURED: child response serialization and parent response-deserialization timestamps are on separate process clocks.",
        },
      };
    },
  };
}

module.exports = {
  createKernelAuthorizationAdapter,
  KernelAuthorizationError,
  DEFAULT_KERNEL_ROOT,
  DEFAULT_MANIFEST,
  DEFAULT_KERNEL_TIMEOUT_MS,
};
