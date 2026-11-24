import { expect, it } from "vitest";
import { EditorEngine } from "../../src/engine/editor";
import { alignBlockedByAutoLayout, canAlign } from "../../src/engine/arrange";
import native from "../fixtures/native-align-auto-layout.json" with { type: "json" };

for (const scene of native.cases) {
  it("Align in an auto layout flow as native: " + scene.name, () => {
    const e = new EditorEngine();
    for (const [i, [command, params]] of scene.commands.entries()) {
      const before = e.getSnapshot().document, want = scene.receipts[i] as Record<string, unknown> | null;
      const got = e.execute(command as string, params) as Record<string, unknown>;
      if (command === "node.get") {
        const layout = got.layout as Record<string, unknown> | undefined;
        expect(want && "layout" in want ? { layout: { mode: layout?.mode, mainAlign: layout?.mainAlign, crossAlign: layout?.crossAlign } }
          : { id: Number(got.id), x: got.x, y: got.y, width: got.width, height: got.height }).toEqual(want);
      }
      // Native's align_target gives none: the command changes nothing, so no undo step either.
      if ((command as string).startsWith("align.") && !scene.name.startsWith("absolute")) expect(e.getSnapshot().document).toBe(before);
    }
  });
}

it("greys out Align for one layer its auto layout frame places, not for an absolute child or several layers", () => {
  const e = new EditorEngine();
  for (const [command, params] of native.cases[0].commands.slice(0, 4)) e.execute(command as string, params);
  const doc = () => e.getSnapshot().document;
  expect([canAlign(doc(), ["4"]), alignBlockedByAutoLayout(doc(), ["4"])]).toEqual([false, true]);
  expect([canAlign(doc(), ["3", "4"]), alignBlockedByAutoLayout(doc(), ["3", "4"])]).toEqual([true, false]);
  e.execute("node.set", { id: 3, props: { absolute: true } });
  expect([canAlign(doc(), ["3"]), alignBlockedByAutoLayout(doc(), ["3"])]).toEqual([true, false]);
  expect([canAlign(doc(), ["2"]), alignBlockedByAutoLayout(doc(), ["2"])]).toEqual([false, false]);
});
