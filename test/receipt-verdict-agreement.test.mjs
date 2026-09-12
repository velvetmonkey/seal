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

// The host route uses passthrough, forward, block, or error. The receipt verdict
// uses ALLOW, BLOCK, or ERROR. The kernel decision type is Allow/Block; the host
// maps one to the other. The seal checkout includes the Authorization seam
// differential workflow. The workflow tests the correspondence between
// interpreted Lean and shipped WASM; see docs/SEAL-RECEIPT-V2.md.
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

const parsers = [
  ['judge', raw => judgeParseVerdict(raw)],
  ['producer', raw => producerParseVerdict(raw, 'parser-test').verdict],
];
for (const [name, parse] of parsers) {
  for (const raw of ['{}', '{"route":"unexpected"}', '{"route":"continue"}']) {
    test(`strict output: ${name} refuses ${raw}`, () => {
      assert.ok(['BLOCK', 'DENY', 'ERROR'].includes(parse(raw)), `${name} parsed ${raw} as ${parse(raw)}`);
    });
  }
  test(`strict output: ${name} refuses malformed and contradictory output`, () => {
    for (const raw of ['{', 'null', '[]', 'true', '42', '"forward"',
      '{"route":null}', '{"route":42}', '{"route":"ALLOW"}',
      '{"route":"forward","error":""}', '{"route":"passthrough","error":false}',
      '{"route":"forward","audit":null}', '{"route":"forward","audit":"{"}',
      ...['null', '[]', '{}', '{"verdict":"unexpected","certs":[]}',
        '{"verdict":"deny","certs":[]}', '{"verdict":"allow","certs":{}}',
        '{"verdict":"allow","certs":[null]}',
        '{"verdict":"allow","certs":[{"verdict":"deny"}]}',
      ].map(audit => JSON.stringify({ route: 'forward', audit })),
    ]) {
      assert.ok(['BLOCK', 'DENY', 'ERROR'].includes(parse(raw)), `${name} parsed ${raw} as ALLOW`);
    }
  });
}

test('strict output: every pinned FFI output form retains its explicit verdict', async () => {
  const { SCENARIOS } = await import('../runtime/kernel/seal-config.js');
  const runner = createRequire(import.meta.url)('../runtime/kernel/runner.cjs');
  assert.equal(runner.kernelSha(), await runner.pinnedSha(), 'exercise the pinned binary');
  const check = (name, raw, expected) => {
    const producer = producerParseVerdict(raw, 'kernel-output').verdict;
    const normalized = producer === 'DENY' ? 'BLOCK' : producer;
    assert.equal(judgeParseVerdict(raw), expected, `${name}: judge ${raw}`);
    assert.equal(normalized, expected, `${name}: producer ${raw}`);
    const output = JSON.parse(raw);
    console.log(`PINNED OUTPUT ${name}: route=${output.route || 'error'} audit=${Object.hasOwn(output, 'audit')} verdict=${expected}`);
  };
  const expected = { 'destructive-sql': 'BLOCK', 'self-approve': 'BLOCK', 'wire-40k': 'BLOCK',
    'pay-before': 'ALLOW', 'pay-after': 'BLOCK', 'store-safe': 'ALLOW', 'store-subtle': 'BLOCK' };
  for (const [name, scenario] of Object.entries(SCENARIOS)) {
    const result = await decide(scenario.config, { ...scenario, now: 1000, votes: '', grants: '', forecasts: '' });
    check(name, result.raw, expected[name]);
  }
  for (const specimen of cases) {
    const result = await decide(specimen.config, specimen.input);
    check(specimen.name, result.raw, specimen.name === 'forward' ? 'ALLOW' : 'BLOCK');
  }
  // Exercise the raw FFI for outputs outside a well-formed tools/call.
  await runner.decide(CFG_STANDARD, { tool: 'db.execute', args: {}, approvals: [] });
  const { M } = await runner.load();
  for (const [name, input, expected] of [
    ['passthrough', JSON.stringify({ line: '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' }), 'ALLOW'],
    ['classifier refusal without audit', JSON.stringify({ line: '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"x","arguments":{"n":1e9999}}}' }), 'BLOCK'],
    ['invalid step JSON', '{', 'ERROR'],
    ['missing line with large numeric metadata', '{"now":1e9999}', 'ALLOW'],
  ]) {
    check(name, M.ccall('seal_decide', 'string', ['string'], [input]), expected);
  }
});
