import { tap } from "node:test/reporters";

export default async function* productSuiteTapReporter(source) {
  const events = [];
  for await (const event of source) {
    events.push(event);
  }

  const completedCases = events.filter((event) =>
    event.type === "test:complete" &&
    event.data?.file &&
    event.data.name !== event.data.file
  );
  const caseCounts = new Map();
  for (const event of completedCases) {
    caseCounts.set(event.data.file, (caseCounts.get(event.data.file) || 0) + 1);
  }
  const passedCases = events.filter((event) =>
    event.type === "test:pass" &&
    event.data?.file &&
    event.data.name !== event.data.file &&
    !event.data.skip &&
    !event.data.todo
  );

  const executed = events
    .filter((event) =>
      event.type === "test:complete" &&
      event.data?.file &&
      event.data.name === event.data.file
    )
    .map((event) => event.data.file);
  yield `# product-suite-executed-file-count ${executed.length}\n`;
  for (const file of executed.sort()) {
    yield `# product-suite-executed-file ${file}\n`;
    yield `# product-suite-test-case-count ${file}\t${caseCounts.get(file) || 0}\n`;
  }
  for (const event of passedCases.sort((left, right) =>
    left.data.file.localeCompare(right.data.file) ||
    left.data.name.localeCompare(right.data.name)
  )) {
    yield `# product-suite-passed-test-case ${event.data.file}\t${event.data.name}\n`;
  }

  yield* tap(events);
}
