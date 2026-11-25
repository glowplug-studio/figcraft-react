import type { Document, NodeId } from "./document";
import { presentScales, type PresentOptions } from "./prototype-commands";
import { anchoredOverlayRect, type Box } from "./prototype-overlays";
import type { OverlayState, PrototypePlayer } from "./prototype-player";
import { clampScroll, pageDevice } from "./prototype-scroll";
import { deviceColour, presentedDevice, type Device, type DeviceColour } from "./prototype-settings";
import { boundsOf } from "./viewport";

/** Source: upstream ui-egui/src/present/layout.rs and present.rs (`PresentScale`): where the presented frame sits in the player's area. */
export type PresentScale = PresentOptions["scale"];
/** Native `PresentScale::options`: a device offers no fit width. */
export const scaleOptions = (device: boolean): readonly PresentScale[] => device ? ["fit", "fill", "actual"] : presentScales;
/** Native `PresentScale::next` (Z): the option after this one, wrapping round; one not offered goes back to the first. */
export function nextScale(s: PresentScale, device: boolean): PresentScale {
  const opts = scaleOptions(device), i = opts.indexOf(s);
  return opts[i < 0 ? 0 : (i + 1) % opts.length];
}
/** Native `PresentScale::label`. */
export function scaleLabel(s: PresentScale, device: boolean): string {
  if (s === "fitWidth") return "Fit width";
  if (device) return s === "fit" ? "Fit device to window" : s === "fill" ? "Zoom device to fill window" : "Device at 100%";
  return s === "fit" ? "Fit to window" : s === "fill" ? "Fill window" : "Actual size (100%)";
}

