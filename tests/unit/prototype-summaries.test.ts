import { describe, expect, it } from "vitest";
import { EditorEngine } from "../../src/engine/editor";
import { actionSummary, interactionTargets, navigationTargets, newInteractionAction, triggerSummary } from "../../src/engine/prototype-summaries";

// Following native ui-egui/src/panels/proto_panel.rs (trigger_summary, action_summary, action_of, targets_for, nav_targets) at bad07e44.
const id = (v: unknown) => String((v as { id: unknown }).id);
describe("the prototype tab's summaries and defaults", () => {
  it("names triggers as the list shows them", () => {
    expect(triggerSummary({ type: "onHover" })).toBe("While hovering");
    expect(triggerSummary({ type: "keyPress", key: "" })).toBe("Key/Gamepad");
    expect(triggerSummary({ type: "keyPress", key: "Space" })).toBe("Key/Gamepad Space");
    expect(triggerSummary({ type: "keyPress", key: "Gamepad A" })).toBe("Gamepad A");
    expect(triggerSummary({ type: "afterDelay", ms: 800 })).toBe("After delay 800ms");
  });
  it("summarises actions and picks the defaults native's panel adds", () => {
    const e = new EditorEngine();
    const a = id(e.execute("frame.create", { x: 0, y: 0, width: 100, height: 100, name: "A" }));
    const b = id(e.execute("frame.create", { x: 200, y: 0, width: 100, height: 100, name: "B" }));
    const r = id(e.execute("shape.rectangle", { x: 10, y: 10, width: 10, height: 10, parent: a }));
    const sec = id(e.execute("node.create", { type: "section", x: 0, y: 400, width: 100, height: 100 }));
    e.execute("variable.createCollection", { name: "Theme", modes: ["Light", "Dark"] });
    e.execute("variable.create", { collection: "Theme", name: "count", type: "number", value: 0 });
    const doc = e.getSnapshot().document, v = doc.variables!, count = v.variables[0].id, theme = v.collections[0];
    expect(actionSummary(doc, { type: "navigate", dest: b })).toBe("Navigate to B");
    expect(actionSummary(doc, { type: "navigate", dest: "999" })).toBe("Navigate to Missing layer");
    expect(actionSummary(doc, { type: "back" })).toBe("Back");
    expect(actionSummary(doc, { type: "openUrl", url: "https://example.invalid" })).toBe("Open link https://example.invalid");
    expect(actionSummary(doc, { type: "openUrl", url: "" })).toBe("Open link");
    expect(actionSummary(doc, { type: "setVariable", variable: count, value: 1 })).toBe("Set variable count");
    expect(actionSummary(doc, { type: "setVariable", variable: count, value: null, expr: { op: { op: "add", args: [{ value: { type: "alias", value: count } }, { value: { type: "number", value: 1 } }] } } })).toBe("Set count to count + 1");
    expect(actionSummary(doc, { type: "setVariableMode", collection: theme.id, mode: theme.modes[1].id })).toBe("Set Theme to Dark");
    expect(actionSummary(doc, { type: "conditional", blocks: [{ actions: [] }] })).toBe("Conditional");
    expect(newInteractionAction(doc, doc.currentPage, r)).toEqual({ type: "navigate", dest: b });
    expect(newInteractionAction(doc, doc.currentPage, b)).toEqual({ type: "navigate", dest: a });
    expect(navigationTargets(doc, doc.currentPage)).toEqual([a, b, sec]);
    expect(interactionTargets(doc, [a, b], a)).toEqual([a, b]);
    e.execute("proto.interaction.add", { id: Number(a), dest: Number(b) });
    expect(interactionTargets(e.getSnapshot().document, [a, b], a)).toEqual([a]);
    const empty = new EditorEngine(), d = empty.getSnapshot().document;
    expect(newInteractionAction(d, d.currentPage, d.currentPage)).toEqual({ type: "back" });
  });
});
