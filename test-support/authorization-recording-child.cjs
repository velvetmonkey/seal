#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
"use strict";
const fs = require("node:fs");
const readline = require("node:readline");
const effects = process.argv[2];
if (!effects)
  throw new Error("recording child needs its append-only effect file");
const fd = fs.openSync(effects, "a", 0o600);
const reply = (value) => process.stdout.write(JSON.stringify(value) + "\n");
readline
  .createInterface({ input: process.stdin })
  .on("line", (raw) => {
    const frame = JSON.parse(raw);
    if (frame.method === "initialize") {
      reply({
        jsonrpc: "2.0",
        id: frame.id,
        result: {
          protocolVersion: frame.params.protocolVersion,
          capabilities: { tools: {} },
          serverInfo: { name: "correspondence-recorder", version: "1" },
        },
      });
    } else if (frame.method === "tools/list") {
      reply({
        jsonrpc: "2.0",
        id: frame.id,
        result: {
          tools: ["demo.mutate", "demo.other"].map((name) => ({
            name,
            description: "record the complete parsed effect",
            inputSchema: { type: "object" },
          })),
        },
      });
    } else if (frame.method === "tools/call") {
      // This process owns the observation. Persist it before acknowledging the
      // operation, and preserve it across child and proxy restarts.
      const line = Buffer.from(
        JSON.stringify({
          raw,
          id: frame.id,
          tool: frame.params.name,
          args: Object.hasOwn(frame.params, "arguments")
            ? frame.params.arguments
            : {},
        }) + "\n",
      );
      let offset = 0;
      while (offset < line.length)
        offset += fs.writeSync(fd, line, offset, line.length - offset);
      fs.fsyncSync(fd);
      reply({
        jsonrpc: "2.0",
        id: frame.id,
        result: { content: [{ type: "text", text: "recorded" }] },
      });
    } else if (frame.id !== undefined) {
      reply({ jsonrpc: "2.0", id: frame.id, result: {} });
    }
  })
  .on("close", () => {
    fs.closeSync(fd);
  });
