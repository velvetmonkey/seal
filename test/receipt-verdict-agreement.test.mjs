// SPDX-License-Identifier: Apache-2.0
// This test imports both sides deliberately: the judge must not import the
// producer at runtime, but a test must import both to enforce their boundary.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";
import { CFG_STANDARD, guardTarget, parseVerdict } from "../runtime/kernel/seal-config.js";

const { decide } = createRequire(import.meta.url)("../runtime/kernel/decision-runner.cjs");

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

test("producer and judge agree for every live kernel route", async () => {
  const table = [];
  for (const specimen of cases) {
    const judged = await decide(specimen.config, specimen.input);
    const route = JSON.parse(judged.raw).route;
    const parsed = parseVerdict(judged.raw, specimen.input.tool);
    // receipt-format's producer seam writes DENY as the wire verdict BLOCK.
    const producer = parsed.verdict === "DENY" ? "BLOCK" : parsed.verdict;
    const judge = judged.verdict;

    // The domain is derived from raw routes emitted by the kernel, not a third
    // hand-written route-to-verdict table. Every observed route must be handled.
    assert.notEqual(route, undefined, `TOTALITY: kernel route missing for ${specimen.name}`);
    assert.ok(["ALLOW", "BLOCK", "ERROR"].includes(producer), `TOTALITY: producer has no verdict for route ${route}`);
    assert.ok(["ALLOW", "BLOCK", "ERROR"].includes(judge), `TOTALITY: judge has no verdict for route ${route}`);
    assert.equal(producer, judge, `AGREEMENT: route ${route} disagrees (producer=${producer}, judge=${judge})`);
    table.push({ route, producer, judge });
  }

  console.log(`ROUTE TABLE ${JSON.stringify(table)}`);
  console.log("DOMAIN RESIDUAL: compiled kernel exposes no route-domain enumeration; this covers every route emitted by the exercised decision-runner interface, not an unobservable future route.");
});
