// SPDX-License-Identifier: Apache-2.0
// This test imports both sides deliberately: the judge must not import the
// producer at runtime, but a test must import both to enforce their boundary.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";
import { CFG_STANDARD, guardTarget, parseVerdict as producerParseVerdict } from "../runtime/kernel/seal-config.js";

const { decide, parseVerdict: judgeParseVerdict } = createRequire(import.meta.url)("../runtime/kernel/decision-runner.cjs");

const quorum = '{"acceptor":1,"value":"payments.send"}\n{"acceptor":2,"value":"payments.send"}\n';
const cases = [
  {
    name: "block",
    config: CFG_STANDARD,
    input: { tool: "db.execute", args: { database: "prod", sql: "drop table users" }, approvals: [], now: 1000, votes: "", grants: "", forecasts: "" },
  },
  {
    name: "forward",
    config: CFG_STANDARD,
    input: {
      tool: "payments.send",
      args: { amount: 40000, to: "supplier-77" },
      approvals: [guardTarget("payments.send", { amount: 40000, to: "supplier-77" })],
      now: 1000, votes: quorum, grants: "", forecasts: "",
    },
  },
];

// The kernel source of truth is Host.Step.StepRoute (passthrough, forward,
// block) plus the decision surface's error envelope. This product ships only
// the compiled WASM and it exposes no route-domain enumeration, so these four
// source-defined values are an explicit hand list. The observed-kernel check
// below catches a route that an exercised input emits, but an entirely
// unprovoked new kernel route remains outside this list's reach.
const ROUTE_DOMAIN = Object.freeze(["passthrough", "forward", "block", "error"]);

const rawForRoute = (route) => route === "error" ? JSON.stringify({ error: "synthetic error" }) : JSON.stringify({ route });

function mapProducer(route) {
  const parsed = producerParseVerdict(rawForRoute(route), "synthetic.tool");
  return parsed.verdict === "DENY" ? "BLOCK" : parsed.verdict;
}

function mapJudge(route) {
  return judgeParseVerdict(rawForRoute(route));
}

test("producer and judge agree over every source-defined route", async () => {
  const table = ROUTE_DOMAIN.map((route) => {
    const producer = mapProducer(route);
    const judge = mapJudge(route);
    assert.ok(["ALLOW", "BLOCK", "ERROR"].includes(producer), `TOTALITY: producer has no verdict for route ${route}`);
    assert.ok(["ALLOW", "BLOCK", "ERROR"].includes(judge), `TOTALITY: judge has no verdict for route ${route}`);
    assert.equal(producer, judge, `AGREEMENT: route ${route} disagrees (producer=${producer}, judge=${judge})`);
    return { route, producer, judge };
  });

  for (const specimen of cases) {
    const judged = await decide(specimen.config, specimen.input);
    const route = JSON.parse(judged.raw).route;
    assert.notEqual(route, undefined, `TOTALITY: kernel route missing for ${specimen.name}`);
    assert.ok(ROUTE_DOMAIN.includes(route), `TOTALITY: exercised kernel emitted undeclared route ${route}`);
  }

  console.log(`ROUTE TABLE ${JSON.stringify(table)}`);
  console.log("DOMAIN RESIDUAL: direct comparison covers the hand-listed source-defined routes passthrough, forward, block, and error; the exercised kernel inputs must emit only those routes. The shipped compiled WASM exposes no route-domain enumeration, so an entirely unprovoked future route remains uncovered.");
});
