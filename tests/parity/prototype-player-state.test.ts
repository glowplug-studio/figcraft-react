import { describe, expect, it } from "vitest";
import { EditorEngine } from "../../src/engine/editor";
import type { Document, NodeId } from "../../src/engine/document";
import { rectanglePaints } from "../../src/engine/document";
import { toCssHex } from "../../src/engine/colour";
import { boundsOf } from "../../src/engine/viewport";
import { PrototypePlayer, type OverlayState } from "../../src/engine/prototype-player";
import { applyScroll, scrollRange, scrollRangeIn, viewport } from "../../src/engine/prototype-scroll";
import { resolveVariable } from "../../src/engine/variables";
import type { PrototypeAction, PrototypeInteraction } from "../../src/engine/prototype-data";

// Restated from native ui-egui/src/present/tests.rs and present/variables_tests.rs at bad07e44 (the cases that drive the player directly).
const id = (v: unknown) => String((v as { id: unknown }).id);
const y0 = (doc: Document, n: NodeId) => boundsOf(doc, [n])!.y;
const set = (e: EditorEngine, n: NodeId, props: Record<string, unknown>) => e.execute("node.set", { id: n, props });
const instant = { type: "instant" as const };

function twoFrames() {
  const e = new EditorEngine();
  const a = id(e.execute("frame.create", { x: 0, y: 0, width: 200, height: 400, name: "A" }));
  const b = id(e.execute("frame.create", { x: 300, y: 0, width: 200, height: 400, name: "B" }));
  return { e, a, b };
}
/** A page on an iPhone 16 (393×852): a tall A scrolling vertically with a tab bar fixed to its bottom, a nested scrolling list and an item at its end; B. */
function deviceDoc() {
  const e = new EditorEngine();
  e.execute("proto.settings", { device: "iPhone 16" });
  const a = id(e.execute("frame.create", { x: 0, y: 0, width: 393, height: 2000, name: "A" }));
  const b = id(e.execute("frame.create", { x: 500, y: 0, width: 393, height: 1500, name: "B" }));
  for (const f of [a, b]) set(e, f, { overflow: "vertical" });
  const bar = id(e.execute("shape.rectangle", { x: 0, y: 1940, width: 393, height: 60, parent: a, props: { name: "Tab bar" } }));
  set(e, bar, { scrollPosition: "fixed", constraints: { horizontal: "left", vertical: "bottom" } });
  const list = id(e.execute("frame.create", { x: 0, y: 1200, width: 393, height: 300, parent: a, name: "List" }));
  set(e, list, { overflow: "vertical" });
  const item = id(e.execute("shape.rectangle", { x: 0, y: 700, width: 393, height: 100, parent: list, props: { name: "Item" } }));
  return { e, a, b, bar, list, item };
}
const playerOn = (doc: Document, start: NodeId) => { const p = new PrototypePlayer(start); p.sync(doc, 0); return p; };

