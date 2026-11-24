import { beforeAll, describe, expect, it } from "vitest";
import { prepareText } from "../../src/engine/text-node-layout";
import { EditorEngine } from "../../src/engine/editor";
import type { Document, NodeId } from "../../src/engine/document";
import { branch, changeToTarget, hotspots, literal, navigateTarget, playInteractions, rememberSections, setMode, setVariable } from "../../src/engine/prototype-runtime";
import type { PrototypeExpression } from "../../src/engine/prototype-data";
import { resolveVariable } from "../../src/engine/variables";
import { toCssHex } from "../../src/engine/colour";
import { rectanglePaints } from "../../src/engine/document";

// Restated from native engine/src/proto_run_tests.rs, proto_behaviour_tests.rs and section_contents_tests.rs at bad07e44.
const id = (v: unknown) => String((v as { id: unknown }).id);
const num = (n: number): PrototypeExpression => ({ value: { type: "number", value: n } });
const ref = (v: string): PrototypeExpression => ({ value: { type: "alias", value: v } });
const op = (o: "add" | "equals" | "greater" | "divide", args: PrototypeExpression[]): PrototypeExpression => ({ op: { op: o, args } });
const varId = (doc: Document, name: string) => doc.variables!.variables.find(v => v.name === name)!.id;
const chars = (doc: Document, t: NodeId) => (doc.nodes[t] as { text?: { characters: string } }).text?.characters;
const fillHex = (doc: Document, r: NodeId) => {
  const p = rectanglePaints(doc.nodes[r] as never)[0];
  return p?.type === "solid" ? toCssHex({ ...p.color, a: 1 }).slice(1) : undefined;
};

/** Two frames; a counter, a label and a colour in Light and Dark; a text bound to the label and a rectangle bound to the colour. */
function setup() {
  const e = new EditorEngine();
  const a = id(e.execute("frame.create", { x: 0, y: 0, width: 100, height: 100, name: "A" }));
  const b = id(e.execute("frame.create", { x: 200, y: 0, width: 100, height: 100, name: "B" }));
  const t = id(e.execute("text.create", { text: "x", x: 10, y: 10, parent: a }));
  const r = id(e.execute("shape.rectangle", { x: 10, y: 50, width: 10, height: 10, parent: a }));
  e.execute("variable.createCollection", { name: "Theme", modes: ["Light", "Dark"] });
  for (const [name, type, value] of [["count", "number", 0], ["label", "string", "Zero"], ["bg", "color", "#FFFFFF"]] as const)
    e.execute("variable.create", { collection: "Theme", name, type, value });
  e.execute("variable.set", { variable: "bg", mode: "Dark", value: "#000000" });
  e.execute("variable.bind", { ids: [t], field: "characters", variable: "label" });
  e.execute("variable.bind", { ids: [r], field: "fill", variable: "bg" });
  return { e, a, b, t, r };
}

