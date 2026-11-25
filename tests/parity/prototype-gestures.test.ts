import { describe, expect, it } from "vitest";
import { EditorEngine } from "../../src/engine/editor";
import type { NodeId } from "../../src/engine/document";
import { PrototypePlayer } from "../../src/engine/prototype-player";
import { PresenterInput } from "../../src/engine/prototype-input";
import { presentedScreen } from "../../src/engine/prototype-screen";
import type { KeyMods } from "../../src/engine/prototype-model";

// Restated from native ui-egui/src/present/behaviour_tests.rs at bad07e44 (triggers_fire_on_their_gesture,
// nested_hotspots_and_click_through, a_click_outside_an_overlay_closes_it_unless_turned_off, a_drag_started_transition_follows_the_pointer)
// and present/delay_tests.rs (mouse_triggers_wait_out_their_delay, a_delayed_trigger_fires_once_and_not_on_another_screen). Native plays egui frames at 60 a second;
// here each frame is a call on the input controller at that frame's time, in page units of the presented screen.
const id = (v: unknown) => String((v as { id: unknown }).id);
const none: KeyMods = { ctrl: false, alt: false, shift: false, cmd: false };
type Point = { x: number; y: number };

class Harness {
  time = 0;
  readonly input: PresenterInput;
  down = false;
  constructor(readonly p: PrototypePlayer) { this.input = new PresenterInput(p); }
  get screen() { return presentedScreen(this.p)!; }
  /** Native's pointer is in screen space: here, page units of whatever frame shows now (its top-left at the screen's). */
  #page(q: Point, s = this.screen) { return { x: q.x + s.frame.x, y: q.y + s.frame.y }; }
  get name() { return this.p.doc!.nodes[this.p.current].name; }
  /** Each frame comes 1/60 s after the last, as egui's test harness steps it. */
  #step() { this.time += 1 / 60; }
  frame() { this.#step(); this.input.tick(this.screen, this.time); }
  frames(n: number) { for (let i = 0; i < n; i++) this.frame(); }
  move(q: Point) { this.#step(); this.input.move(this.screen, this.#page(q), this.down, this.time); this.input.tick(this.screen, this.time); }
  button(q: Point, pressed: boolean) {
    this.#step(); this.down = pressed;
    if (pressed) this.input.down(this.screen, this.#page(q), this.time); else this.input.up(this.screen, this.#page(q), this.time);
    this.input.tick(this.screen, this.time);
  }
  key(name: string, mods: KeyMods) { this.#step(); this.input.key(this.screen, name, mods, this.time); }
}
const present = (e: EditorEngine, start: NodeId) => { const p = new PrototypePlayer(start); p.sync(e.getSnapshot().document, 0); return new Harness(p); };

type Gesture = { kind: "click" | "hold" | "holdRelease" | "hover" | "hoverLeave" } | { kind: "drag"; dx: number; dy: number } | { kind: "key"; key: string; mods: KeyMods } | { kind: "wait"; secs: number };
function play(u: Harness, g: Gesture, at: Point) {
  const away = { x: at.x - 40, y: at.y - 40 };
  u.move(g.kind === "wait" ? away : at);
  switch (g.kind) {
    case "click": u.button(at, true); u.button(at, false); break;
    case "drag":
      u.button(at, true);
      for (let k = 1; k <= 5; k++) u.move({ x: at.x + g.dx * k / 5, y: at.y + g.dy * k / 5 });
      u.button({ x: at.x + g.dx, y: at.y + g.dy }, false);
      break;
    case "hold": case "holdRelease":
      u.button(at, true); u.frames(2);
      if (g.kind === "holdRelease") u.button(at, false);
      break;
    case "hover": u.frames(2); break;
    case "hoverLeave": u.frames(2); u.move(away); break;
    case "key": u.key(g.key, g.mods); break;
    case "wait": u.frames(Math.round(g.secs * 60)); break;
  }
  u.frames(2);
}
/** Screens A (300×400, presented) and B; a 100×60 layer "Hot" at (50, 50) in A whose one interaction navigates to B. */
function oneInteraction(trigger: unknown, transition: unknown, ms: number) {
  const e = new EditorEngine();
  const a = id(e.execute("frame.create", { x: 0, y: 0, width: 300, height: 400, name: "A" }));
  const b = id(e.execute("frame.create", { x: 400, y: 0, width: 300, height: 400, name: "B" }));
  const hot = id(e.execute("shape.rectangle", { x: 50, y: 50, width: 100, height: 60, parent: Number(a), props: { name: "Hot" } }));
  e.execute("proto.interaction.add", { id: Number(hot), trigger, action: { type: "navigate", dest: Number(b) }, transition, durationMs: ms });
  return { u: present(e, a), at: { x: 100, y: 80 } };
}

describe("presenter gestures, as native's behaviour tests pin them", () => {
  it("fires each trigger on its gesture", () => {
    const instant = { type: "instant" }, pushLeft = { type: "push", direction: "left" };
    const t = (type: string) => ({ type });
    const key = (k: string) => ({ type: "keyPress", key: k });
    const g = (kind: "click" | "hold" | "holdRelease" | "hover" | "hoverLeave"): Gesture => ({ kind });
    const cases: [unknown, unknown, Gesture, string, string][] = [
      [t("onClick"), instant, g("click"), "B", "on click: press and release on the layer"],
      [t("onClick"), instant, { kind: "drag", dx: 40, dy: 0 }, "A", "a drag is not a click"],
      [t("onDrag"), instant, { kind: "drag", dx: 40, dy: 0 }, "B", "on drag: a drag that starts on the layer"],
      [t("onDrag"), instant, g("click"), "A", "a click is not a drag"],
      [t("onDrag"), pushLeft, { kind: "drag", dx: -60, dy: 0 }, "B", "on drag with push left: a drag to the left"],
      [t("onDrag"), pushLeft, { kind: "drag", dx: 60, dy: 0 }, "A", "a drag against the animation's direction doesn't start it"],
      [t("mouseDown"), instant, g("hold"), "B", "mouse down: as the button goes down"],
      [t("mouseUp"), instant, g("hold"), "A", "mouse up: not before the button comes up"],
      [t("mouseUp"), instant, g("click"), "B", "mouse up: when it does"],
      [t("onPress"), instant, g("hold"), "B", "while pressing: shown while the button is down"],
      [t("onPress"), instant, g("holdRelease"), "A", "while pressing: reverts on release"],
      [t("onHover"), instant, g("hover"), "B", "while hovering: shown while the pointer is over the layer"],
      [t("onHover"), instant, g("hoverLeave"), "A", "while hovering: reverts when the pointer leaves"],
      [t("mouseEnter"), instant, g("hoverLeave"), "B", "mouse enter: fires on entering and doesn't revert"],
      [t("mouseLeave"), instant, g("hover"), "A", "mouse leave: not while the pointer is still over it"],
      [t("mouseLeave"), instant, g("hoverLeave"), "B", "mouse leave: when it leaves"],
      [key("K"), instant, { kind: "key", key: "K", mods: none }, "B", "key: pressed anywhere on the screen"],
      [key("Shift+K"), instant, { kind: "key", key: "K", mods: none }, "A", "a combination needs its modifier"],
      [key("Shift+K"), instant, { kind: "key", key: "K", mods: { ...none, shift: true } }, "B", "the combination"],
      [{ type: "afterDelay", ms: 500 }, instant, { kind: "wait", secs: 0.3 }, "A", "after delay: not before the delay"],
      [{ type: "afterDelay", ms: 500 }, instant, { kind: "wait", secs: 0.6 }, "B", "after delay: timed from when the screen shows"],
    ];
    for (const [trigger, transition, gesture, want, why] of cases) {
      const { u, at } = oneInteraction(trigger, transition, 300);
      play(u, gesture, at);
      expect(u.name, `${JSON.stringify(trigger)} ${JSON.stringify(transition)} ${JSON.stringify(gesture)}: ${why}`).toBe(want);
    }
  });

  it("lets a click through nested hotspots to the top-most layer with the trigger", () => {
    const clickOnChild = (child: unknown, hidden: boolean, cover: boolean) => {
      const e = new EditorEngine();
      const a = id(e.execute("frame.create", { x: 0, y: 0, width: 300, height: 400, name: "A" }));
      const b = id(e.execute("frame.create", { x: 400, y: 0, width: 300, height: 400, name: "B" }));
      const c = id(e.execute("frame.create", { x: 800, y: 0, width: 300, height: 400, name: "C" }));
      const parent = id(e.execute("frame.create", { x: 50, y: 50, width: 200, height: 150, parent: Number(a), name: "Parent" }));
      const kid = id(e.execute("shape.rectangle", { x: 20, y: 20, width: 60, height: 40, parent: Number(parent), props: { name: "Child" } }));
      e.execute("proto.interaction.add", { id: Number(parent), trigger: { type: "onClick" }, action: { type: "navigate", dest: Number(c) }, transition: { type: "instant" } });
      if (child) e.execute("proto.interaction.add", { id: Number(kid), trigger: child, action: { type: "navigate", dest: Number(b) }, transition: { type: "instant" } });
      if (hidden) e.execute("node.set", { id: Number(kid), props: { visible: false } });
      if (cover) e.execute("shape.rectangle", { x: 60, y: 60, width: 100, height: 60, parent: Number(a), props: { name: "Cover" } });
      const u = present(e, a);
      play(u, { kind: "click" }, { x: 50 + 50, y: 50 + 40 });
      return u.name;
    };
    const cases: [unknown, boolean, boolean, string, string][] = [
      [{ type: "onClick" }, false, false, "B", "the top-most layer with the trigger wins over its parent"],
      [{ type: "keyPress", key: "X" }, false, false, "C", "a layer without that trigger lets the click through to the parent's"],
      [undefined, false, false, "C", "a layer without interactions: the parent's"],
      [{ type: "onClick" }, false, true, "B", "a layer without interactions over a hotspot doesn't block it"],
      [{ type: "onClick" }, true, false, "C", "hidden layers aren't hotspots"],
    ];
    for (const [child, hidden, cover, want, why] of cases) expect(clickOnChild(child, hidden, cover), why).toBe(want);
  });

  it("makes a transition a drag started follow the pointer, wait while held still, and play on when let go", () => {
    const { u, at } = oneInteraction({ type: "onDrag" }, { type: "push", direction: "left" }, 400);
    const progress = () => { const a = u.p.anim; return a && u.p.transitionProgress(u.time) !== undefined ? Math.round((u.time - a.start) / a.dur * 100) / 100 : undefined; };
    u.move(at);
    u.button(at, true);
    // 30 points to the left over a 300 wide screen: a tenth of the way, for as long as it's held.
    for (let k = 1; k <= 3; k++) { u.move({ x: at.x - 10 * k, y: at.y }); }
    expect(u.name).toBe("B");
    expect(progress()).toBe(0.1);
    u.frames(5);
    expect(progress(), "held still: it waits").toBe(0.1);
    u.move({ x: at.x - 150, y: at.y });
    expect(progress(), "half the screen: half way").toBe(0.5);
    u.button({ x: at.x - 150, y: at.y }, false);
    u.frames(30);
    expect(progress(), "finished").toBeUndefined();
  });
  it("closes an overlay on a click outside it unless turned off", () => {
    for (const [close, left, why] of [[true, 0, "closes on a click outside (the default)"], [false, 1, "turned off: stays open"]] as const) {
      const e = new EditorEngine();
      const a = id(e.execute("frame.create", { x: 0, y: 0, width: 300, height: 400, name: "A" }));
      const menu = id(e.execute("frame.create", { x: 400, y: 0, width: 100, height: 100, name: "Menu" }));
      const hot = id(e.execute("shape.rectangle", { x: 10, y: 10, width: 60, height: 40, parent: Number(a), props: { name: "Hot" } }));
      e.execute("proto.interaction.add", { id: Number(hot), trigger: { type: "onClick" }, action: { type: "openOverlay", dest: Number(menu), closeOnOutside: close }, transition: { type: "instant" } });
      const u = present(e, a), at = { x: 40, y: 30 };
      play(u, { kind: "click" }, at);
      expect(u.p.overlays.map(o => o.id)).toEqual([menu]);
      // The overlay is centred on A; the hotspot's place is outside it.
      play(u, { kind: "click" }, at);
      expect(u.p.overlays.length, why).toBe(left);
    }
  });

  /** A (presented) with a 100 × 60 "Hot" layer that goes to B on `trigger` after `delay` ms. */
  const delayed = (trigger: string, delay: number) => {
    const e = new EditorEngine();
    const a = id(e.execute("frame.create", { x: 0, y: 0, width: 300, height: 400, name: "A" }));
    const b = id(e.execute("frame.create", { x: 400, y: 0, width: 300, height: 400, name: "B" }));
    const hot = id(e.execute("shape.rectangle", { x: 50, y: 50, width: 100, height: 60, parent: Number(a), props: { name: "Hot" } }));
    e.execute("proto.interaction.add", { id: Number(hot), trigger: { type: trigger }, action: { type: "navigate", dest: Number(b) }, transition: { type: "instant" }, delayMs: delay });
    const u = present(e, a);
    u.frames(2);
    return { u, at: { x: 100, y: 80 } };
  };
  const gesture = (u: Harness, trigger: string, at: Point) => {
    const away = { x: at.x - 80, y: at.y - 45 };
    u.move(at);
    if (trigger === "mouseLeave") u.move(away);
    else if (trigger === "mouseDown") u.button(at, true);
    else if (trigger !== "mouseEnter") { u.button(at, true); u.button(at, false); }
  };
  it("makes mouse triggers wait out their delay", () => {
    for (const trigger of ["mouseEnter", "mouseLeave", "mouseDown", "mouseUp"]) {
      // 500 ms is 30 frames: not yet after 20 more, done after 40.
      let { u, at } = delayed(trigger, 500);
      gesture(u, trigger, at);
      u.frames(20);
      expect(u.name, `${trigger}: not before the delay`).toBe("A");
      u.frames(20);
      expect(u.name, `${trigger}: once the delay is over`).toBe("B");
      ({ u, at } = delayed(trigger, 0));
      gesture(u, trigger, at);
      u.frames(2);
      expect(u.name, `${trigger}: no delay`).toBe("B");
    }
  });
  it("fires a delayed trigger once, and not after a restart", () => {
    let { u, at } = delayed("mouseEnter", 500);
    for (let i = 0; i < 3; i++) { u.move(at); u.move({ x: at.x - 80, y: at.y - 45 }); }
    expect(u.p.waiting.length).toBe(1);
    u.frames(40);
    expect([u.name, u.p.waiting.length]).toEqual(["B", 0]);
    ({ u, at } = delayed("mouseDown", 500));
    gesture(u, "mouseDown", at);
    u.button(at, false);
    u.key("R", none);
    u.frames(40);
    expect([u.name, u.p.waiting.length], "restarted while waiting").toEqual(["A", 0]);
  });
});

// Restated from native ui-egui/src/present/tail_tests.rs at bad07e44 (controller_buttons_play_key_gamepad_triggers,
// prototypes_without_gamepad_triggers_dont_poll): controller buttons as the system reports them, bit i for standard button i.
describe("controller buttons, as native's tests pin them", () => {
  const padsSetup = () => {
    const e = new EditorEngine();
    const a = id(e.execute("frame.create", { x: 0, y: 0, width: 300, height: 400, name: "A" }));
    const b = id(e.execute("frame.create", { x: 400, y: 0, width: 300, height: 400, name: "B" }));
    const onA = id(e.execute("shape.rectangle", { x: 10, y: 10, width: 30, height: 30, parent: Number(a) }));
    const onB = id(e.execute("shape.rectangle", { x: 10, y: 10, width: 30, height: 30, parent: Number(b) }));
    e.execute("proto.interaction.add", { id: Number(onA), trigger: { type: "keyPress", key: "Gamepad A" }, action: { type: "navigate", dest: Number(b) } });
    e.execute("proto.interaction.add", { id: Number(onB), trigger: { type: "keyPress", key: "Gamepad B" }, action: { type: "back" } });
    return present(e, a);
  };
  it("plays key triggers that name a controller button", () => {
    const u = padsSetup();
    expect(u.p.usesPads).toBe(true);
    expect(u.name).toBe("A");
    const steps: [number, string, string][] = [
      [0b01, "B", "pressing the trigger's button anywhere on the screen plays it, like its key"],
      [0b01, "B", "a button held down plays once, not again every frame"],
      [0b11, "A", "another button while one is held: B's trigger goes back"],
      [0b00, "A", "releasing does nothing (the trigger is a press)"],
      [1 << 2, "A", "a button no trigger names does nothing"],
      [0b01, "B", "pressed again after letting go: plays again"],
    ];
    for (const [bits, want, why] of steps) {
      for (let i = 0; i < 2; i++) { u.frames(1); u.input.pads(u.screen, bits, u.time); }
      expect(u.name, why).toBe(want);
    }
  });
  it("leaves the controllers alone for a prototype without controller triggers", () => {
    const e = new EditorEngine();
    const a = id(e.execute("frame.create", { x: 0, y: 0, width: 300, height: 400, name: "A" }));
    expect(present(e, a).p.usesPads).toBe(false);
  });
});
