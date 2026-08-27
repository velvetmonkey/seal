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

// The envelope carries a HOST route (passthrough, forward, block, error). The
// kernel decision type is Allow/Block; the host maps one to the other. Nothing
// in the seal checkout reads either Lean tree, so this correspondence is
// maintained by hand across a repository boundary; see docs/SEAL-RECEIPT-V2.md. // CLAIM-COVERAGE: docs/SEAL-RECEIPT-V2.md
// The shipped composition exposes no route-domain enumeration, so the host
// route list and its expected set are checked in both directions below.
const HOST_ROUTE_DOMAIN = Object.freeze(["passthrough", "forward", "block", "error"]);
const EXPECTED_HOST_ROUTE_DOMAIN = new Set(["passthrough", "forward", "block", "error"]);

function assertExactHostRouteDomain() {
  const actual = new Set(HOST_ROUTE_DOMAIN);
  const missing = [...EXPECTED_HOST_ROUTE_DOMAIN].filter((route) => !actual.has(route));
  const extras = [...actual].filter((route) => !EXPECTED_HOST_ROUTE_DOMAIN.has(route));
  assert.equal(actual.size, HOST_ROUTE_DOMAIN.length, "HOST ROUTE DOMAIN must not contain duplicates");
  assert.deepEqual(missing, [], `HOST ROUTE DOMAIN missing: ${missing.join(", ")}`);
  assert.deepEqual(extras, [], `HOST ROUTE DOMAIN extra: ${extras.join(", ")}`);
}

const rawForRoute = (route) => route === "error" ? JSON.stringify({ error: "synthetic error" }) : JSON.stringify({ route });

function mapProducer(route) {
  const parsed = producerParseVerdict(rawForRoute(route), "synthetic.tool");
  return parsed.verdict === "DENY" ? "BLOCK" : parsed.verdict;
}

function mapJudge(route) {
  return judgeParseVerdict(rawForRoute(route));
}

test("producer and judge agree over every host route", async () => {
  assertExactHostRouteDomain();

  const table = HOST_ROUTE_DOMAIN.map((route) => {
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
    assert.notEqual(route, undefined, `TOTALITY: host route missing for ${specimen.name}`);
    assert.ok(HOST_ROUTE_DOMAIN.includes(route), `TOTALITY: exercised host emitted undeclared route ${route}`);
  }

  console.log(`ROUTE TABLE ${JSON.stringify(table)}`);
  console.log("DOMAIN RESIDUAL: exact-set comparison covers the hand-maintained HOST route domain passthrough, forward, block, and error; exercised host inputs must emit only those routes. The shipped composition exposes no route-domain enumeration, so an entirely unprovoked future host route remains uncovered.");
});
