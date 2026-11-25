import { describe, expect, it } from "vitest";
import { EditorEngine } from "../../src/engine/editor";
import type { NodeId } from "../../src/engine/document";
import { PrototypePlayer } from "../../src/engine/prototype-player";
import { PresenterInput } from "../../src/engine/prototype-input";
import { presentedScreen } from "../../src/engine/prototype-screen";
import { cycleScale, fullChrome, nextScale, paneChrome, placePage, presentLayout, scaleOptions, type Chrome, type Rect } from "../../src/engine/prototype-layout";
import { flingAxis, rubberBand, viewport } from "../../src/engine/prototype-scroll";
import { presentScales } from "../../src/engine/prototype-commands";
import { boundsOf } from "../../src/engine/viewport";

// Restated from native ui-egui/src/present_view_tests.rs, proto_responsive_tests.rs and present/tests.rs at bad07e44 (the scale options,
// panning, devices, momentum, the wheel's coast, responsive frames and custom sizes). Native plays egui frames at 60 a second in a
// 1440×900 window whose title and tab bars leave the presenter 1440×820; here each frame lays the presenter out and ticks its input.
const id = (v: unknown) => String((v as { id: unknown }).id);
const none = { ctrl: false, alt: false, shift: false, cmd: false };
type Pt = readonly [number, number];
const window: Rect = { x0: 0, y0: 0, x1: 1440, y1: 820 };

