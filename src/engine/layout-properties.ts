import { readAutoLayout, sameAutoLayout, wireAutoLayout, type AutoLayout, type GridTrack } from "./auto-layout";
import type { FrameNode, LayerNode } from "./document";
import { parseNumber, propertyEnum } from "./parameters";

export const frameTuning = new Set([
  "gap", "itemSpacing", "columnGap", "crossGap", "counterAxisSpacing", "rowGap",
  "padding", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft", "paddingHorizontal", "paddingVertical",
  "mainAlign", "primaryAxisAlignItems", "crossAlign", "counterAxisAlignItems", "contentAlign", "counterAxisAlignContent",
  "wrap", "gridColumns", "gridRows", "strokesIncluded", "reverseZ", "columnTracks", "gridColumnTracks", "rowTracks", "gridRowTracks",
]);

export function commandSizing(raw: unknown): GridTrack["sizing"] {
  switch (typeof raw === "string" && raw.toLowerCase()) {
    case "fixed": return "fixed";
    case "hug": case "auto": case "hug contents": return "hug";
    case "fill": case "fill container": case "stretch": return "fill";
    default: throw new Error("sizing must be fixed, hug or fill");
  }
}

const defaultContainer = readAutoLayout({gap: 0, padding: [0, 0, 0, 0]});
const nativeFields = new Set(Object.keys(wireAutoLayout(defaultContainer)));
const clamp = (v: number, max: number) => Math.min(max, Math.max(0, v));

function commandTrack(raw: unknown): GridTrack {
  let sizing: GridTrack["sizing"] = "fixed", value: number;
  if (typeof raw === "string") {
    const text = raw.trim().toLowerCase();
    if (text === "fill") return Object.freeze({sizing: "fill", value: 1});
    if (text === "auto" || text === "hug") return Object.freeze({sizing: "hug", value: 0});
    if (text.endsWith("fr")) {
      sizing = "fill";
      const factor = text.slice(0,-2).trim();
      if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/.test(factor)) throw new Error("Invalid fractional track");
      value = parseNumber(factor);
    } else value = parseNumber(text);
  } else if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const obj = raw as Record<string,unknown>;
    sizing = commandSizing(Object.hasOwn(obj, "sizing") ? obj.sizing : obj.type);
    if (sizing === "hug") return Object.freeze({sizing, value: 0});
    try { value = parseNumber(Object.hasOwn(obj,"value") ? obj.value : obj.size); }
    catch (error) { if (sizing === "fixed") throw error; value = 1; }
  } else if (typeof raw === "number") value = parseNumber(raw);
  else throw new Error("Invalid grid track");
  return Object.freeze({sizing, value: clamp(value, sizing === "fill" ? 1e4 : 1e6)});
}

function commandLayoutObject(raw: Record<string, unknown>) {
  // Native serde ignores extra keys on command objects. Archives keep their stricter interchange checks.
  const entries = Object.entries(raw).sort(([a],[b]) => a < b ? -1 : a > b ? 1 : 0);
  const values: Record<string, unknown> = {};
  for (const [key,value] of entries) {
    const field = key.replace(/[A-Z]/g, ch => "_"+ch.toLowerCase());
    if (!nativeFields.has(field)) continue;
    values[field] = (field === "column_tracks" || field === "row_tracks") && Array.isArray(value)
      ? value.map(track => track && typeof track === "object" && !Array.isArray(track)
        ? Object.fromEntries(Object.entries(track).filter(([k]) => k === "sizing" || k === "value")) : track)
      : value;
  }
  return readAutoLayout(values);
}

function commandMode(layout: AutoLayout | undefined, raw: unknown): AutoLayout | undefined {
  if (raw === null) return undefined;
  if (raw && typeof raw === "object" && !Array.isArray(raw)) return commandLayoutObject(raw as Record<string,unknown>);
  switch (typeof raw === "string" && raw.toLowerCase()) {
    case "none": return undefined;
    case "horizontal": case "row": return {...(layout ?? defaultContainer), mode:"horizontal"};
    case "vertical": case "column": return {...(layout ?? defaultContainer), mode:"vertical"};
    case "grid": return {...(layout ?? defaultContainer), mode:"grid"};
    default: throw new Error("layout must be none, horizontal, vertical, grid or an object");
  }
}