/** A rectangle in screen points. */
export interface Rect { readonly x0: number; readonly y0: number; readonly x1: number; readonly y1: number }
const width = (r: Rect) => r.x1 - r.x0, height = (r: Rect) => r.y1 - r.y0;
const shrink = (r: Rect, d: number): Rect => ({ x0: r.x0 + d, y0: r.y0 + d, x1: r.x1 - d, y1: r.y1 - d });
/** Native `Place`: page → screen mapping for one presented frame. */
export interface Place { readonly pageMin: readonly [number, number]; readonly origin: readonly [number, number]; readonly scale: number }
export function placeCentred(fb: Box, centre: readonly [number, number], scale: number): Place {
  return { pageMin: [fb.x, fb.y], origin: [centre[0] - fb.width * scale / 2, centre[1] - fb.height * scale / 2], scale };
}
export const placePoint = (p: Place, x: number, y: number): [number, number] => [p.origin[0] + (x - p.pageMin[0]) * p.scale, p.origin[1] + (y - p.pageMin[1]) * p.scale];
export function placeRect(p: Place, b: Box): Rect {
  const [x0, y0] = placePoint(p, b.x, b.y), [x1, y1] = placePoint(p, b.x + b.width, b.y + b.height);
  return { x0, y0, x1, y1 };
}
/** The page point under screen point `q`. */
export const placePage = (p: Place, q: readonly [number, number]): [number, number] => [p.pageMin[0] + (q[0] - p.origin[0]) / p.scale, p.pageMin[1] + (q[1] - p.origin[1]) / p.scale];
/** Screen rect `r` in page units of `p`. */
export function pageBox(p: Place, r: Rect): Box {
  const [x0, y0] = placePage(p, [r.x0, r.y0]), [x1, y1] = placePage(p, [r.x1, r.y1]);
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

/** Native `upright_w`: the width of a device's screen of `size` held upright (its short side when turned). */
export const uprightWidth = (w: number, h: number, landscape: boolean) => landscape ? h : w;
/** Native `bezel`: the bezel width round a device's screen of upright width `w`, and the screen's corner radius. */
export function bezel(device: string, w: number): [number, number] {
  if (device === "MacBook Air") return [Math.max(w * 0.025, 6), 0];
  if (device === "Desktop") return [Math.max(w * 0.02, 6), 0];
  if (device.startsWith("iPad")) return [Math.max(w * 0.05, 8), w * 0.04];
  return [Math.max(w * 0.06, 6), w * 0.13];
}
/** Native `body_outset`: how far a device's body reaches past its screen: (each side, top, bottom). */
function bodyOutset(device: string, w: number, h: number, landscape: boolean): [number, number, number] {
  const u = uprightWidth(w, h, landscape), [b] = bezel(device, u);
  if (device === "MacBook Air") return [b + u * 0.08, b, b + Math.max(u * 0.022, 6)];
  if (device === "Desktop") return [b, b, b + u * 0.08 + 6];
  return landscape ? [b, b + 3, b + 3] : [b + 3, b, b];
}

/** Native `Chrome`: where the player sits (the preview pane always fits). */
export interface Chrome { readonly pane: boolean; readonly pad: number }
export const fullChrome: Chrome = Object.freeze({ pane: false, pad: 32 });
export const paneChrome: Chrome = Object.freeze({ pane: true, pad: 12 });
export interface PlacedLayer { readonly id: NodeId; readonly place: Place; readonly rect: Rect }
/** Native `Layout`. */
export interface Layout {
  readonly disp: Document;
  readonly scale: number;
  readonly place: Place;
  /** What shows the prototype: the device's screen, else the presented frame itself. */
  readonly screen: Rect;
  /** What the presented frame may draw into: the device's screen, else the whole area. */
  readonly clip: Rect;
  readonly device?: Device;
  readonly landscape: boolean;
  /** The colour of the device's body, when it is drawn round its screen. */
  readonly colour?: DeviceColour;
  readonly overlays: readonly PlacedLayer[];
  readonly closing: readonly PlacedLayer[];
}

/** Native `layout`: place the presented frame in `area` on its device's screen (the whole device sized by the scale option), else the
 * frame itself. Fit and 100% keep the chrome's padding; Fit never goes above 100%. What does not fit pans (`player.pan`). The preview
 * pane always fits. A responsive prototype's frame is first resized to the device's screen, or without a device to the whole area. */
export function presentLayout(p: PrototypePlayer, area: Rect, chrome: Chrome): Layout | undefined {
  if (!p.doc || !p.doc.nodes[p.current]) return undefined;
  const settings = pageDevice(p.doc, p.current), device = presentedDevice(settings);
  const landscape = !!device && settings.rotation === "landscape" && device.rotates;
  const fills = settings.responsive && !device;
  p.respondTo(settings.responsive ? device ? [device.width, device.height] : [Math.round(width(area)), Math.round(height(area))] : undefined);
  const disp = p.display();
  const fb = disp && boundsOf(disp, [p.current]);
  if (!disp || !fb) return undefined;
  const view: PresentOptions = chrome.pane ? { ...p.view, scale: "fit", deviceFrame: true } : p.view;
  // Custom sizes are just a screen: no body.
  const body = device && view.deviceFrame && device.colors.length ? device : undefined;
  const pad = !fills && (view.scale === "fit" || view.scale === "actual") ? chrome.pad : 0;
  const avail = shrink(area, pad);
  const [sw, sh] = device ? [device.width, device.height] : [fb.width, fb.height];
  const outer = (scale: number) => {
    const w = sw * scale, h = sh * scale;
    const [x, top, bottom] = body ? bodyOutset(body.name, w, h, landscape) : [0, 0, 0];
    return { w, h, x, top, whole: [w + 2 * x, h + top + bottom] as const };
  };
  const factor = (ow: number, oh: number) => {
    const kx = width(avail) / Math.max(ow, 1), ky = height(avail) / Math.max(oh, 1);
    return view.scale === "fit" ? Math.min(kx, ky) : view.scale === "fitWidth" ? kx : view.scale === "fill" ? Math.max(kx, ky) : 1;
  };
  let scale = fills ? 1 : factor(sw, sh);
  // The body does not scale exactly with the screen (its edges have a minimum): size it once more.
  if (body) { const o = outer(scale).whole; scale *= factor(o[0], o[1]); }
  const max = view.scale === "fit" ? 1 : 16;
  scale = Number.isFinite(scale) ? Math.min(Math.max(scale, 0.01), max) : 0.01;
  const o = outer(scale);
  p.zoom = scale;
  // What is bigger than the window pans: starting centred across and at the top.
  const over = (d: number) => d > 0.5 ? d : 0;
  const excess = [over(o.whole[0] - width(avail)), over(o.whole[1] - height(avail))] as const;
  p.panRange = excess;
  // While a drag or fling moves the view it may stretch past the ends; otherwise it stays in range.
  const live = p.dragScroll?.[0] === "view" || p.fling?.target === "view";
  if (!live && p.pan) p.pan = clampScroll(p.pan, p.panRange);
  const pan = p.offset("view");
  const along = (ex: number, min: number, centre: number, len: number, off: number) => ex > 0 ? min - off : centre - len / 2;
  const min = [along(excess[0], avail.x0, (area.x0 + area.x1) / 2, o.whole[0], pan[0]), along(excess[1], avail.y0, (area.y0 + area.y1) / 2, o.whole[1], pan[1])];
  const screen: Rect = { x0: min[0] + o.x, y0: min[1] + o.top, x1: min[0] + o.x + o.w, y1: min[1] + o.top + o.h };
  const place = placeCentred(fb, [(screen.x0 + screen.x1) / 2, (screen.y0 + screen.y1) / 2], scale);
  const placeOverlay = (s: OverlayState): PlacedLayer | undefined => {
    const ob = disp.nodes[s.id] ? boundsOf(disp, [s.id]) : undefined;
    if (!ob) return undefined;
    const anchor = s.anchor && placeRect(place, { x: s.anchor.x0, y: s.anchor.y0, width: s.anchor.x1 - s.anchor.x0, height: s.anchor.y1 - s.anchor.y0 });
    const r = anchoredOverlayRect(s.position, s.anchorTo, { x: screen.x0, y: screen.y0, width: width(screen), height: height(screen) }, [ob.width * scale, ob.height * scale],
      anchor && { x: anchor.x0, y: anchor.y0, width: width(anchor), height: height(anchor) }, s.offset && [s.offset[0] * scale, s.offset[1] * scale]);
    return { id: s.id, place: { pageMin: [ob.x, ob.y], origin: [r.x, r.y], scale }, rect: { x0: r.x, y0: r.y, x1: r.x + r.width, y1: r.y + r.height } };
  };
  const overlays = p.overlays.map(placeOverlay).filter((x): x is PlacedLayer => !!x);
  const closing = p.closing.map(([, s]) => placeOverlay(s)).filter((x): x is PlacedLayer => !!x);
  return { disp, scale, place, screen, clip: device ? screen : area, device, landscape, colour: body ? deviceColour(settings) : undefined, overlays, closing };
}

/** Native Z (`player_key`): the full-window presenter's next size option; a responsive frame filling the window has none. True when used. */
export function cycleScale(p: PrototypePlayer, l: Layout | undefined, chrome: Chrome): boolean {
  if (chrome.pane || (!l?.device && p.fit)) return false;
  p.setScale(nextScale(p.view.scale, !!l?.device));
  return true;
}