class Ui {
  time = 0;
  readonly p: PrototypePlayer;
  readonly input: PresenterInput;
  down = false;
  constructor(readonly e: EditorEngine, start: NodeId, readonly area: Rect = window, readonly chrome: Chrome = fullChrome) {
    this.p = new PrototypePlayer(start);
    this.p.sync(e.getSnapshot().document, 0);
    this.input = new PresenterInput(this.p);
    this.layout();
  }
  layout() { const l = presentLayout(this.p, this.area, this.chrome)!; this.input.scale = l.scale; return l; }
  get screen() { return presentedScreen(this.p)!; }
  /** The page point under a screen point, through the layout of this frame. */
  page(q: Pt) { const [x, y] = placePage(this.layout().place, q); return { x, y }; }
  sync() { this.p.sync(this.e.getSnapshot().document, this.time); this.layout(); }
  #step() { this.time += 1 / 60; this.p.sync(this.e.getSnapshot().document, this.time); this.layout(); }
  frame() { this.#step(); this.input.tick(this.screen, this.time); }
  frames(n: number) { for (let i = 0; i < n; i++) this.frame(); }
  move(q: Pt) { this.#step(); this.input.move(this.screen, this.page(q), this.down, this.time, q); this.input.tick(this.screen, this.time); }
  button(q: Pt, pressed: boolean) {
    this.#step(); this.down = pressed;
    if (pressed) this.input.down(this.screen, this.page(q), this.time, q); else this.input.up(this.screen, this.page(q), this.time);
    this.input.tick(this.screen, this.time);
  }
  wheel(q: Pt, delta: Pt) { this.#step(); this.input.move(this.screen, this.page(q), this.down, this.time, q); this.input.wheel(this.screen, this.page(q), delta, 1 / 60, this.time); this.input.tick(this.screen, this.time); }
  key(name: string) { this.#step(); this.input.key(this.screen, name, none, this.time, () => cycleScale(this.p, this.layout(), this.chrome)); this.layout(); }
  get frameSize() { const n = this.p.doc!.nodes[this.p.current] as { width: number; height: number }; return [n.width, n.height]; }
  get scrollY() { return (this.p.scroll.get(this.p.current) ?? [0, 0])[1]; }
}
/** Native `present_tests::setup`: an iPhone 16 page with a 393×2000 frame A scrolling vertically (a card, a tab bar fixed to its bottom), and a 393×852 frame B. */
function setup() {
  const e = new EditorEngine();
  e.execute("proto.settings", { device: "iPhone 16" });
  const a = id(e.execute("frame.create", { x: 0, y: 0, width: 393, height: 2000, name: "A" }));
  e.execute("node.set", { id: Number(a), props: { overflow: "vertical" } });
  e.execute("shape.rectangle", { x: 20, y: 100, width: 200, height: 100, parent: Number(a) });
  const bar = id(e.execute("shape.rectangle", { x: 0, y: 1940, width: 393, height: 60, parent: Number(a) }));
  e.execute("node.set", { id: Number(bar), props: { scrollPosition: "fixed", constraints: { horizontal: "left", vertical: "bottom" } } });
  const b = id(e.execute("frame.create", { x: 500, y: 0, width: 393, height: 852, name: "B" }));
  return { e, a, b };
}
/** Native `fling_for`: a fling run for `secs` at `fps`; where it ends and whether it rests. */
function flingFor(x: number, v: number, r: number, decay: number, bounce: boolean, secs: number, fps: number): [number, boolean] {
  let done = false;
  for (let i = 0; i < Math.round(secs * fps); i++) { [x, v, done] = flingAxis(x, v, r, 1 / fps, decay, bounce); if (done) break; }
  return [x, done];
}

describe("the presenter's motion maths, as native pins it", () => {
  it("slows flings down the same at any frame rate", () => {
    const [x, done] = flingFor(0, 1000, 10_000, 2.5, true, 5, 60);
    expect(done && Math.abs(x - 400) < 3).toBe(true);
    const [a] = flingFor(100, 1500, 10_000, 2.5, true, 0.5, 30), [b] = flingFor(100, 1500, 10_000, 2.5, true, 0.5, 144);
    expect(Math.abs(a - b)).toBeLessThan(0.5);
    expect(flingFor(900, 3000, 1000, 8, false, 2, 60)).toEqual([1000, true]);
    let p = 900, v = 3000, furthest = 0, d = false;
    for (let i = 0; i < 240; i++) { [p, v, d] = flingAxis(p, v, 1000, 1 / 60, 2.5, true); furthest = Math.max(furthest, p); if (d) break; }
    expect(furthest > 1000 && furthest < 1200).toBe(true);
    expect([p, v]).toEqual([1000, 0]);
    expect(flingFor(-80, 0, 1000, 2.5, true, 3, 60)).toEqual([0, true]);
    for (const [jx, jv, jr, jdt] of [[NaN, 1, 10, 0.1], [1, Infinity, 10, 0.1], [1, 1, NaN, 0.1], [1, 1, 10, NaN], [5, 1e300, 10, 1e9], [5, 1, -3, 0.1]]) {
      const [nx, nv] = flingAxis(jx, jv, jr, jdt, 2.5, true);
      expect(Number.isFinite(nx) && Number.isFinite(nv)).toBe(true);
    }
  });
  it("stretches a rubber band less the further it goes", () => {
    expect(rubberBand(50, 100, 240)).toBe(50);
    const a = rubberBand(130, 100, 240), b = rubberBand(400, 100, 240), far = rubberBand(1e9, 100, 240);
    expect(100 < a && a < 130 && a < b && b < far && far <= 340).toBe(true);
    expect(rubberBand(-30, 100, 240) < 0 && rubberBand(-30, 100, 240) > -30).toBe(true);
    expect(rubberBand(-30, 0, 240)).toBe(0);
    expect(rubberBand(NaN, 100, 240)).toBe(0);
    expect(rubberBand(130, 100, NaN)).toBe(100);
  });
  it("matches the scale options to the command and cycles them", () => {
    expect([...scaleOptions(false)]).toEqual([...presentScales]);
    let s = nextScale("fit", false);
    const seen = [s];
    for (let i = 0; i < 3; i++) seen.push(s = nextScale(s, false));
    expect(seen).toEqual(["fitWidth", "fill", "actual", "fit"]);
    expect(nextScale("fit", true)).toBe("fill");
    expect(nextScale("fitWidth", true)).toBe("fit");
    expect(scaleOptions(true)).not.toContain("fitWidth");
  });
});

describe("the presenter's view, as native's view tests pin it", () => {
  it("scales by its options and pans what overflows", () => {
    const e = new EditorEngine();
    const big = id(e.execute("frame.create", { x: 0, y: 0, width: 2000, height: 3000, name: "Big" }));
    e.execute("frame.create", { x: 2100, y: 0, width: 300, height: 200, name: "Small" });
    const u = new Ui(e, big), at: Pt = [720, 470];
    // Fit: 1376×756 inside the padding; nothing pans.
    expect(u.p.view.scale).toBe("fit");
    expect(Math.abs(u.p.zoom - 756 / 3000)).toBeLessThan(1e-3);
    expect(u.p.panRange).toEqual([0, 0]);
    u.key("Z");
    expect(u.p.view.scale).toBe("fitWidth");
    expect(Math.abs(u.p.zoom - 0.72)).toBeLessThan(1e-3);
    expect(u.p.panRange[0]).toBe(0);
    expect(Math.abs(u.p.panRange[1] - (2160 - 820))).toBeLessThan(1);
    u.key("Z");
    expect(u.p.view.scale).toBe("fill");
    u.key("Z");
    expect([u.p.view.scale, u.p.zoom]).toEqual(["actual", 1]);
    expect(u.p.panRange).toEqual([624, 2244]);
    expect(u.p.offset("view")).toEqual([312, 0]);
    // The wheel pans down; a drag pans with the pointer.
    for (let i = 0; i < 4; i++) u.wheel(at, [0, -80]);
    u.frames(60);
    const y = u.p.offset("view")[1];
    expect(y).toBeGreaterThan(300);
    u.button(at, true);
    for (let k = 1; k <= 5; k++) u.move([at[0], at[1] - 20 * k]);
    u.button([at[0], at[1] - 100], false);
    expect(Math.abs(u.p.offset("view")[1] - (y + 100))).toBeLessThan(1);
    // The options carry over; R restarts.
    u.p.setScale("fit"); u.layout();
    expect(u.p.panRange).toEqual([0, 0]);
    u.key("ArrowRight");
    expect(u.p.doc!.nodes[u.p.current].name).toBe("Small");
    u.key("R");
    expect(u.p.doc!.nodes[u.p.current].name).toBe("Big");
  });

  it("turns devices and can hide their frame", () => {
    const { e, a } = setup();
    e.execute("proto.settings", { rotation: "landscape" });
    const pane = new Ui(e, a, { x0: 0, y0: 0, x1: 360, y1: 444 }, paneChrome);
    const l = pane.layout();
    expect([l.device?.name, l.landscape]).toEqual(["iPhone 16", true]);
    expect(viewport(pane.p.doc!, a)).toEqual([393, 393]);
    expect(pane.p.range(pane.p.doc!, a)).toEqual([0, 1607]);
    e.execute("proto.settings", { rotation: "portrait" });
    const u = new Ui(e, a);
    const withBody = u.p.zoom;
    u.p.view = { ...u.p.view, deviceFrame: false }; u.layout();
    const bare = u.p.zoom;
    expect(bare > withBody && Math.abs(bare - 756 / 852) < 1e-3).toBe(true);
    u.key("Z");
    expect(u.p.view.scale).toBe("fill");
  });

  it("keeps scrolling's momentum and springs back from the ends", () => {
    const { e, a } = setup();
    const u = new Ui(e, a, { x0: 0, y0: 0, x1: 360, y1: 444 }, paneChrome);
    const c: Pt = [180, 222];
    const flick = (from: Pt, dy: number, n: number) => {
      u.move(from); u.button(from, true);
      for (let k = 1; k <= n; k++) u.move([from[0], from[1] + dy * k]);
      u.button([from[0], from[1] + dy * n], false);
    };
    flick([c[0], c[1] + 100], -25, 6);
    const released = u.scrollY;
    expect(u.p.fling).toBeDefined();
    u.frames(20);
    const coasted = u.scrollY;
    expect(coasted).toBeGreaterThan(released + 20);
    u.frames(400);
    expect(u.p.fling).toBeUndefined();
    const rest = u.scrollY;
    expect(rest >= coasted && rest <= 1148).toBe(true);
    // A press catches a fling.
    flick([c[0], c[1] + 100], 25, 6);
    u.frames(2);
    u.button(c, true);
    const caught = u.scrollY;
    u.frames(10);
    expect(u.scrollY).toBe(caught);
    u.button(c, false);
    // Dragged past the top it stretches while held, and springs back to it when let go.
    u.p.scrollTo(0, 0);
    u.button(c, true);
    for (let k = 1; k <= 10; k++) u.move([c[0], c[1] + 12 * k]);
    expect(u.scrollY).toBeLessThan(0);
    for (let i = 0; i < 10; i++) u.move([c[0], c[1] + 120]);
    u.button([c[0], c[1] + 120], false);
    u.frames(90);
    expect(u.scrollY).toBe(0);
    expect(u.p.fling).toBeUndefined();
  });

  it("lets the wheel coast after it stops", () => {
    const { e, a } = setup();
    const u = new Ui(e, a, { x0: 0, y0: 0, x1: 360, y1: 444 }, paneChrome);
    const c: Pt = [180, 222];
    for (let i = 0; i < 8; i++) u.wheel(c, [0, -40]);
    let coasted = false;
    for (let i = 0; i < 60; i++) { u.move(c); coasted ||= !!u.p.fling; }
    expect(coasted).toBe(true);
    u.frames(200);
    expect(u.p.fling).toBeUndefined();
  });
});

describe("devices and responsive frames, as native's tests pin them", () => {
  /** A 600×400 frame "Wide" with a button pinned to its right edge, and a 300×200 frame "Small". */
  const wide = (e: EditorEngine) => {
    const w = id(e.execute("frame.create", { x: 0, y: 0, width: 600, height: 400, name: "Wide" }));
    const button = id(e.execute("shape.rectangle", { x: 500, y: 10, width: 90, height: 30, parent: Number(w) }));
    e.execute("node.set", { id: Number(button), props: { constraints: { horizontal: "right", vertical: "top" } } });
    const small = id(e.execute("frame.create", { x: 700, y: 0, width: 300, height: 200, name: "Small" }));
    return { w, button, small };
  };

  it("makes responsive frames take the device's screen live", () => {
    const e = new EditorEngine();
    e.execute("proto.settings", { device: "iPhone 16", color: "Pink" });
    const { w, button, small } = wide(e);
    const u = new Ui(e, w);
    expect([u.p.fit, u.layout().colour?.name]).toEqual([undefined, "Pink"]);
    expect(u.frameSize).toEqual([600, 400]);
    e.execute("proto.settings", { responsive: true }); u.sync();
    expect(u.p.fit).toEqual([393, 852]);
    expect(u.frameSize).toEqual([393, 852]);
    expect(viewport(u.p.doc!, w)).toEqual([393, 852]);
    expect((e.getSnapshot().document.nodes[w] as { width: number }).width).toBe(600);
    e.execute("proto.settings", { rotation: "landscape" }); u.sync();
    expect(u.frameSize).toEqual([852, 393]);
    e.execute("node.set", { id: Number(button), props: { width: 40 } }); u.sync();
    expect(u.frameSize).toEqual([852, 393]);
    const b = boundsOf(u.p.doc!, [button])!;
    // Shrunk to 40 at x 500 in the 600 wide design, its right margin is 60: still 60 from the screen's right edge.
    expect(b.x + b.width).toBeCloseTo(852 - 60, 6);
    u.key("ArrowRight");
    expect(u.p.current).toBe(small);
    expect(u.frameSize).toEqual([852, 393]);
    e.execute("proto.settings", { responsive: false }); u.sync();
    expect(u.frameSize).toEqual([300, 200]);
  });

  it("fills the window at 100% with a responsive frame without a device", () => {
    const e = new EditorEngine();
    const { w } = wide(e);
    e.execute("proto.settings", { responsive: true });
    const u = new Ui(e, w);
    expect(u.frameSize).toEqual([1440, 820]);
    expect(u.p.zoom).toBe(1);
    expect(u.p.panRange).toEqual([0, 0]);
    // Z has nothing to cycle.
    u.key("Z");
    expect(u.p.view.scale).toBe("fit");
    const pane = new Ui(e, w, { x0: 0, y0: 0, x1: 360, y1: 444 }, paneChrome);
    expect(pane.frameSize).toEqual([360, 444]);
  });

  it("presents custom sizes as a bare screen", () => {
    const { e, a } = setup();
    e.execute("proto.settings", { width: 500, height: 700 });
    const u = new Ui(e, a);
    const l = u.layout();
    expect(l.device?.name).toBe("Custom size");
    expect(l.colour).toBeUndefined();
    expect(viewport(u.p.doc!, a)).toEqual([393, 700]);
    expect(u.p.range(u.p.doc!, a)[1]).toBe(1300);
    e.execute("proto.settings", { responsive: true }); u.sync();
    expect(u.frameSize).toEqual([500, 700]);
  });

  /** Native `choose_device`: a device chosen in the presenter is responsive; "None" goes back to the frame as designed. */
  const chooseDevice = (u: Ui, device: string) => { u.e.execute("proto.settings", { device, responsive: device !== "None" }); u.p.resetForDevice(); u.sync(); };

  it("reflows a chosen device without resizing the saved frame, and can go back", () => {
    const e = new EditorEngine();
    const frame = id(e.execute("frame.create", { x: 0, y: 0, width: 894, height: 844 }));
    const right = id(e.execute("shape.rectangle", { x: 804, y: 20, width: 80, height: 40, parent: Number(frame) }));
    e.execute("node.set", { id: Number(right), props: { constraints: { horizontal: "right", vertical: "top" } } });
    const area: Rect = { x0: 0, y0: 40, x1: 1440, y1: 900 };
    const u = new Ui(e, frame, area);
    u.p.pan = [100, 200]; u.p.scroll.set(frame, [75, 50]);
    chooseDevice(u, "iPhone 17");
    expect(u.p.pan === undefined && u.p.scroll.size === 0).toBe(true);
    expect(u.frameSize).toEqual([402, 874]);
    expect(boundsOf(u.p.doc!, [right])!.x).toBe(312);
    expect(viewport(u.p.doc!, frame)).toEqual([402, 874]);
    expect(u.p.range(u.p.doc!, frame)).toEqual([0, 0]);
    expect((e.getSnapshot().document.nodes[frame] as { width: number }).width).toBe(894);
    const before = u.layout().screen;
    u.button([720, 440], true); u.move([300, 300]); u.button([300, 300], false);
    expect(u.p.scroll.get(frame) ?? [0, 0]).toEqual([0, 0]);
    expect(u.layout().screen).toEqual(before);
    chooseDevice(u, "None");
    expect(u.frameSize).toEqual([894, 844]);
    expect(u.p.fit).toBeUndefined();
  });

  it("shows device presets at their real resolution in their body", () => {
    const e = new EditorEngine();
    const frame = id(e.execute("frame.create", { x: 0, y: 0, width: 894, height: 844 }));
    const u = new Ui(e, frame, { x0: 0, y0: 40, x1: 1440, y1: 860 });
    for (const [name, w, h] of [["iPad mini", 744, 1133], ["MacBook Air", 1280, 832], ["Desktop", 1440, 1024], ["iPhone 17", 402, 874]] as const) {
      chooseDevice(u, name);
      const l = u.layout();
      expect(l.colour, name).toBeDefined();
      expect(Math.abs((l.screen.x1 - l.screen.x0) / l.scale - w), name).toBeLessThan(0.1);
      expect(Math.abs((l.screen.y1 - l.screen.y0) / l.scale - h), name).toBeLessThan(0.1);
      expect((e.getSnapshot().document.nodes[frame] as { width: number }).width).toBe(894);
    }
  });

  it("scrolls on a phone only what the frame's overflow allows", () => {
    const onPhone = (overflow: string) => {
      const e = new EditorEngine();
      const frame = id(e.execute("frame.create", { x: 0, y: 0, width: 894, height: 844 }));
      e.execute("shape.rectangle", { x: 650, y: 1050, width: 80, height: 80, parent: Number(frame) });
      e.execute("node.set", { id: Number(frame), props: { overflow } });
      const u = new Ui(e, frame, { x0: 0, y0: 40, x1: 1440, y1: 900 });
      chooseDevice(u, "iPhone 17");
      return { u, frame, e };
    };
    const start: Pt = [720, 440];
    const drag = (u: Ui, to: Pt) => { u.button(start, true); u.move(to); u.button(to, false); };
    let { u, frame, e } = onPhone("none");
    expect(u.p.range(u.p.doc!, frame)).toEqual([0, 0]);
    drag(u, [620, 320]);
    expect(u.p.scroll.get(frame) ?? [0, 0]).toEqual([0, 0]);
    expect((e.getSnapshot().document.nodes[frame] as { width: number }).width).toBe(894);
    ({ u, frame, e } = onPhone("both"));
    const r = u.p.range(u.p.doc!, frame);
    expect(r[0] > 0 && r[1] > 0).toBe(true);
    drag(u, [620, 320]);
    const s = u.p.scroll.get(frame)!;
    expect(s[0] > 0 && s[1] > 0).toBe(true);
    // The content keeps following a drag after the pointer leaves the screen; the device stays put.
    u.frames(60);
    const before = u.layout().screen;
    u.button(start, true); u.move([300, 300]);
    expect(u.p.scroll.get(frame)![0]).toBeGreaterThan(0);
    expect(u.layout().screen).toEqual(before);
    u.button([300, 300], false);
  });
});
