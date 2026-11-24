import { expect, it } from "vitest";
import { EditorEngine } from "../../src/engine/editor";
import fixture from "../fixtures/native-wrap-style-creation.json";

type Receipt = Record<string, unknown>;

it.each(fixture.cases)("$name", async ({ steps }) => {
  const engine = new EditorEngine();
  for (const [index, { command, params, expected }] of steps.entries()) {
    const actual = await engine.executeAsync(command, params);
    const context = `${index + 1}. ${command}`;
    if (command === "node.get") {
      const node = actual as Receipt;
      expect({
        wrapStyle: node.wrapStyle ?? null,
        lineWrapStyles: node.lineWrapStyles ?? null,
        textStyleRanges: node.textStyleRanges ?? null,
        textStyle: (node.styles as Receipt | undefined)?.text ?? null,
      }, context).toEqual(expected);
    } else if (command === "style.list") {
      if (!Array.isArray(actual)) throw new Error(`${context}: expected a style list`);
      expect(actual.map(({ id, name, paragraph }: Receipt) => ({ id, name, paragraph: paragraph ?? null })), context).toEqual(expected);
    } else if (command === "style.create") {
      expect(actual, context).toEqual(expected);
    }
  }
});