describe("the prototype player's state, as native's tests pin it", () => {
  it("animates closed overlays out unless instant", () => {
    const { a, b } = twoFrames();
    const p = new PrototypePlayer(a);
    const ov = (type: "dissolve" | "instant", opened: number): OverlayState =>
      ({ id: b, position: "center", closeOnOutside: true, background: null, anchorTo: "screen", opened, transition: { type }, dur: 0.3, easing: "easeOut" });
    p.overlays.push(ov("dissolve", 0));
    expect(p.closeOverlay(10)).toBe(true);
    expect(p.overlays).toEqual([]);
    expect(p.closing.length).toBe(1);
    expect(p.closing[0][0]).toBe(10);
    p.overlays.push(ov("dissolve", 20));
    p.closeOverlay(20.15);
    expect(Math.abs(p.closing[1][0] - 20)).toBeLessThan(1e-9);
    p.overlays.push(ov("instant", 30));
    p.closeOverlay(31);
    expect(p.closing.length).toBe(2);
    expect(p.closeOverlay(32)).toBe(false);
  });

  it("scrolls content past fixed and sticky layers", () => {
    const { e, a } = twoFrames();
    set(e, a, { overflow: "vertical" });
    const long = id(e.execute("shape.rectangle", { x: 0, y: 0, width: 200, height: 1000, parent: a }));
    const fixed = id(e.execute("shape.rectangle", { x: 0, y: 350, width: 200, height: 50, parent: a }));
    const sticky = id(e.execute("shape.rectangle", { x: 0, y: 100, width: 200, height: 40, parent: a }));
    set(e, fixed, { scrollPosition: "fixed" });
    set(e, sticky, { scrollPosition: "sticky" });
    let d = e.getSnapshot().document;
    expect(scrollRange(d, a)).toEqual([0, 600]);
    set(e, a, { overflow: "horizontal" });
    expect(scrollRange(e.getSnapshot().document, a)).toEqual([0, 0]);
    set(e, a, { overflow: "vertical" });
    d = e.getSnapshot().document;
    let out = applyScroll(d, new Map([[a, [0, 50] as const]]));
    expect([y0(out, long), y0(out, fixed), y0(out, sticky)]).toEqual([-50, 350, 50]);
    out = applyScroll(d, new Map([[a, [0, 300] as const]]));
    expect([y0(out, long), y0(out, sticky)]).toEqual([-300, 0]);
  });

  it("clips the frame to a device's screen, which scrolls through its height", () => {
    const { e, a, bar, list } = deviceDoc();
    const d = e.getSnapshot().document;
    expect(viewport(d, a)).toEqual([393, 852]);
    expect(scrollRangeIn(d, a, viewport(d, a))).toEqual([0, 1148]);
    expect(scrollRange(d, a)).toEqual([0, 0]);
    expect(scrollRange(d, list)).toEqual([0, 500]);
    const p = playerOn(d, a);
    let disp = p.display()!;
    expect([(disp.nodes[a] as { width: number }).width, (disp.nodes[a] as { height: number }).height]).toEqual([393, 852]);
    expect(y0(disp, bar)).toBe(792);
    p.scrollTo(0, 400);
    disp = p.display()!;
    expect(y0(disp, bar)).toBe(792);
    expect(y0(disp, list)).toBe(800);
    p.scrollTo(0, 99_999);
    expect(p.scroll.get(a)).toEqual([0, 1148]);
    set(e, a, { overflow: "none" });
    const d2 = e.getSnapshot().document;
    expect(scrollRangeIn(d2, a, viewport(d2, a))).toEqual([0, 1148]);
    expect(scrollRange(d2, a)).toEqual([0, 0]);
    e.execute("proto.settings", { device: "None" });
    expect(viewport(e.getSnapshot().document, a)).toBeUndefined();
    const wide = deviceDoc();
    set(wide.e, wide.a, { width: 800, overflow: "both" });
    const d3 = wide.e.getSnapshot().document;
    expect(scrollRangeIn(d3, wide.a, viewport(d3, wide.a))).toEqual([407, 1148]);
  });

  it("scrolls every scrolling frame around a layer to it", () => {
    const { e, a, list, item } = deviceDoc();
    const d = e.getSnapshot().document;
    let p = playerOn(d, a);
    expect(p.perform({ type: "scrollTo", dest: item }, item, instant, 0, "linear", undefined, 1)).toBe(true);
    expect(p.scroll.get(list)).toEqual([0, 500]);
    expect(p.scroll.get(a)).toEqual([0, 1148]);
    p = playerOn(d, a);
    expect(p.perform({ type: "scrollTo", dest: list }, list, { type: "dissolve" }, 0.3, "linear", undefined, 1)).toBe(true);
    expect(p.scrollAnim!.frames).toEqual([[a, [0, 0], [0, 1148]]]);
  });

  it("starts a frame at its top unless navigation preserves the scroll", () => {
    const { e, a, b } = deviceDoc();
    const p = playerOn(e.getSnapshot().document, a);
    p.scrollTo(0, 600);
    expect(p.perform({ type: "navigate", dest: b }, a, instant, 0, "linear", undefined, 1)).toBe(true);
    expect(p.scroll.get(b)).toBeUndefined();
    p.restart(a, 2);
    p.scrollTo(0, 1000);
    expect(p.perform({ type: "navigate", dest: b, preserve_scroll: true }, a, instant, 0, "linear", undefined, 3)).toBe(true);
    expect(p.scroll.get(b)).toEqual([0, 648]);
    expect(p.perform({ type: "back" }, b, instant, 0, "linear", undefined, 4)).toBe(true);
    expect([p.current, p.scroll.get(a)]).toEqual([a, undefined]);
  });

  it("follows edits and keeps the screen", () => {
    const { e, a, b, list } = deviceDoc();
    const p = playerOn(e.getSnapshot().document, a);
    p.go(b, instant, 0, "linear", 1, true, false);
    p.scrollTo(0, 600);
    const same = e.getSnapshot().document;
    p.sync(same, 2);
    const rev = p.rev;
    p.sync(same, 2);
    expect(p.rev).toBe(rev);
    set(e, b, { height: 1000, name: "B2" });
    p.sync(e.getSnapshot().document, 3);
    expect(p.current).toBe(b);
    expect(p.doc!.nodes[b].name).toBe("B2");
    expect(p.scroll.get(b)).toEqual([0, 148]);
    expect(p.history.length).toBe(1);
    e.execute("edit.delete", { ids: [Number(b)] });
    p.sync(e.getSnapshot().document, 4);
    expect(p.current).toBe(a);
    expect(p.history.length === 0 && p.scroll.size === 0).toBe(true);
    p.scroll.set(list, [NaN, Infinity]);
    set(e, a, { name: "A2" });
    p.sync(e.getSnapshot().document, 5);
    expect(p.scroll.get(list)).toEqual([0, 0]);
  });
});

