import { tap } from "node:test/reporters";

export default async function* productSuiteTapReporter(source) {
  const events = [];
  for await (const event of source) {
    events.push(event);
  }

  const executed = new Set(
    events
      .filter((event) => event.type === "test:summary" && event.data?.file)
      .map((event) => event.data.file),
  );
  for (const file of [...executed].sort()) {
    yield `# product-suite-executed-file ${file}\n`;
  }

  yield* tap(events);
}