describe("the prototype runtime, as native's tests pin it", () => {
  beforeAll(async () => { await prepareText("x Count: 2 Done Zero"); });
  it("parses literals by the variable type", () => {
    expect(literal("number", "4")).toEqual({ type: "number", value: 4 });
    expect(literal("boolean", true)).toEqual({ type: "boolean", value: true });
    expect(literal("boolean", {})).toBeUndefined();
    expect(literal("string", 3)).toEqual({ type: "string", value: "3" });
    expect(literal("color", "#FF0000")?.type).toBe("color");
    expect(literal("number", "lots")).toBeUndefined();
  });

  it("sets variables, evaluating expressions where the layer is", () => {
    const { e, a, t } = setup();
    let doc = e.getSnapshot().document;
    const count = varId(doc, "count"), label = varId(doc, "label");
    const inc = op("add", [ref(count), num(1)]);
    for (let k = 0; k < 2; k++) doc = setVariable(doc, a, count, null, inc)!;
    expect(resolveVariable(doc.variables!, count)).toEqual({ type: "number", value: 2 });
    doc = setVariable(doc, t, label, null, op("add", [{ value: { type: "string", value: "Count: " } }, ref(count)]))!;
    expect(chars(doc, t)).toBe("Count: 2");
    // A number fits a text variable as text; a boolean does not fit a number.
    doc = setVariable(doc, t, label, null, ref(count))!;
    expect(chars(doc, t)).toBe("2");
    expect(setVariable(doc, a, count, null, op("equals", [ref(count), num(2)]))).toBeUndefined();
    // Errors leave the value alone.
    expect(setVariable(doc, a, count, null, op("divide", [ref(count), num(0)]))).toBeUndefined();
    expect(setVariable(doc, a, count, null, ref("nope"))).toBeUndefined();
    expect(setVariable(doc, a, "nope", 1)).toBeUndefined();
    expect(resolveVariable(doc.variables!, count)).toEqual({ type: "number", value: 2 });
    doc = setVariable(doc, a, label, "Done")!;
    expect(chars(doc, t)).toBe("Done");
  });

  it("switches the prototype's mode and keeps choices made inside a frame", () => {
    const { e, a, b, r } = setup();
    e.execute("variable.setMode", { ids: [b], collection: "Theme", mode: "Light" });
    const g = id(e.execute("frame.create", { x: 40, y: 40, width: 20, height: 20, parent: a }));
    const r2 = id(e.execute("shape.rectangle", { x: 0, y: 0, width: 5, height: 5, parent: g }));
    e.execute("variable.bind", { ids: [r2], field: "fill", variable: "bg" });
    e.execute("variable.setMode", { ids: [g], collection: "Theme", mode: "Light" });
    let doc = e.getSnapshot().document;
    const theme = doc.variables!.collections[0], dark = theme.modes.find(m => m.name === "Dark")!.id;
    expect(fillHex(doc, r)).toBe("FFFFFF");
    doc = setMode(doc, a, theme.id, dark)!;
    expect(fillHex(doc, r)).toBe("000000");
    expect(fillHex(doc, r2)).toBe("FFFFFF");
    expect(doc.nodes[doc.currentPage].variableModes?.[theme.id]).toBe(dark);
    expect(doc.nodes[b].variableModes?.[theme.id]).toBe(dark);
    doc = setMode(doc, b, "Theme", "Light")!;
    expect(fillHex(doc, r)).toBe("FFFFFF");
    expect(setMode(doc, a, "Theme", "nope")).toBeUndefined();
    expect(setMode(doc, a, "Nope", dark)).toBeUndefined();
  });

  it("chooses conditional branches by the variables", () => {
    const { e, a, b } = setup();
    const doc = e.getSnapshot().document, count = varId(doc, "count");
    const blocks = [
      { condition: op("greater", [ref(count), num(5)]), actions: [{ type: "navigate" as const, dest: b }] },
      { condition: op("equals", [ref(count), num(0)]), actions: [{ type: "back" as const }] },
      { actions: [{ type: "closeOverlay" as const }] },
    ];
    expect(branch(doc, a, blocks)).toEqual([{ type: "back" }]);
    let d2 = setVariable(doc, a, count, 9)!;
    expect(branch(d2, a, blocks)).toEqual([{ type: "navigate", dest: b }]);
    d2 = setVariable(d2, a, count, 3)!;
    expect(branch(d2, a, blocks)).toEqual([{ type: "closeOverlay" }]);
    expect(branch(d2, a, blocks.slice(0, 1))).toEqual([]);
    expect(branch(d2, a, [{ condition: ref("nope"), actions: [{ type: "back" }] }])).toEqual([]);
  });

  it("navigates into sections: their first frame, then the one shown last", () => {
    const e = new EditorEngine();
    const section = (x: number, y: number, w: number, h: number) => id(e.execute("node.create", { type: "section", x, y, width: w, height: h }));
    const sec = section(0, 0, 800, 400), inner = section(0, 0, 300, 300);
    e.execute("node.reparent", { ids: [inner], parent: sec });
    const a = id(e.execute("frame.create", { x: 400, y: 20, width: 100, height: 100, parent: sec }));
    const b = id(e.execute("frame.create", { x: 20, y: 20, width: 100, height: 100, parent: inner }));
    const child = id(e.execute("shape.rectangle", { x: 1, y: 1, width: 10, height: 10, parent: b }));
    const doc = e.getSnapshot().document, visited = new Map<NodeId, NodeId>();
    expect(navigateTarget(doc, sec, visited)).toBe(b);
    rememberSections(doc, a, visited);
    expect(navigateTarget(doc, sec, visited)).toBe(a);
    expect(navigateTarget(doc, inner, visited)).toBe(b);
    expect(navigateTarget(doc, child, visited)).toBe(b);
    const empty = section(0, 900, 50, 50);
    expect(navigateTarget(e.getSnapshot().document, empty, visited)).toBeUndefined();
  });

  it("plays a variant's interactions on its instances, and Change to changes the button", () => {
    const e = new EditorEngine();
    const iconFrame = id(e.execute("frame.create", { x: 0, y: 300, width: 10, height: 10, name: "Icon" }));
    const icon = id(e.execute("component.create", { ids: [iconFrame] }));
    const variants: NodeId[] = [];
    for (const [k, state] of ["Default", "Pressed"].entries()) {
      const f = id(e.execute("frame.create", { x: k * 150, y: 0, width: 100, height: 40, name: `State=${state}` }));
      e.execute("shape.rectangle", { x: 0, y: 0, width: 100, height: 40, parent: f, props: { name: "Bg" } });
      e.execute("instance.create", { component: icon, x: 4, y: 4, parent: f });
      variants.push(id(e.execute("component.create", { ids: [f] })));
    }
    const set = id(e.execute("component.combineVariants", { ids: variants }));
    const [def, pressed] = variants;
    for (const trigger of ["onClick", "onPress"]) e.execute("proto.interaction.add", { id: def, trigger: { type: trigger }, action: { type: "changeTo", dest: Number(pressed) } });
    e.execute("proto.interaction.add", { id: pressed, trigger: { type: "onClick" }, action: { type: "changeTo", dest: Number(def) } });
    const screen = id(e.execute("frame.create", { x: 0, y: 500, width: 300, height: 300, name: "Screen" }));
    const button = id(e.execute("instance.create", { component: set, x: 20, y: 20, parent: screen }));
    const nestedOf = (doc: Document) => {
      const walk = (n: NodeId): NodeId | undefined => {
        for (const c of (doc.nodes[n] as { children?: readonly NodeId[] }).children ?? []) { if (doc.nodes[c].kind === "instance") return c; const f = walk(c); if (f) return f; }
      };
      return walk(button)!;
    };
    const triggers = (d: Document, n: NodeId) => (d.nodes[n].interactions ?? []).map(it => it.trigger.type);
    let play = e.getSnapshot().document;
    expect(triggers(play, button)).toEqual([]);
    play = playInteractions(play);
    expect(triggers(play, button)).toEqual(["onClick", "onPress"]);
    expect(hotspots(play, screen)[0]?.[0]).toBe(button);
    // The instance's own click wins over the main's.
    e.execute("proto.interaction.add", { id: button, trigger: { type: "onClick" }, action: { type: "back" } });
    play = playInteractions(e.getSnapshot().document);
    const its = play.nodes[button].interactions!;
    expect(its.length).toBe(2);
    expect([its[0].trigger.type, its[0].actions]).toEqual(["onClick", [{ type: "back" }]]);
    expect(its[1].trigger.type).toBe("onPress");
    const doc = e.getSnapshot().document, nested = nestedOf(doc);
    expect(changeToTarget(doc, nested, pressed)).toBe(button);
    expect(changeToTarget(doc, button, pressed)).toBe(button);
    expect(changeToTarget(doc, screen, pressed)).toBeUndefined();
    // Shown as Pressed it plays Pressed's interactions, also when it holds copies of Default's.
    const defaultIts = doc.nodes[def].interactions!;
    e.execute("proto.interaction.clear", { ids: [button] });
    e.execute("instance.setProperties", { ids: [button], properties: { State: "Pressed" } });
    const shown = e.getSnapshot().document;
    play = playInteractions({ ...shown, nodes: { ...shown.nodes, [button]: { ...shown.nodes[button], interactions: defaultIts } } } as Document);
    const now = play.nodes[button].interactions!;
    expect(now.length).toBe(1);
    expect(now[0].actions[0]).toMatchObject({ type: "changeTo", dest: def });
  });

  it("offers hotspots bottom-most first, clipped, without hidden layers", () => {
    const e = new EditorEngine();
    const a = id(e.execute("frame.create", { x: 0, y: 0, width: 300, height: 300, name: "A" }));
    const b = id(e.execute("frame.create", { x: 400, y: 0, width: 300, height: 300, name: "B" }));
    const card = id(e.execute("frame.create", { x: 20, y: 20, width: 200, height: 100, parent: a, name: "Card" }));
    e.execute("node.set", { id: card, props: { clip: true } });
    const rect = (name: string, parent: NodeId, x: number, y: number) => id(e.execute("shape.rectangle", { x, y, width: 60, height: 40, parent, props: { name } }));
    const button = rect("Button", card, 30, 30), edge = rect("Edge", card, 190, 30), away = rect("Away", card, 260, 30);
    const hidden = rect("Hidden", a, 30, 200), cover = rect("Cover", a, 30, 30);
    for (const n of [card, button, edge, away, hidden]) e.execute("proto.interaction.add", { id: n, dest: Number(b) });
    e.execute("node.set", { id: hidden, props: { visible: false } });
    const hot = hotspots(e.getSnapshot().document, a), ids = hot.map(h => h[0]);
    expect(ids).toEqual([card, button, edge]);
    expect(ids).not.toContain(cover);
    expect(ids).not.toContain(away);
    expect([hot[2][1].x0, hot[2][1].x1]).toEqual([210, 220]);
  });
});

// Native instances.rs and patch.rs, observed at bad07e44 (native-instance-interactions.json): a new instance starts with no
// interactions and keeps only its own when its main changes; the main's play on it in prototypes.
import nativeInstances from "../fixtures/native-instance-interactions.json" with { type: "json" };
import { stringify } from "lossless-json";
import { wireInteractions } from "../../src/engine/prototype-data";
it("keeps an instance's own interactions apart from its main's, as native does", () => {
  const e = new EditorEngine();
  for (const step of nativeInstances.steps as { command: string; params: Record<string, unknown>; saved?: Record<string, unknown>; error?: string }[]) {
    if (step.saved) {
      const doc = e.getSnapshot().document;
      for (const [n, expected] of Object.entries(step.saved))
        expect(doc.nodes[n].interactions ? JSON.parse(stringify(wireInteractions(doc.nodes[n].interactions!))!) : null, n).toEqual(expected ?? null);
      continue;
    }
    e.execute(step.command, step.params);
  }
});