/** Screens A and B; a button on A; `count` (0) and a colour `bg` (white in Light, black in Dark) bound to A's fill. */
function variables() {
  const e = new EditorEngine();
  const a = id(e.execute("frame.create", { x: 0, y: 0, width: 100, height: 100, name: "A" }));
  const b = id(e.execute("frame.create", { x: 200, y: 0, width: 100, height: 100, name: "B" }));
  const button = id(e.execute("shape.rectangle", { x: 10, y: 10, width: 30, height: 20, parent: a }));
  e.execute("variable.createCollection", { name: "Theme", modes: ["Light", "Dark"] });
  e.execute("variable.create", { collection: "Theme", name: "count", type: "number", value: 0 });
  e.execute("variable.create", { collection: "Theme", name: "bg", type: "color", value: "#FFFFFF" });
  e.execute("variable.set", { variable: "bg", mode: "Dark", value: "#000000" });
  e.execute("variable.bind", { ids: [a], field: "fill", variable: "bg" });
  return { doc: e.getSnapshot().document, a, b, button };
}
const onClick = (doc: Document, node: NodeId, actions: PrototypeAction[]): Document => {
  const it: PrototypeInteraction = { trigger: { type: "onClick" }, actions, transition: instant, duration_ms: 0, easing: "easeOut" };
  return { ...doc, nodes: { ...doc.nodes, [node]: { ...doc.nodes[node], interactions: [...(doc.nodes[node].interactions ?? []), it] } } } as Document;
};
const countOf = (p: PrototypePlayer) => { const v = p.doc!.variables!; return resolveVariable(v, v.variables.find(x => x.name === "count")!.id); };
const hexOf = (p: PrototypePlayer, n: NodeId) => { const paint = rectanglePaints(p.doc!.nodes[n] as never)[0]; return paint?.type === "solid" ? toCssHex({ ...paint.color, a: 1 }).slice(1) : undefined; };

describe("the player runs variable actions, as native's tests pin it", () => {
  it("counts, then navigates when the condition holds; restart starts the variables over", () => {
    const { doc, a, b, button } = variables();
    const count = doc.variables!.variables.find(v => v.name === "count")!.id;
    const played = onClick(doc, button, [
      { type: "setVariable", variable: count, value: null, expr: { op: { op: "add", args: [{ value: { type: "alias", value: count } }, { value: { type: "number", value: 1 } }] } } },
      { type: "conditional", blocks: [{ condition: { op: { op: "greaterOrEqual", args: [{ value: { type: "alias", value: count } }, { value: { type: "number", value: 2 } }] } }, actions: [{ type: "navigate", dest: b }] }] },
    ]);
    const p = playerOn(played, a);
    expect(p.fire(button, 0, undefined, 1)).toBe(true);
    expect(p.current).toBe(a);
    expect(countOf(p)).toEqual({ type: "number", value: 1 });
    expect(p.fire(button, 0, undefined, 2)).toBe(true);
    expect(p.current).toBe(b);
    expect(countOf(p)).toEqual({ type: "number", value: 2 });
    p.restart(a, 3);
    expect(countOf(p)).toEqual({ type: "number", value: 0 });
  });

  it("recolours bound layers when a mode is set; an unknown mode does nothing", () => {
    const { doc, a, button } = variables();
    const theme = doc.variables!.collections.find(c => c.name === "Theme")!, dark = theme.modes.find(m => m.name === "Dark")!.id;
    const p = playerOn(onClick(doc, button, [{ type: "setVariableMode", collection: theme.id, mode: dark }]), a);
    expect(hexOf(p, a)).toBe("FFFFFF");
    expect(p.fire(button, 0, undefined, 1)).toBe(true);
    expect(hexOf(p, a)).toBe("000000");
    const p2 = playerOn(onClick(p.doc!, button, [{ type: "setVariableMode", collection: theme.id, mode: "Sepia" }]), a);
    expect(p2.fire(button, 1, undefined, 1)).toBe(false);
  });

  it("stops deeply nested conditionals", () => {
    const { doc, a, b, button } = variables();
    let act: PrototypeAction = { type: "navigate", dest: b };
    for (let k = 0; k < 16 * 3; k++) act = { type: "conditional", blocks: [{ actions: [act] }] };
    const p = playerOn(onClick(doc, button, [act]), a);
    expect(p.fire(button, 0, undefined, 1)).toBe(false);
    expect(p.current).toBe(a);
  });

  it("keeps a stored collection id apart from a collection named like it", () => {
    for (const missing of [false, true]) {
      const { doc, a, button } = variables();
      const theme = doc.variables!.collections[0];
      const shadow = { ...theme, id: "shadow", name: theme.id };
      const collections = [shadow, ...doc.variables!.collections].filter(c => !missing || c.id !== theme.id);
      const dark = theme.modes.find(m => m.name === "Dark")!.id;
      const withShadow = { ...doc, variables: { ...doc.variables!, collections } } as Document;
      const p = playerOn(onClick(withShadow, button, [{ type: "setVariableMode", collection: theme.id, mode: dark }]), a);
      expect(p.fire(button, 0, undefined, 1)).toBe(!missing);
      const modes = p.doc!.nodes[p.doc!.currentPage].variableModes ?? {};
      expect(Object.hasOwn(modes, "shadow")).toBe(false);
      if (!missing) expect(hexOf(p, a)).toBe("000000");
    }
  });
});

