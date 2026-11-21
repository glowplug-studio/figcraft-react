import { describe, expect, it } from "vitest";
import fixture from "../fixtures/native-invert-zoom.json";
import { EditorEngine } from "../../src/engine/editor";
import { defaultViewport, wheelView, type WheelInput } from "../../src/engine/viewport";

// Preferences ▸ Invert zoom direction: `pref.invertZoom` sets or toggles the preference, and with it on Ctrl or Cmd
// with the wheel zooms the other way by the same factor, while a trackpad pinch and scrolling are unchanged. The
// command was observed through the native engine at bad07e44 (upstream 6fce958a, 1ef0c16f;
// tests/fixtures/native-invert-zoom.provenance.md). The wheel cases restate
// crates/ui-egui/src/canvas/wheel_zoom_tests.rs; the native canvas cannot be driven headless here.

type Receipt = Record<string, unknown>;
const cases = fixture.cases as unknown as { name: string; commands: [string, Record<string, unknown>][]; receipts: Receipt[] }[];

describe("native Invert zoom direction preference", () => {
  it.each(cases.map(c => [c.name, c] as const))("%s", (_name, c) => {
    const engine = new EditorEngine();
    for (const [i, [command, params]] of c.commands.entries()) {
      const expected = c.receipts[i], why = `${command} ${JSON.stringify(params)} (step ${i})`;
      if ("error" in expected) { expect(() => engine.execute(command, params), why).toThrow(String(expected.error)); continue; }
      const actual = engine.execute(command, params) as Receipt;
      if (command === "view.get") expect({ zoom: actual.zoom, cx: actual.cx, cy: actual.cy }, why).toEqual({ zoom: expected.zoom, cx: expected.cx, cy: expected.cy });
      else if (command !== "view.set") expect(actual, why).toEqual(expected);
    }
  });

  const wheel = (deltaY: number, keys: Partial<WheelInput> = {}): WheelInput => ({ deltaX: 0, deltaY, deltaMode: 0, ctrlKey: false, metaKey: false, shiftKey: false, ...keys });
  const view = Object.freeze({ ...defaultViewport, cx: 0, cy: 0, zoom: 1 }), anchor = { x: 30, y: 40 };

  // wheel_zoom_tests.rs: invert_zoom_direction_reverses_cmd_wheel_zoom and its Ctrl counterpart.
  it("zooms the other way by the same factor with Cmd or Ctrl and the wheel", () => {
    for (const [keys, held] of [[{ metaKey: true }, false], [{ ctrlKey: true }, true]] as const) {
      const plain = wheelView(view, wheel(-100, keys), anchor, false, held), inverted = wheelView(view, wheel(-100, keys), anchor, true, held);
      expect(plain.zoom, "a wheel turned away zooms in").toBeGreaterThan(1);
      expect(inverted.zoom, "and zooms out with the preference on").toBeCloseTo(1 / plain.zoom, 12);
      // Both keep the page point under the pointer where it is.
      for (const next of [plain, inverted]) expect([(anchor.x - next.cx) * next.zoom, (anchor.y - next.cy) * next.zoom].map(v => Math.round(v * 1e9) / 1e9)).toEqual([anchor.x, anchor.y]);
      expect(wheelView(view, wheel(100, keys), anchor, true, held).zoom, "the other direction is reversed too").toBeCloseTo(plain.zoom, 12);
    }
  });

  // wheel_zoom_tests.rs: a pinch is unchanged, with factors above and below 1.
  it("leaves a trackpad pinch as it is", () => {
    for (const deltaY of [-40, 40]) {
      const pinch = wheel(deltaY, { ctrlKey: true });
      expect(wheelView(view, pinch, anchor, true, false), `a pinch of ${deltaY}`).toEqual(wheelView(view, pinch, anchor, false, false));
    }
  });

  // wheel_zoom_tests.rs: panning is the same with the preference on and off.
  it("leaves scrolling as it is", () => {
    for (const keys of [{}, { shiftKey: true }] as const) {
      const scroll = wheel(60, keys);
      expect(wheelView(view, scroll, anchor, true, false)).toEqual(wheelView(view, scroll, anchor, false, false));
      expect(wheelView(view, scroll, anchor, true, false).zoom).toBe(1);
    }
  });
});
