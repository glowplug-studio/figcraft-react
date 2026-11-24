import { expect, it } from "vitest";
import { EditorEngine } from "../../src/engine/editor";
import native from "../fixtures/native-component-create-set.json" with { type: "json" };

// Restates native crates/engine/src/components_behaviour_tests.rs create_set_* at bad07e44 (upstream 524ad8b1, 253e0c3d, dda27030).
function pick(command: string, v: Record<string, unknown>) {
  if (command === "component.createSet") return { id: Number(v.id) };
  const kids = (v.children as Record<string, unknown>[] | undefined) ?? [];
  return { id: Number(v.id), type: v.type, name: v.name, x: v.x, y: v.y, width: v.width, height: v.height,
    children: kids.map(c => ({ id: Number(c.id), type: c.type, name: c.name, x: c.x, y: c.y })) };
}

for (const scene of native.cases) {
  it("Create component set as native: " + scene.name, () => {
    const e = new EditorEngine();
    for (const step of scene.steps) {
      const before = e.getSnapshot(), depth = e.getUndoDepth();
      let got: Record<string, unknown> | undefined, refused = false;
      try { got = e.execute(step.command, step.params) as Record<string, unknown>; } catch { refused = true; }
      if (!step.receipt) continue;
      if ("refused" in step.receipt) {
        expect(refused, JSON.stringify(step.params)).toBe(true);
        // A refusal leaves the document, the selection and the undo history alone.
        expect([e.getSnapshot().document, e.getSnapshot().selection, e.getUndoDepth()]).toEqual([before.document, before.selection, depth]);
      } else {
        expect(pick(step.command, got!), step.command + " " + JSON.stringify(step.params)).toEqual(step.receipt);
        if (step.command === "component.createSet") {
          expect(e.getUndoDepth(), "one undo step").toBe(depth + 1);
          expect(e.getSnapshot().selection, "the set is selected").toEqual([String(got!.id)]);
        }
      }
    }
  });
}
