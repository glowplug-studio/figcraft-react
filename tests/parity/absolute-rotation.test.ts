import { describe, expect, it } from "vitest";
import fixture from "../fixtures/native-absolute-rotation.json";
import { EditorEngine } from "../../src/engine/editor";
import type { LayerNode } from "../../src/engine/document";
import { shownGeometry } from "../../src/engine/geometry-fields";

// `node.set absoluteRotation` sets a layer's rotation on the page (its own angle plus its parents'), keeping its
// centre, while `rotation` stays the angle to the parent. Observed through the native engine at bad07e44 (upstream
// d0379dc7, cc367717; #2196; tests/fixtures/native-absolute-rotation.provenance.md). The sequences restate
// crates/engine/src/transform_behaviour_tests.rs and rotation_origin_tests.rs.

const cases = fixture.cases as unknown as { name: string; commands: [string, Record<string, unknown>][]; receipts: Record<string, unknown>[] }[];
function replay(name: string) {
  const c = cases.find(x => x.name === name)!, engine = new EditorEngine();
  for (const [command, params] of c.commands) { try { engine.execute(command, params); } catch { /* a refused step */ } }
  return engine;
}

describe("native rotation on the page", () => {
  it.each(cases.map(c => [c.name, c] as const))("%s", (_name, c) => {
    const engine = new EditorEngine();
    for (const [i, [command, params]] of c.commands.entries()) {
      const expected = c.receipts[i], why = `${command} ${JSON.stringify(params)} (step ${i})`;
      if ("error" in expected) {
        const before = engine.getSnapshot();
        expect(() => engine.execute(command, params), why).toThrow();
        expect(engine.getSnapshot(), `${why}: a refused edit changes nothing`).toBe(before);
      } else {
        const actual = engine.execute(command, params);
        if (command === "node.get") expect(actual, why).toEqual(expected);
      }
    }
  });

  it("names what was wrong, as native does", () => {
    const engine = new EditorEngine();
    engine.execute("shape.rectangle", { x: 0, y: 0, width: 10, height: 10 });
    expect(() => engine.execute("node.set", { ids: [2], props: { rotation: 1, absoluteRotation: 2 } })).toThrow(/one of `rotation` and `absoluteRotation`/);
    expect(() => engine.execute("node.set", { ids: [2], props: { absoluteRotation: "abc" } })).toThrow(/absoluteRotation/);
  });

  // crates/ui-egui/src/panels/right.rs::rot_of: the Rotation field shows the rotation on the page.
  it("shows the rotation on the page in the Rotation field", () => {
    const engine = replay("absoluteRotation sets the rotation on the page, keeping the centre");
    const doc = () => engine.getSnapshot().document, node = (id: string) => doc().nodes[id] as LayerNode;
    expect(shownGeometry(doc(), node("2"), "rotation")).toBe(10);
    expect(shownGeometry(doc(), node("3"), "rotation"), "the layer's own angle is -10; on the page it reads 0").toBe(0);
    engine.execute("node.set", { ids: [3], props: { absoluteRotation: 7 } });
    expect(shownGeometry(doc(), node("3"), "rotation")).toBe(7);
  });

  // crates/ui-egui/src/field_tests.rs::the_rotation_field_shows_and_sets_the_rotation_on_the_page (its Mixed part)
  // and a_relative_rotation_edit_turns_a_selected_parent_before_its_child_whatever_the_selection_order.
  it("reads Mixed by page angle and applies a relative edit to each layer's page angle, parents first", () => {
    const engine = new EditorEngine(), id = (command: string, params: Record<string, unknown>) => String(engine.execute(command, params).id);
    const page = (layer: string) => shownGeometry(engine.getSnapshot().document, engine.getSnapshot().document.nodes[layer] as LayerNode, "rotation");
    const f = id("frame.create", { x: 0, y: 100, width: 400, height: 400 });
    engine.execute("node.set", { ids: [f], props: { rotation: 10 } });
    const r = id("shape.rectangle", { x: 100, y: 100, width: 120, height: 80, parent: f });
    const b = id("shape.rectangle", { x: 600, y: 0, width: 50, height: 50 });
    engine.execute("node.set", { ids: [r], props: { absoluteRotation: 33 } }); engine.execute("node.set", { ids: [b], props: { rotation: 33 } });
    expect([page(r), page(b)], "layers in differently turned parents agree when their page angles do").toEqual([33, 33]);
    engine.execute("node.set", { ids: [b], props: { rotation: 20 } });
    engine.execute("select.set", { ids: [r, b] });
    const before = engine.getSnapshot().document;
    expect(engine.editMixedGeometry("rotation", { kind: "add", value: 10 })).toEqual([]);
    expect([page(r), page(b)]).toEqual([43, 30]);
    engine.execute("edit.undo"); expect(engine.getSnapshot().document, "one undo step").toBe(before);

    const other = new EditorEngine(), make = (command: string, params: Record<string, unknown>) => String(other.execute(command, params).id);
    const angle = (layer: string) => shownGeometry(other.getSnapshot().document, other.getSnapshot().document.nodes[layer] as LayerNode, "rotation");
    const frame = make("frame.create", { x: 0, y: 0, width: 400, height: 400 }), child = make("shape.rectangle", { x: 100, y: 100, width: 120, height: 80, parent: frame });
    other.execute("node.set", { ids: [frame], props: { rotation: 10 } }); other.execute("node.set", { ids: [child], props: { absoluteRotation: 30 } });
    // The child first, then its parent.
    other.execute("select.set", { ids: [child, frame] });
    expect(other.editMixedGeometry("rotation", { kind: "add", value: 10 })).toEqual([]);
    expect([angle(frame), angle(child)]).toEqual([20, 40]);
  });
});
