import { expect, it } from "vitest";
import { EditorWorkspace } from "../../src/engine/workspace";
import cases from "../fixtures/native-property-clipboard.json";

it.each(cases)("replays the native property clipboard for $name", async ({ commands, results }) => {
  const workspace = new EditorWorkspace();
  for (const [index, entry] of commands.entries()) {
    const command = String(entry[0]), p = entry[1] as Record<string, unknown>, engine = workspace.activeEngine!;
    const result = command === "file.new" ? workspace.execute(command, p)
      : command === "text.create" ? await engine.executeAsync(command, p) : engine.execute(command, p);
    const expected = (results as Record<number, unknown>)[index];
    if (expected) expect(result).toEqual(expected);
  }
});

it("retains copied page appearance in a native archive and clears properties on sign-out", async () => {
  const workspace = new EditorWorkspace(), engine = workspace.activeEngine!;
  engine.execute("shape.rectangle", { props: { fill: "#123456", stroke: "#112233", strokeWeight: 7, opacity: 0.6, blend: "multiply" } });
  engine.execute("edit.copyProperties");
  engine.execute("edit.pasteProperties", { id: 1 });
  const before = engine.execute("edit.copyProperties", { id: 1 });
  const file = await engine.nativeSnapshot();
  await workspace.open(new File([Uint8Array.from(file)], "Appearance.figcraft"));
  expect(workspace.activeEngine!.execute("edit.copyProperties", { id: 1 })).toEqual(before);
  workspace.setEditable(false); workspace.setEditable(true);
  expect(() => workspace.activeEngine!.execute("edit.pasteProperties", { id: 1 })).toThrow(/no copied properties/i);
});
