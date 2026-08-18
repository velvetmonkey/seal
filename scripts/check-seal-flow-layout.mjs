#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Coordinate-level collision audit for the generated process diagram.
// Text bounds use DejaVu Sans Mono's 0.602em advance, the Linux monospace
// fallback selected by fontconfig, plus a conservative 0.02em safety margin.

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const svg = readFileSync(resolve(ROOT, "assets/seal-flow.svg"), "utf8");
const FONT_SIZES = { h1: 26, h2: 20, label: 17, body: 15, small: 13, tiny: 11 };
const ID = [1, 0, 0, 1, 0, 0];
const texts = [];
const connectors = [];
const icons = [];

function attrs(tag) {
  return Object.fromEntries([...tag.matchAll(/([:\w-]+)="([^"]*)"/g)].map((match) => [match[1], match[2]]));
}

function mul(a, b) {
  return [
    a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5],
  ];
}

function transform(value = "") {
  let out = ID;
  for (const match of value.matchAll(/(translate|scale)\(([^)]*)\)/g)) {
    const numbers = match[2].trim().split(/[ ,]+/).map(Number);
    const next = match[1] === "translate"
      ? [1, 0, 0, 1, numbers[0], numbers[1] ?? 0]
      : [numbers[0], 0, 0, numbers[1] ?? numbers[0], 0, 0];
    out = mul(out, next);
  }
  return out;
}

function point(matrix, x, y) {
  return { x: matrix[0] * x + matrix[2] * y + matrix[4], y: matrix[1] * x + matrix[3] * y + matrix[5] };
}

function flattenPath(d, matrix) {
  const tokens = d.match(/[A-Za-z]|-?(?:\d*\.)?\d+(?:e[-+]?\d+)?/gi) || [];
  const points = [];
  let i = 0, command = "", x = 0, y = 0, startX = 0, startY = 0, priorControl = null;
  const take = () => Number(tokens[i++]);
  const addLine = (nx, ny) => {
    if (points.length === 0) points.push(point(matrix, x, y));
    x = nx; y = ny; points.push(point(matrix, x, y)); priorControl = null;
  };
  while (i < tokens.length) {
    if (/^[A-Za-z]$/.test(tokens[i])) command = tokens[i++];
    const relative = command === command.toLowerCase();
    const upper = command.toUpperCase();
    if (upper === "M") {
      const nx = take(), ny = take();
      x = (relative ? x : 0) + nx; y = (relative ? y : 0) + ny;
      startX = x; startY = y; points.push(point(matrix, x, y));
      command = relative ? "l" : "L";
    } else if (upper === "L") {
      const nx = take(), ny = take(); addLine((relative ? x : 0) + nx, (relative ? y : 0) + ny);
    } else if (upper === "H") {
      const nx = take(); addLine((relative ? x : 0) + nx, y);
    } else if (upper === "V") {
      const ny = take(); addLine(x, (relative ? y : 0) + ny);
    } else if (upper === "C") {
      const baseX = x, baseY = y;
      const c1 = { x: (relative ? x : 0) + take(), y: (relative ? y : 0) + take() };
      const c2 = { x: (relative ? x : 0) + take(), y: (relative ? y : 0) + take() };
      const end = { x: (relative ? x : 0) + take(), y: (relative ? y : 0) + take() };
      for (let step = 1; step <= 32; step++) {
        const t = step / 32, u = 1 - t;
        points.push(point(matrix,
          u ** 3 * baseX + 3 * u ** 2 * t * c1.x + 3 * u * t ** 2 * c2.x + t ** 3 * end.x,
          u ** 3 * baseY + 3 * u ** 2 * t * c1.y + 3 * u * t ** 2 * c2.y + t ** 3 * end.y));
      }
      x = end.x; y = end.y; priorControl = c2;
    } else if (upper === "S") {
      const baseX = x, baseY = y;
      const c1 = priorControl ? { x: 2 * x - priorControl.x, y: 2 * y - priorControl.y } : { x, y };
      const c2 = { x: (relative ? x : 0) + take(), y: (relative ? y : 0) + take() };
      const end = { x: (relative ? x : 0) + take(), y: (relative ? y : 0) + take() };
      for (let step = 1; step <= 32; step++) {
        const t = step / 32, u = 1 - t;
        points.push(point(matrix,
          u ** 3 * baseX + 3 * u ** 2 * t * c1.x + 3 * u * t ** 2 * c2.x + t ** 3 * end.x,
          u ** 3 * baseY + 3 * u ** 2 * t * c1.y + 3 * u * t ** 2 * c2.y + t ** 3 * end.y));
      }
      x = end.x; y = end.y; priorControl = c2;
    } else if (upper === "Z") {
      addLine(startX, startY); command = "";
    } else {
      throw new Error(`unsupported SVG path command ${command} in ${d}`);
    }
  }
  return points;
}

