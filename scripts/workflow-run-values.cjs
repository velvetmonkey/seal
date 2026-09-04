// SPDX-License-Identifier: Apache-2.0
// Extract YAML `run` scalar values without adding a package dependency. CI runs
// this repository with Node only and does not install npm dependencies.
// This limited parser supports the plain and literal/folded block scalars used
// by GitHub Actions workflow steps. It does not parse general YAML documents.
function workflowRunValues(source) {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const values = [];

  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(/^( *)(?:run):[ \t]*(.*)$/u);
    if (!match) continue;
    const indent = match[1].length;
    const value = match[2];
    if (/^[|>][0-9+-]*$/u.test(value)) {
      const block = [];
      let next = index + 1;
      while (next < lines.length && (lines[next].trim() === "" || lines[next].match(/^ +/u)?.[0].length > indent)) {
        block.push(lines[next]);
        next += 1;
      }
      const contentIndent = Math.min(...block.filter((line) => line.trim() !== "").map((line) => line.match(/^ */u)[0].length));
      values.push(block.map((line) => line.trim() === "" ? "" : line.slice(contentIndent)).join("\n"));
      index = next - 1;
      continue;
    }

    const parts = [value];
    let next = index + 1;
    while (next < lines.length && lines[next].match(/^ +/u)?.[0].length > indent && lines[next].trim() !== "") {
      parts.push(lines[next].trim());
      next += 1;
    }
    values.push(parts.join(" "));
    index = next - 1;
  }
  return values;
}

function hasSealProtectInvocation(runValue) {
  // This detects direct `seal protect` and path-qualified `bin/seal protect`.
  // LIMIT: It does not resolve shell variables. `$SEAL protect` is not caught.
  return /(?:^|[;&|\n]\s*|\s)(?:[A-Za-z0-9_.-]+\/)*seal(?:\s+|\s+\\\s*)protect\b/u.test(runValue);
}

module.exports = { hasSealProtectInvocation, workflowRunValues };
