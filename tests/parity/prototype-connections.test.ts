import { describe, expect, it } from "vitest";
import { EditorEngine } from "../../src/engine/editor";
import type { Document, NodeId } from "../../src/engine/document";
import { bezierAt, bezierDistance, connections, curveBetween, targetAt } from "../../src/engine/prototype-connections";
import { topLevelFrame } from "../../src/engine/prototype-commands";
import { boundsOf } from "../../src/engine/viewport";

// Restated from native ui-egui/src/canvas/proto_canvas.rs (curves_leave_the_facing_side) and
// ui-egui/src/proto_variant_connect_tests.rs at bad07e44 (delta item 5.3: #2158, #2161), at the drop point in page units.
const id = (v: unknown) => String((v as { id: unknown }).id);
const centre = (doc: Document, n: NodeId) => { const b = boundsOf(doc, [n])!; return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };

function setup(grouped = false) {
  const e = new EditorEngine();
  const variant = (name: string, x: number) => id(e.execute("component.create", { ids: [Number(id(e.execute("frame.create", { x, y: 0, width: 100, height: 80, name })))] }));
  const def = variant("Property 1=Default", 0), hover = variant("Property 1=Hover", 300);
  const layer = id(e.execute("shape.rectangle", { x: 10, y: 10, width: 30, height: 20, parent: def }));
  const outside = id(e.execute("frame.create", { x: 0, y: 500, width: 200, height: 150, name: "Outside" }));
  const set = id(e.execute("component.combineVariants", { ids: [Number(def), Number(hover)] }));
  if (grouped) {
    const group = id(e.execute("object.group", { ids: [Number(set)] }));
    const section = id(e.execute("node.create", { type: "section", x: -200, y: -200, width: 1000, height: 1000 }));
    e.execute("node.reparent", { ids: [Number(group)], parent: Number(section) });
    expect(topLevelFrame(e.getSnapshot().document, def)).toBeUndefined();
  }
  return { e, set, def, hover, layer, outside };
}

describe("prototype connections on the canvas, as native's tests pin them", () => {
  it("leaves the side facing the destination", () => {
    const a = { x0: 0, y0: 0, x1: 50, y1: 20 }, b = { x0: 200, y0: 100, x1: 300, y1: 300 };
    const c = curveBetween(a, b);
    expect([c[0], c[3]]).toEqual([{ x: 50, y: 10 }, { x: 200, y: 200 }]);
    const back = curveBetween(b, a);
    expect([back[0], back[3]]).toEqual([{ x: 200, y: 200 }, { x: 50, y: 10 }]);
    expect(bezierDistance(c, bezierAt(c, 0.5))).toBeLessThan(0.5);
    expect(bezierDistance(c, { x: 0, y: 300 })).toBeGreaterThan(50);
  });

  it("changes a variant, or a layer in it, to the sibling it is dropped on, and back", () => {
    const { e, def, hover, layer } = setup(), doc = e.getSnapshot().document, page = doc.currentPage;
    expect(targetAt(doc, page, def, centre(doc, hover))).toEqual({ kind: "changeTo", node: hover });
    expect(targetAt(doc, page, hover, centre(doc, def))).toEqual({ kind: "changeTo", node: def });
    expect(targetAt(doc, page, layer, centre(doc, hover))).toEqual({ kind: "changeTo", node: hover });
  });

  it("adds nothing on the set's background or the source's own variant, also in a grouped set", () => {
    for (const grouped of [false, true]) {
      const { e, def, hover } = setup(grouped), doc = e.getSnapshot().document, page = doc.currentPage;
      const a = centre(doc, def), b = centre(doc, hover);
      expect(targetAt(doc, page, def, { x: (a.x + b.x) / 2, y: a.y }), String(grouped)).toBeUndefined();
      expect(targetAt(doc, page, def, a)).toBeUndefined();
      expect(targetAt(doc, page, def, b)).toEqual({ kind: "changeTo", node: hover });
    }
  });

  it("still navigates from a variant to a frame outside its set", () => {
    const { e, def, outside } = setup(), doc = e.getSnapshot().document;
    expect(targetAt(doc, doc.currentPage, def, centre(doc, outside))).toEqual({ kind: "navigate", node: outside });
  });

  it("lists each interaction with a destination on the page as a connection", () => {
    const { e, def, hover, outside } = setup();
    e.execute("proto.interaction.add", { id: Number(def), action: { type: "changeTo", dest: Number(hover) } });
    e.execute("proto.interaction.add", { id: Number(def), action: { type: "back" } });
    e.execute("proto.interaction.add", { id: Number(outside), action: { type: "conditional", blocks: [{ actions: [{ type: "navigate", dest: Number(def) }] }] } });
    expect(connections(e.getSnapshot().document, e.getSnapshot().document.currentPage)).toEqual([{ source: def, index: 0, dest: hover }, { source: outside, index: 0, dest: def }]);
  });
});