const stack = [{ matrix: ID, icon: null, tag: "root" }];
let activeText = null;
for (const token of svg.match(/<[^>]+>|[^<]+/g) || []) {
  if (token.startsWith("</")) {
    const tag = token.match(/^<\/(\w+)/)?.[1];
    if (tag === "text" && activeText) {
      const a = activeText.attrs;
      const size = FONT_SIZES[(a.class || "").split(/\s+/).find((name) => FONT_SIZES[name])] || 15;
      const value = activeText.value.replace(/\s+/g, " ").trim().replaceAll("-&gt;", "→");
      const origin = point(activeText.matrix, Number(a.x), Number(a.y));
      const scale = Math.hypot(activeText.matrix[0], activeText.matrix[1]);
      const width = value.length * size * 0.622 * scale;
      const height = size * scale;
      const left = a["text-anchor"] === "middle" ? origin.x - width / 2 : origin.x;
      texts.push({ value, icon: activeText.icon, box: { left, right: left + width, top: origin.y - height * .8, bottom: origin.y + height * .2 } });
      activeText = null;
    }
    if (stack.at(-1).tag === tag) stack.pop();
    continue;
  }
  if (!token.startsWith("<")) {
    if (activeText) activeText.value += token;
    continue;
  }
  if (/^<\?|^<!--|^<!/.test(token)) continue;
  const tag = token.match(/^<(\w+)/)?.[1];
  if (!tag) continue;
  const a = attrs(token);
  const parent = stack.at(-1);
  const matrix = mul(parent.matrix, transform(a.transform));
  const icon = a["data-icon"] || parent.icon;
  if (tag === "text") activeText = { attrs: a, matrix, icon, value: "" };
  if (tag === "path" && a.d) {
    const shape = { name: icon, points: flattenPath(a.d, matrix), stroke: a.class === "accent" ? 3 : 2.5 };
    if (icon) icons.push(shape);
    if (a["marker-end"] && !icon) connectors.push({ ...shape, clearance: Number(a["data-clearance"] || 0), d: a.d });
  }
  if (tag === "circle" && icon) {
    const center = point(matrix, Number(a.cx), Number(a.cy));
    const scale = Math.hypot(matrix[0], matrix[1]);
    icons.push({ name: icon, circle: { ...center, r: Number(a.r) * scale }, stroke: a.fill ? 0 : 2.5 * scale });
  }
  if (!token.endsWith("/>") && !["svg", "defs", "style", "marker", "g", "text", "tspan", "title", "desc"].includes(tag)) continue;
  if (!token.endsWith("/>") && tag !== "text" && tag !== "tspan") stack.push({ matrix, icon, tag });
}

