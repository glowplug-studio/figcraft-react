import { describe, expect, it } from "vitest";
import { EditorEngine } from "../../src/engine/editor";
import { PrototypePlayer } from "../../src/engine/prototype-player";
import { PresenterInput, flashSeconds } from "../../src/engine/prototype-input";
import { overlayLayers, presentedScreen } from "../../src/engine/prototype-screen";

// The presenter's input controller (port of native ui-egui/src/present/input.rs at bad07e44), driven without a canvas.
const id = (v: unknown) => String((v as { id: unknown }).id);
function setup() {
  const e = new EditorEngine();
  const home = id(e.execute("frame.create", { x: 0, y: 0, width: 200, height: 300, name: "Home" }));
  const details = id(e.execute("frame.create", { x: 300, y: 0, width: 200, height: 300, name: "Details" }));
  const sheet = id(e.execute("frame.create", { x: 600, y: 0, width: 100, height: 60, name: "Sheet" }));
  const rect = (name: string, x: number, y: number) => id(e.execute("shape.rectangle", { x, y, width: 60, height: 30, parent: Number(home), props: { name } }));
  const hover = rect("Hover", 20, 20), press = rect("Press", 120, 20), drag = rect("Drag", 20, 100), open = rect("Open", 120, 100);
  e.execute("proto.interaction.add", { id: Number(hover), trigger: { type: "onHover" }, dest: Number(details) });
  e.execute("proto.interaction.add", { id: Number(press), trigger: { type: "onPress" }, dest: Number(details) });
  e.execute("proto.interaction.add", { id: Number(drag), trigger: { type: "onDrag" }, dest: Number(details), transition: { type: "push", direction: "left" }, durationMs: 1000, easing: "linear" });
  e.execute("proto.interaction.add", { id: Number(open), action: { type: "openOverlay", dest: Number(sheet), position: "bottomCenter" }, transition: { type: "moveIn", direction: "left" }, durationMs: 1000, easing: "linear" });
  const p = new PrototypePlayer(home);
  p.sync(e.getSnapshot().document, 0);
  return { p, input: new PresenterInput(p), home, details, sheet };
}
const name = (p: PrototypePlayer) => p.doc!.nodes[p.current].name;
const screen = (p: PrototypePlayer) => presentedScreen(p)!;

describe("the presenter's input, as native's input.rs handles it", () => {
  it("shows a while-hovering state while the pointer stays over the layer's screen place, then reverts", () => {
    const { p, input } = setup();
    expect(input.move(screen(p), { x: 50, y: 35 }, false, 1)).toBe(true);
    expect(name(p)).toBe("Details");
    // Details sits elsewhere on the page: the same screen place is still inside the hover area.
    expect(input.move(screen(p), { x: 355, y: 40 }, false, 2)).toBe(false);
    expect(name(p)).toBe("Details");
    expect(input.move(screen(p), { x: 400, y: 250 }, false, 3)).toBe(true);
    expect(name(p)).toBe("Home");
  });

  it("shows a while-pressing state until release", () => {
    const { p, input } = setup();
    expect(input.down(screen(p), { x: 150, y: 35 }, 1)).toBe(true);
    expect(name(p)).toBe("Details");
    expect(input.up(screen(p), { x: 450, y: 35 }, 2)).toBe(true);
    expect(name(p)).toBe("Home");
  });

  it("flashes the hotspots after a click where nothing reacts", () => {
    const { p, input } = setup();
    input.down(screen(p), { x: 100, y: 250 }, 5);
    expect(input.up(screen(p), { x: 100, y: 250 }, 5)).toBe(false);
    expect(input.flashUntil).toBe(5 + flashSeconds);
  });

  it("starts an on-drag transition past the threshold its way, and the transition follows the pointer", () => {
    const { p, input } = setup();
    input.down(screen(p), { x: 50, y: 115 }, 1);
    // Rightwards does not match "push left".
    expect(input.move(screen(p), { x: 60, y: 115 }, true, 1)).toBe(false);
    input.up(screen(p), { x: 60, y: 115 }, 1);
    input.down(screen(p), { x: 50, y: 115 }, 2);
    expect(input.move(screen(p), { x: 40, y: 115 }, true, 2)).toBe(true);
    expect(name(p)).toBe("Details");
    // Half the screen's width leftwards: half way through the transition.
    input.move(screen(p), { x: 300 + 50 - 100, y: 115 }, true, 2.1);
    expect(p.transitionProgress(2.1)).toBeCloseTo(0.5, 6);
  });

  it("steps through the top-level frames with the arrows and restarts on R", () => {
    const { p, input } = setup();
    const none = { ctrl: false, alt: false, shift: false, cmd: false };
    expect(input.key(screen(p), "ArrowRight", none, 1)).toBe(true);
    expect(name(p)).toBe("Details");
    expect(input.key(screen(p), "ArrowLeft", none, 2)).toBe(true);
    expect(name(p)).toBe("Home");
    input.key(screen(p), "Space", none, 3);
    expect(name(p)).toBe("Details");
    expect(input.key(screen(p), "R", none, 4)).toBe(true);
    expect(name(p)).toBe("Home");
    expect(input.key(screen(p), "R", { ...none, cmd: true }, 5)).toBe(false);
  });

  it("draws an opening overlay apart with its progress, then closes it on a click outside", () => {
    const { p, input, sheet } = setup();
    input.down(screen(p), { x: 150, y: 115 }, 1);
    expect(input.up(screen(p), { x: 150, y: 115 }, 1)).toBe(true);
    const [l] = overlayLayers(p, 1.25);
    expect(l.raw).toBeCloseTo(0.25, 9);
    expect(l.box).toEqual({ x: 50, y: 240, width: 100, height: 60 });
    expect(l.doc.nodes[l.doc.currentPage]).toMatchObject({ children: [sheet] });
    expect(input.down(screen(p), { x: 10, y: 10 }, 3)).toBe(true);
    expect(p.overlays).toHaveLength(0);
    expect(overlayLayers(p, 3.5)[0].raw).toBeCloseTo(0.5, 9);
  });
});
