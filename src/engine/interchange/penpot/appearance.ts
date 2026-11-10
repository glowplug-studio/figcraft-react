import { blendFromName } from "../../blend";
import { withAlpha, colour } from "../../colour";
import { squareLinearWidth, type GradientHandle } from "../../gradient";
import { solidPaint } from "../../solid-paint";
import { isUuid } from "./archive";
import { type PenpotMedia } from "./media";
import { object, type JsonObject } from "../rest/values";
import { hex, numberField as num, records, fingerprint } from "./values";

type Warn = (message: string) => void;

export function gradient(raw: JsonObject) {
  if (raw.type !== "linear" && raw.type !== "radial") return;
  const stops = records(raw.stops).slice(0, 128).flatMap(stop => {
    const c = hex(stop.color);
    return c ? [{position: Math.fround(num(stop, "offset", 0, 0, 1)), color: withAlpha(c, c.a * num(stop, "opacity", 1, 0, 1))}] : [];
  });
  if (!stops.length) return;
  const from: GradientHandle = [num(raw, "startX", 0), num(raw, "startY", 0)];
  const to: GradientHandle = [num(raw, "endX", 1), num(raw, "endY", 0)];
  const radius = num(raw, "width", 1, 0, 1000);
  const width = raw.type === "linear" ? squareLinearWidth(from, to, 1, 1) :
    [from[0] - (to[1] - from[1]) * radius, from[1] + (to[0] - from[0]) * radius];
  return {kind: raw.type, stops, from, to, width};
}

export async function paints(layer: JsonObject, stroke: boolean, warn: Warn, media: PenpotMedia, base: string) {
  const out = [];
  const list = records(stroke ? layer.strokes : layer.fills);
  if (!stroke && layer.type === "image" && layer.metadata !== undefined)
    list.unshift({fillImage: {...object(layer.metadata), keepAspectRatio: false}, fillOpacity: 1});
  for (const fill of list.slice(0, 50)) {
    const opacity = Math.fround(num(fill, stroke ? "strokeOpacity" : "fillOpacity", stroke ? num(fill, "fillOpacity", 1, 0, 1) : 1, 0, 1));
    const visible = fill.hidden !== true;
    const raw = fill[stroke ? "strokeColorGradient" : "fillColorGradient"] ?? fill.gradient;
    const image = stroke && Object.hasOwn(fill, "strokeImage") ? fill.strokeImage : fill.fillImage;
    if (image !== undefined) {
      const {id, keepAspectRatio} = object(image);
      if (!isUuid(id)) { warn("Invalid image fill identifier"); continue; }
      const hash = await media.resolve(base, id);
      if (!hash) { warn("Missing or unsupported Penpot image " + id); continue; }
      out.push({type: "image", image: hash, opacity, visible, blend: "normal",
        ...(keepAspectRatio === false && {scale_mode: "crop", crop: [1,0,0,1,0,0]})});
    } else if (raw !== undefined) {
      const g = gradient(object(raw));
      if (g) out.push({type: "gradient", ...g, visible, opacity, blend: "normal"});
      else warn("Unrecognized Penpot gradient");
    } else {
      const c = hex((stroke ? fill.strokeColor : undefined) ?? fill.fillColor);
      if (c) out.push({...solidPaint(c), opacity: Math.fround(c.a * opacity), visible});
    }
  }
  return out.reverse();
}

function strokeProps(stroke?: JsonObject) {
  const weight = stroke ? num(stroke, "strokeWidth", 1, 0, 1e4) : 1;
  const prop = object(stroke);
  const cap = (v: unknown) => v === "round" || v === "square" ? v : v === "line-arrow" ? "lineArrow" : v === "triangle-arrow" ? "triangleArrow" : undefined;
  const start = cap(prop.strokeCapStart) ?? "none", end = cap(prop.strokeCapEnd) ?? start;
  const dotted = prop.strokeStyle === "dotted";
  const dashCap = (c: string) => dotted && !c.endsWith("Arrow") ? "round" : c;
  return {weight, align: prop.strokeAlignment === "center" ? "center" : ["outer", "outside"].includes(String(prop.strokeAlignment)) ? "outside" : "inside",
    join: prop.strokeJoin === "round" || prop.strokeJoin === "bevel" ? prop.strokeJoin : "miter",
    sides: null, cap_start: dashCap(start), cap_end: dashCap(end), miter_limit: 4,
    dashes: dotted ? [0, weight + 5] : prop.strokeStyle === "dashed" ? [weight + 10, weight + 10] :
      prop.strokeStyle === "mixed" ? [weight + 5, weight + 5, weight + 1, weight + 5] : []};
}