function overlap(a, b) {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

function pointSegmentDistance(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

function segmentIntersectsBox(a, b, box) {
  if ((a.x >= box.left && a.x <= box.right && a.y >= box.top && a.y <= box.bottom) ||
      (b.x >= box.left && b.x <= box.right && b.y >= box.top && b.y <= box.bottom)) return true;
  const edges = [
    [{ x: box.left, y: box.top }, { x: box.right, y: box.top }],
    [{ x: box.right, y: box.top }, { x: box.right, y: box.bottom }],
    [{ x: box.right, y: box.bottom }, { x: box.left, y: box.bottom }],
    [{ x: box.left, y: box.bottom }, { x: box.left, y: box.top }],
  ];
  const cross = (p, q, r) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  return edges.some(([c, d]) => cross(a, b, c) * cross(a, b, d) <= 0 && cross(c, d, a) * cross(c, d, b) <= 0);
}

function segmentBoxDistance(a, b, box) {
  if (segmentIntersectsBox(a, b, box)) return 0;
  const corners = [
    { x: box.left, y: box.top }, { x: box.right, y: box.top },
    { x: box.right, y: box.bottom }, { x: box.left, y: box.bottom },
  ];
  const pointBox = (p) => Math.hypot(Math.max(box.left - p.x, 0, p.x - box.right), Math.max(box.top - p.y, 0, p.y - box.bottom));
  return Math.min(pointBox(a), pointBox(b), ...corners.map((corner) => pointSegmentDistance(corner, a, b)));
}

function shapeBoxDistance(shape, box) {
  if (shape.circle) {
    const dx = Math.max(box.left - shape.circle.x, 0, shape.circle.x - box.right);
    const dy = Math.max(box.top - shape.circle.y, 0, shape.circle.y - box.bottom);
    return Math.max(0, Math.hypot(dx, dy) - shape.circle.r);
  }
  let distance = Infinity;
  for (let index = 1; index < shape.points.length; index++) {
    distance = Math.min(distance, segmentBoxDistance(shape.points[index - 1], shape.points[index], box));
  }
  return Math.max(0, distance - shape.stroke / 2);
}

const failures = [];
for (let i = 0; i < texts.length; i++) {
  for (let j = i + 1; j < texts.length; j++) {
    if (overlap(texts[i].box, texts[j].box)) failures.push(`text/text: ${JSON.stringify(texts[i].value)} with ${JSON.stringify(texts[j].value)}`);
  }
  for (const connector of connectors) {
    const distance = shapeBoxDistance(connector, texts[i].box);
    const required = connector.clearance || 0;
    if (distance < required) failures.push(`text/connector: ${JSON.stringify(texts[i].value)} gap ${distance.toFixed(1)}px < ${required}px`);
  }
  for (const icon of icons) {
    if (icon.name === texts[i].icon) continue;
    const distance = shapeBoxDistance(icon, texts[i].box);
    if (distance <= 0) failures.push(`text/icon: ${JSON.stringify(texts[i].value)} overlaps ${icon.name}`);
  }
}
for (const connector of connectors.filter((item) => item.clearance)) {
  for (const icon of icons) {
    let distance = Infinity;
    if (icon.circle) {
      for (let index = 1; index < connector.points.length; index++) {
        distance = Math.min(distance, pointSegmentDistance(icon.circle, connector.points[index - 1], connector.points[index]) - icon.circle.r - connector.stroke / 2);
      }
    } else {
      for (const p of icon.points) for (let index = 1; index < connector.points.length; index++) {
        distance = Math.min(distance, pointSegmentDistance(p, connector.points[index - 1], connector.points[index]) - connector.stroke / 2);
      }
    }
    if (distance < connector.clearance) failures.push(`icon/connector: ${icon.name} gap ${Math.max(0, distance).toFixed(1)}px < ${connector.clearance}px`);
  }
}

if (failures.length) {
  console.error(`FAIL layout geometry (${failures.length} collision${failures.length === 1 ? "" : "s"})`);
  for (const failure of failures) console.error(`  ${failure}`);
  process.exit(1);
}
console.log(`PASS layout geometry: ${texts.length} text elements; no text/text, text/connector, or text/icon overlaps`);
console.log(`PASS connector clearance: ${connectors.filter((item) => item.clearance).length} forwarding paths keep >=16px from every text and icon`);