function tune(layout: AutoLayout, key: string, raw: unknown): AutoLayout {
  const num = () => parseNumber(raw, key);
  switch (key) {
    case "gap": case "itemSpacing": case "columnGap": return {...layout, gap: num()};
    case "crossGap": case "counterAxisSpacing": case "rowGap": return {...layout, crossGap: num()};
    case "padding": {
      const p = (Array.isArray(raw) ? raw : [raw]).map(v => Math.max(0,parseNumber(v,key)));
      if (![1,2,4].includes(p.length)) throw new Error("padding takes one, two or four numbers");
      return {...layout, padding: Object.freeze([p[0],p[1] ?? p[0],p[2] ?? p[0],p[3] ?? p[1] ?? p[0]] as const)};
    }
    case "paddingTop": case "paddingRight": case "paddingBottom": case "paddingLeft":
    case "paddingHorizontal": case "paddingVertical": {
      const p: [number,number,number,number] = [...layout.padding], v = Math.max(0,num());
      if (key === "paddingHorizontal") p[1] = p[3] = v;
      else if (key === "paddingVertical") p[0] = p[2] = v;
      else p[["paddingTop","paddingRight","paddingBottom","paddingLeft"].indexOf(key)] = v;
      return {...layout, padding: Object.freeze(p)};
    }
    case "mainAlign": case "primaryAxisAlignItems": return {...layout, mainAlign: propertyEnum(raw, ["min","center","max","spaceBetween","spaceAround","spaceEvenly"] as const)};
    case "crossAlign": case "counterAxisAlignItems": return {...layout, crossAlign: propertyEnum(raw, ["min","center","max","baseline"] as const)};
    case "contentAlign": case "counterAxisAlignContent": return {...layout, contentAlign: propertyEnum(raw, ["auto","spaceBetween"] as const)};
    case "wrap": case "strokesIncluded": case "reverseZ":
      if (typeof raw !== "boolean") throw new Error(key+" must be boolean");
      return {...layout, [key]: raw};
    case "gridColumns": case "gridRows": {
      const count = Math.max(1,Math.trunc(clamp(num(),1000))), tracks = key === "gridColumns" ? "columnTracks" : "rowTracks";
      return {...layout, [key]:count, [tracks]:Object.freeze(layout[tracks].slice(0,count))};
    }
    case "columnTracks": case "gridColumnTracks": case "rowTracks": case "gridRowTracks": {
      if (!Array.isArray(raw)) throw new Error(key+" must be an array of tracks");
      const tracks = Object.freeze(raw.map(commandTrack)), count = Math.min(1000,Math.max(1,tracks.length));
      return key.toLowerCase().includes("column") ? {...layout, columnTracks:tracks, gridColumns:count} : {...layout, rowTracks:tracks, gridRows:count};
    }
    default: throw new Error("Unknown layout property "+key);
  }
}

export function setFrameLayout(node: LayerNode, props: Record<string,unknown>, tuning: readonly string[], skipTuning: boolean): LayerNode {
  const modes = ["layout","layoutMode"].filter(k => Object.hasOwn(props,k));
  const keys = skipTuning ? [] : tuning;
  if (!modes.length && !keys.length) return node;
  if (node.kind !== "frame") throw new Error("Auto layout needs a frame");
  const off = modes.find(k => props[k] === null || typeof props[k] === "string" && props[k].toLowerCase() === "none");
  if (off && keys.length) {
    const description = keys.length === 1 ? "is an auto layout property" : "are auto layout properties";
    throw new Error(keys.map(k => "`"+k+"`").join(", ")+" "+description+", and `"+off+"` in the same call turns auto layout off");
  }
  let layout: FrameNode["layout"] = node.layout;
  for (const k of modes) layout = commandMode(layout,props[k]);
  for (const k of keys) layout = tune(layout ?? defaultContainer,k,props[k]);
  if (sameAutoLayout(layout, node.layout)) return node;
  if (layout) return Object.freeze({...node,layout:Object.freeze(layout)});
  const {layout: previous, ...rest} = node;
  return Object.freeze(rest);
}
