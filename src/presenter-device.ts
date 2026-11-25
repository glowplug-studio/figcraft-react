import { bezel, uprightWidth, type Rect } from "./engine/prototype-layout";
import type { DeviceColour } from "./engine/prototype-settings";

/** Source: upstream ui-egui/src/present/device.rs: a presentation device drawn in code round its screen (original shapes, no artwork). */
const glass = "#161618";
const rgb = (c: readonly [number, number, number]) => `rgb(${c[0]},${c[1]},${c[2]})`;
/** Native `shade`: a device colour lighter (`k` > 0, towards white) or darker (`k` < 0, towards black). */
function shade(c: DeviceColour, k: number): string {
  const t = Math.min(Math.max(k, -1), 1), f = (v: number) => Math.min(Math.max(Math.round(t >= 0 ? v + (255 - v) * t : v * (1 + t)), 0), 255);
  return rgb([f(c.rgb[0]), f(c.rgb[1]), f(c.rgb[2])]);
}
/** Native `rim`: the coloured band round a device's glass. */
const rim = (w: number, b: number) => Math.min(Math.max(w * 0.016, 1.5), Math.max(b * 0.5, 1.5));
const expand = (r: Rect, d: number): Rect => ({ x0: r.x0 - d, y0: r.y0 - d, x1: r.x1 + d, y1: r.y1 + d });
type Radii = number | [number, number, number, number];
function fillRound(ctx: CanvasRenderingContext2D, r: Rect, radius: Radii, fill: string) {
  ctx.beginPath();
  const rr = typeof radius === "number" ? Math.min(Math.max(radius, 0), 255) : radius;
  ctx.roundRect(r.x0, r.y0, r.x1 - r.x0, r.y1 - r.y0, rr);
  ctx.fillStyle = fill; ctx.fill();
}

/** Native `device_body`: rounded slabs in the device's colour with black glass round the screen `s` (canvas pixels); turned to landscape
 * (a quarter turn counter-clockwise) a phone's left side is at the bottom. */
export function drawDeviceBody(ctx: CanvasRenderingContext2D, device: string, s: Rect, landscape: boolean, colour: DeviceColour, px = 1) {
  const body = shade(colour, 0), edge = shade(colour, -0.3), metal = shade(colour, 0.12);
  const w = uprightWidth(s.x1 - s.x0, s.y1 - s.y0, landscape);
  const [b, screenR] = bezel(device, w), band = rim(w, b);
  ctx.save();
  if (device === "MacBook Air") {
    const lid = expand(s, b);
    fillRound(ctx, lid, b * 1.2, body);
    fillRound(ctx, expand(lid, -band), b * 1.2 - band, glass);
    const base: Rect = { x0: lid.x0 - w * 0.08, y0: lid.y1, x1: lid.x1 + w * 0.08, y1: lid.y1 + Math.max(w * 0.022, 6 * px) };
    fillRound(ctx, base, [2 * px, 2 * px, 10 * px, 10 * px], metal);
    const cx = (base.x0 + base.x1) / 2, cy = base.y0 + 1.5 * px;
    fillRound(ctx, { x0: cx - w * 0.06, y0: cy - 1.5 * px, x1: cx + w * 0.06, y1: cy + 1.5 * px }, 2 * px, edge);
  } else if (device === "Desktop") {
    const screen = expand(s, b);
    fillRound(ctx, screen, 8 * px, body);
    fillRound(ctx, expand(screen, -band), 8 * px - band, glass);
    const cx = (screen.x0 + screen.x1) / 2;
    const neck: Rect = { x0: cx - w * 0.06, y0: screen.y1, x1: cx + w * 0.06, y1: screen.y1 + w * 0.08 };
    ctx.fillStyle = metal; ctx.fillRect(neck.x0, neck.y0, neck.x1 - neck.x0, neck.y1 - neck.y0);
    fillRound(ctx, { x0: neck.x0 - w * 0.06, y0: neck.y1, x1: neck.x1 + w * 0.06, y1: neck.y1 + 6 * px }, 3 * px, edge);
  } else {
    // Phones and tablets: a rounded slab (phones with side buttons).
    const slab = expand(s, b), sw = slab.x1 - slab.x0, sh = slab.y1 - slab.y0;
    if (!device.startsWith("iPad")) {
      for (const [left, f0, h] of [[true, 0.18, 0.06], [true, 0.27, 0.1], [false, 0.24, 0.13]] as const) {
        const btn: Rect = landscape
          ? (() => { const y = left ? slab.y1 - 0.5 * px : slab.y0 - 2.5 * px; return { x0: slab.x0 + sw * f0, y0: y, x1: slab.x0 + sw * (f0 + h), y1: y + 2.5 * px }; })()
          : (() => { const x = left ? slab.x0 - 2 * px : slab.x1; return { x0: x, y0: slab.y0 + sh * f0, x1: x + 2.5 * px, y1: slab.y0 + sh * (f0 + h) }; })();
        fillRound(ctx, btn, px, edge);
      }
    }
    fillRound(ctx, slab, screenR + b, body);
    ctx.beginPath(); ctx.roundRect(slab.x0 + px / 2, slab.y0 + px / 2, sw - px, sh - px, Math.min(screenR + b, 255));
    ctx.strokeStyle = edge; ctx.lineWidth = px; ctx.stroke();
    // The glass reaches round the screen's square corners (masked by the glass on top).
    const g = b - band;
    fillRound(ctx, expand(slab, -band), Math.min(screenR + g, g * 3.4), glass);
  }
  ctx.restore();
}

/** Native `device_glass`: rounded screen corners (glass masks the frame's square corners) and a phone's camera pill. */
export function drawDeviceGlass(ctx: CanvasRenderingContext2D, device: string, s: Rect, landscape: boolean) {
  const w = uprightWidth(s.x1 - s.x0, s.y1 - s.y0, landscape), [, screenR] = bezel(device, w);
  if (screenR <= 0) return;
  const r = Math.min(screenR, (s.x1 - s.x0) / 2, (s.y1 - s.y0) / 2);
  ctx.save();
  ctx.fillStyle = glass;
  // What lies between each corner and its rounding.
  ctx.beginPath();
  for (const [cx, cy, ax, ay] of [[s.x0, s.y0, 1, 1], [s.x1, s.y0, -1, 1], [s.x1, s.y1, -1, -1], [s.x0, s.y1, 1, -1]] as const) {
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + ax * r, cy);
    ctx.arcTo(cx, cy, cx, cy + ay * r, r);
    ctx.closePath();
  }
  ctx.fill();
  if (device.startsWith("iPhone")) {
    const [cx, cy, pw, ph] = landscape ? [s.x0 + w * 0.045, (s.y0 + s.y1) / 2, w * 0.085, w * 0.3] : [(s.x0 + s.x1) / 2, s.y0 + w * 0.045, w * 0.3, w * 0.085];
    fillRound(ctx, { x0: cx - pw / 2, y0: cy - ph / 2, x1: cx + pw / 2, y1: cy + ph / 2 }, Math.min(w * 0.0425, 255), "#000");
  }
  ctx.restore();
}
