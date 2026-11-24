import { describe, expect, it } from "vitest";
import { anchorOffset, anchoredOverlayRect, overlayRect } from "../../src/engine/prototype-overlays";

// Restated from native doc/src/proto_overlay_anchor_tests.rs and ui-egui/src/present/tests.rs (overlay_positions) at bad07e44.
const trigger = [100, 40] as const, overlay = [60, 200] as const;
describe("overlay placement, as native's tests pin it", () => {
  it("puts an outside overlay above or below the trigger with edges lined up", () => {
    expect(anchorOffset("triggerOutside", "bottomLeft", trigger, overlay)).toEqual([0, 40]);
    expect(anchorOffset("triggerOutside", "bottomCenter", trigger, overlay)).toEqual([20, 40]);
    expect(anchorOffset("triggerOutside", "bottomRight", trigger, overlay)).toEqual([40, 40]);
    expect(anchorOffset("triggerOutside", "topLeft", trigger, overlay)).toEqual([0, -200]);
    expect(anchorOffset("triggerOutside", "topCenter", trigger, overlay)).toEqual([20, -200]);
    expect(anchorOffset("triggerOutside", "topRight", trigger, overlay)).toEqual([40, -200]);
    expect(anchorOffset("triggerOutside", "center", trigger, overlay)).toEqual([20, -80]);
  });
  it("uses the presets on the trigger for an inside overlay", () => {
    expect(anchorOffset("triggerInside", "topLeft", trigger, overlay)).toEqual([0, 0]);
    expect(anchorOffset("triggerInside", "topRight", trigger, overlay)).toEqual([40, 0]);
    expect(anchorOffset("triggerInside", "bottomLeft", trigger, overlay)).toEqual([0, -160]);
    expect(anchorOffset("triggerInside", "bottomCenter", trigger, overlay)).toEqual([20, -160]);
    expect(anchorOffset("triggerInside", "center", trigger, overlay)).toEqual([20, -80]);
  });
  it("gives no preset offset for the screen or a manual position", () => {
    expect(anchorOffset("screen", "bottomLeft", trigger, overlay)).toBeUndefined();
    expect(anchorOffset("triggerOutside", "manual", trigger, overlay)).toBeUndefined();
    expect(anchorOffset("triggerInside", "manual", trigger, overlay)).toBeUndefined();
  });
  it("places overlays on the screen", () => {
    const base = { x: 0, y: 0, width: 400, height: 800 }, size = [200, 100] as const;
    expect(overlayRect("center", base, size)).toMatchObject({ x: 100, y: 350 });
    expect(overlayRect("bottomCenter", base, size)).toMatchObject({ x: 100, y: 700 });
    expect(overlayRect("topRight", base, size)).toMatchObject({ x: 200, y: 0 });
    expect(overlayRect("manual", base, size, { x: 30, y: 40, width: 50, height: 20 })).toMatchObject({ x: 30, y: 60 });
    expect(anchoredOverlayRect("bottomLeft", "triggerOutside", base, size, { x: 30, y: 40, width: 50, height: 20 })).toMatchObject({ x: 30, y: 60 });
    expect(anchoredOverlayRect("bottomLeft", "screen", base, size, { x: 30, y: 40, width: 50, height: 20 })).toMatchObject({ x: 0, y: 700 });
  });
});