function effects(layer: JsonObject, warn: Warn) {
  const out = [];
  for (const shadow of [...records(layer.shadow), ...records(layer.shadows)].slice(0, 32)) {
    const raw = shadow.color ?? shadow;
    const c = hex(raw) ?? hex(object(raw).color) ?? colour(0, 0, 0);
    const offset = object(shadow.offset);
    out.push({type: shadow.style === "inner-shadow" || shadow.style === "inner" ? "innerShadow" : "dropShadow",
      color: withAlpha(c, c.a * num(object(raw), "opacity", num(shadow, "opacity", 1))), visible: shadow.hidden !== true,
      offset: [num(shadow, "offsetX", num(offset, "x", 0)), num(shadow, "offsetY", num(offset, "y", 0))],
      spread: num(shadow, "spread", 0, -1e4, 1e4), radius: num(shadow, "blur", 0, 0, 1e4)});
  }
  for (const key of ["blur", "backgroundBlur"]) {
    if (!Object.hasOwn(layer, key)) continue;
    const blur = object(layer[key]), mode = typeof blur.type === "string" ? blur.type : "layer-blur";
    const type = ["layer", "layer-blur"].includes(mode) ? "layerBlur" : ["background", "background-blur"].includes(mode) ? "backgroundBlur" : undefined;
    if (type) out.push({type, radius: num(blur, "value", 0, 0, 1000), visible: blur.hidden !== true});
    else warn("Unsupported Penpot blur type '" + mode + "'");
  }
  return out;
}

export async function appearance(layer: JsonObject, metadata: Record<string, string>, warn: Warn, media: PenpotMedia, base: string) {
  const fills = await paints(layer, false, warn, media, base), strokes = await paints(layer, true, warn, media, base);
  const first = records(layer.strokes)[0], stroke = strokeProps(first);
  if (!first && layer.type === "frame" && layer.isVariantContainer === true) stroke.dashes = [10,5];
  if (layer.type === "svg-raw") {fills.length = 0; strokes.length = 0;}
  if (!first && layer.type === "path") stroke.align = "center";
  if (Object.hasOwn(layer, "strokes")) {
    const native = strokes.map(p => {
      if ("colorAlpha" in p && p.colorAlpha === 1) { const {colorAlpha, ...rest} = p; return rest; }
      return p;
    });
    metadata["penpot.fp.strokes"] = fingerprint({stroke, strokes: native});
  }
  const radius = num(layer, "rx", 0);
  const radii = [1, 2, 3, 4].map(i => Math.max(0, num(layer, "r" + i, radius)));
  const h = layer.constraintsH, v = layer.constraintsV;
  return {fills, strokes, ...((first || layer.type === "path" || layer.isVariantContainer === true && layer.type === "frame") && {stroke}), effects: effects(layer, warn), visible: layer.hidden !== true, locked: layer.blocked === true,
    is_mask: layer.mask === true, mask_type: layer.maskType === "luminance" || layer.maskType === "vector" ? layer.maskType : "alpha",
    constrain_proportions: layer.proportionLock === true, opacity: Math.fround(num(layer, "opacity", 1, 0, 1)),
    constraints: {horizontal: h === "leftright" || h === "left-right" ? "leftRight" : h === "right" || h === "center" || h === "scale" ? h : "left",
      vertical: v === "topbottom" || v === "top-bottom" ? "topBottom" : v === "bottom" || v === "center" || v === "scale" ? v : "top"},
    blend: blendFromName(layer.blendMode) ?? "normal", ...(radii.some(Boolean) && {corners: {radii, smoothing: 0}})};
}
