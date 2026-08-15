#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
const fs = require("node:fs");
const readline = require("node:readline");

const mode = process.argv[2] || "ok";
const source = process.argv[3];
function names() {
  if (mode === "empty") return [];
  if (mode === "file") return fs.readFileSync(source, "utf8").trim().split(/\s+/).filter(Boolean);
  return (source || "db.drop_table db.read").split(",").filter(Boolean);
}
function reply(frame) { process.stdout.write(JSON.stringify(frame) + "\n"); }

const input = readline.createInterface({ input: process.stdin, terminal: false });
input.on("line", (line) => {
  const frame = JSON.parse(line);
  if (frame.method === "initialize") {
    if (mode === "initialize-error") return reply({ jsonrpc: "2.0", id: frame.id, error: { code: -32000, message: "initialize refused" } });
    return reply({ jsonrpc: "2.0", id: frame.id, result: { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "tool-list-fixture", version: "1" } } });
  }
  if (frame.method === "tools/list") {
    if (mode === "list-error") return reply({ jsonrpc: "2.0", id: frame.id, error: { code: -32001, message: "list refused" } });
    return reply({ jsonrpc: "2.0", id: frame.id, result: { tools: names().map((name) => ({ name, inputSchema: { type: "object" } })) } });
  }
  if (frame.method === "tools/call") return reply({ jsonrpc: "2.0", id: frame.id, result: { content: [{ type: "text", text: `CALLED ${frame.params.name}` }] } });
});