// Native present/actions.rs and navigate.rs rules that native's tests reach through gestures (item 10 restates those):
// delayed mouse triggers, reverting hover states, after-delay timers and whose doing an opened link is.
describe("the player's timers, temporary states and links, following native's player code", () => {
  const withInteraction = (doc: Document, node: NodeId, it: Partial<PrototypeInteraction> & { actions: PrototypeAction[] }): Document =>
    ({ ...doc, nodes: { ...doc.nodes, [node]: { ...doc.nodes[node], interactions: [...(doc.nodes[node].interactions ?? []),
      { trigger: { type: "onClick" }, transition: instant, duration_ms: 0, easing: "easeOut", ...it }] } } }) as Document;
  const rect = { x0: 10, y0: 10, x1: 40, y1: 30 };

  it("waits out a mouse trigger's delay, once, while its screen still shows", () => {
    const { doc, a, b, button } = variables();
    const p = playerOn(withInteraction(doc, button, { trigger: { type: "mouseEnter" }, delay_ms: 500, actions: [{ type: "navigate", dest: b }] }), a);
    expect(p.gesture(button, 0, rect, 1, a)).toBe(false);
    expect(p.gesture(button, 0, rect, 1.2, a)).toBe(false);
    expect(p.waiting.length).toBe(1);
    expect(p.fireWaiting(a, 1.4)).toBe(false);
    expect(p.fireWaiting(a, 1.5)).toBe(true);
    expect(p.current).toBe(b);
    // A trigger whose screen went away is dropped.
    const q = playerOn(withInteraction(doc, button, { trigger: { type: "mouseEnter" }, delay_ms: 500, actions: [{ type: "navigate", dest: b }] }), a);
    q.gesture(button, 0, rect, 1, a);
    expect(q.fireWaiting(b, 2)).toBe(false);
    expect(q.waiting.length).toBe(0);
  });

  it("reverts a while-hovering state with the transition played back", () => {
    const { doc, a, b, button } = variables();
    const p = playerOn(withInteraction(doc, button, { trigger: { type: "onHover" }, transition: { type: "push", direction: "left" }, duration_ms: 300, actions: [{ type: "navigate", dest: b }] }), a);
    expect(p.fire(button, 0, rect, 1)).toBe(true);
    expect([p.current, p.temp?.press]).toEqual([b, false]);
    p.revert(2);
    expect([p.current, p.temp, p.history]).toEqual([a, undefined, []]);
    expect(p.anim?.transition).toEqual({ type: "push", direction: "right" });
  });

  it("times after-delay interactions from when the screen arrives", () => {
    const { doc, a, b } = variables();
    const p = playerOn(withInteraction(doc, a, { trigger: { type: "afterDelay", ms: 800 }, actions: [{ type: "navigate", dest: b }] }), a);
    p.restart(a, 10);
    expect(p.nextDelay(p.doc!, a, 10.5)).toEqual([[a, 0], 0.30000000000000071]);
    p.delaysFired.add(a + "/0");
    expect(p.nextDelay(p.doc!, a, 10.5)).toBeUndefined();
  });

  it("keeps only web and mail links, the viewer's own when a click fired them", () => {
    const { doc, a, button } = variables();
    let d = withInteraction(doc, button, { actions: [{ type: "openUrl", url: "https://example.invalid" }, { type: "openUrl", url: "javascript:alert(1)" }] });
    d = withInteraction(d, button, { trigger: { type: "mouseEnter" }, actions: [{ type: "openUrl", url: "mailto:a@example.invalid", new_tab: false }] });
    const p = playerOn(d, a);
    expect(p.fire(button, 0, rect, 1)).toBe(true);
    expect(p.fire(button, 1, rect, 2)).toBe(true);
    expect(p.urls).toEqual([{ url: "https://example.invalid", asked: true, newTab: true }, { url: "mailto:a@example.invalid", asked: false, newTab: false }]);
  });
});
