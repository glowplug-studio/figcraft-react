import { requiredTargets } from "./arrange";
import type { Document } from "./document";
import { exportSize, type ExportSize } from "./export-area";
import { HierarchyDraft } from "./hierarchy";
import { parseBoolean, parseIndex, parseNumber, parseString } from "./parameters";

export type ExportFormat = "png" | "jpg" | "webp" | "svg" | "pdf" | "vectorDrawable";
export type ExportProfile = "sameAsFile" | "srgb" | "displayP3";
export interface PrintSettings { bleed: number; cropMarks: boolean; bleedMarks: boolean; cmyk: boolean }
export interface ExportSetting {
  size: ExportSize;
  suffix: string;
  format: ExportFormat;
  print?: PrintSettings;
  contentsOnly?: boolean;
  includeBoundingBox?: boolean;
  svgOutlineText?: boolean;
  svgIdAttribute?: boolean;
  svgSimplifyStroke?: boolean;
  vdCompat?: "bestEffort" | "exact" | "ignore";
  colorProfile?: ExportProfile;
  quality?: number;
}
export const exportSpecs = {
  "export.add": { label: "Add export setting", undo: true },
  "export.update": { label: "Edit export setting", undo: true },
  "export.remove": { label: "Remove export setting", undo: true },
} as const;

const flags = { contentsOnly: true, includeBoundingBox: false, svgOutlineText: true, svgIdAttribute: false, svgSimplifyStroke: true } as const;
const printFlags = ["cropMarks", "bleedMarks", "cmyk"] as const;
const defaultPrint: PrintSettings = { bleed: 0, cropMarks: false, bleedMarks: false, cmyk: false };
const formats = ["png", "jpg", "webp", "svg", "pdf", "vectorDrawable"] as const;
const profiles = ["sameAsFile", "srgb", "displayP3"] as const;
const modes = ["bestEffort", "exact", "ignore"] as const;
const defaultSetting = (): ExportSetting => ({ format: "png", suffix: "", size: { by: "scale", value: 1 } });
const record = (input: unknown): input is Record<string, unknown> => !!input && typeof input === "object" && !Array.isArray(input);
function choice<T extends string>(v: unknown, choices: readonly T[], error: string): T {
  const result = choices.find(choice => choice === v);
  if (result === undefined) throw new Error(error);
  return result;
}
function bool(value: unknown, key: string, wire: boolean) {
  const result = wire ? (typeof value === "boolean" ? value : undefined) : parseBoolean(value);
  if (result === undefined) throw new Error(key + ": true or false");
  return result;
}

function bleedPoints(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value !== "string") return NaN;
  const match = /^([-+.\de]+)\s*(pt|px|mm|cm|in|")?$/i.exec(value.trim());
  if (!match) return NaN;
  const unit = match[2]?.toLowerCase();
  return Number(match[1]) * (unit === "mm" ? 72 / 25.4 : unit === "cm" ? 72 / 2.54 : unit === "in" || unit === '"' ? 72 : 1);
}

function parseSetting(base: ExportSetting, p: Record<string, unknown>, wire: boolean): ExportSetting {
  const e = { ...base };
  const has = (key: string) => wire ? Object.hasOwn(p, key) : p[key] != null;
  if (has("size")) {
    if (wire) {
      const size = p.size;
      if (!record(size) || typeof size.value !== "number" || !Number.isFinite(size.value)) throw new Error("exports: invalid size");
      e.size = { by: choice(size.by, ["scale","height","width"], "exports: invalid size unit"), value: size.value };
    } else e.size = exportSize(p.size);
  }
  if (has("suffix")) {
    if (wire && typeof p.suffix !== "string") throw new Error("exports: invalid suffix");
    const suffix = parseString(p.suffix);
    if (suffix !== undefined) e.suffix = wire ? suffix : Array.from(suffix.replace(/\p{Cc}/gu, "")).slice(0, 200).join("");
  }
  if (has("format")) {
    const alias = parseString(p.format)?.toLowerCase().replace(/^\.+/, "");
    if (wire || alias !== undefined) e.format = choice(wire ? p.format :
      alias === "jpeg" ? "jpg" : ["xml","vd","vectordrawable"].includes(alias!) ? "vectorDrawable" : alias, formats, "format: png|jpg|svg|pdf|webp|xml");
  }
  if (has("vdCompat")) e.vdCompat = choice(p.vdCompat, modes, "vdCompat: bestEffort|exact|ignore");
  if (has("colorProfile")) e.colorProfile = choice(p.colorProfile, profiles, "colorProfile: sameAsFile|srgb|displayP3");
  if (Object.hasOwn(p, "quality")) {
    let quality = typeof p.quality === "number" ? p.quality : NaN;
    if (!wire && typeof p.quality === "string") {
      try { quality = parseNumber(p.quality); } catch { /* The same native range error covers invalid text. */ }
    }
    if (!Number.isInteger(quality) || quality < (wire ? 0 : 1) || quality > (wire ? 255 : 100)) throw new Error("quality: a whole number from 1 to 100 (JPG)");
    e.quality = quality;
  }
  const print = { ...(e.print ?? defaultPrint) };
  if (wire && has("print") && !record(p.print)) throw new Error("exports: invalid print options");
  const options = wire ? (record(p.print) ? p.print : {}) : p;
  if (wire ? Object.hasOwn(options,"bleed") : options.bleed != null) {
    const bleed = wire ? options.bleed : bleedPoints(options.bleed);
    if (typeof bleed !== "number" || !Number.isFinite(bleed) || !wire && (bleed < 0 || bleed > 144)) {
      throw new Error('bleed: points, or a length like "3mm" or "0.125in" (up to 144 pt, 2 in)');
    }
    print.bleed = bleed;
  }
  for (const key of printFlags) {
    if (wire ? Object.hasOwn(options,key) : options[key] != null) print[key] = bool(options[key],key,wire);
  }
  if (print.bleed || printFlags.some(key => print[key])) e.print = Object.freeze(print);
  else delete e.print;
  for (const key of Object.keys(flags) as (keyof typeof flags)[]) {
    if (has(key)) e[key] = bool(p[key],key,wire);
    if (e[key] === flags[key]) delete e[key];
  }
  if (e.quality === 90) delete e.quality;
  if (e.vdCompat === "bestEffort") delete e.vdCompat;
  if (e.colorProfile === "sameAsFile") delete e.colorProfile;
  Object.freeze(e.size);
  return Object.freeze(e);
}

export function fileExportSetting(params: Record<string,unknown>) {
  return parseSetting(defaultSetting(), params, false);
}

/** Only the shared print, compatibility and profile options override saved settings. */
export function batchExportOptions(p: Record<string, unknown>) {
  const keys = ["bleed", "cropMarks", "bleedMarks", "cmyk", "vdCompat", "colorProfile"];
  const params = Object.fromEntries(keys.filter(key => p[key] != null).map(key => [key,p[key]]));
  parseSetting(defaultSetting(), params, false);
  return params;
}

// Native node.set applies snake() before deserialising camel-case export records.
// Archive reads go directly through serde and retain all saved options.
export function readExportSettings(input: unknown, property = false): readonly ExportSetting[] {
  if (!Array.isArray(input)) throw new Error("exports: expected a sequence");
  function propertyKeys(obj: Record<string,unknown>) {
    return Object.fromEntries(Object.entries(obj).filter(([key]) => !/[A-Z]/.test(key)));
  }
  return Object.freeze(input.map(raw => {
    if (!record(raw)) throw new Error("exports: invalid export setting");
    const p = property ? propertyKeys(raw) : raw;
    if (property && record(p.print)) p.print = propertyKeys(p.print);
    return parseSetting(defaultSetting(), p, true);
  }));
}

function nextSetting(previous?: ExportSetting): ExportSetting {
  const e = defaultSetting();
  if (previous?.size.by === "scale") {
    const value = Math.min(64, Math.floor(previous.size.value) + 1);
    e.size = { by: "scale", value };
    e.suffix = "@" + value + "x";
  }
  Object.freeze(e.size);
  return Object.freeze(e);
}

export function editExportSettings(doc: Document, selection: readonly string[], command: string, p: Record<string, unknown>) {
  const index = command === "export.add" ? 0 : parseIndex(p.index);
  const given = command === "export.add" && p.setting != null ? parseSetting(defaultSetting(), record(p.setting) ? p.setting : {}, false) : undefined;
  if (command === "export.update") parseSetting(defaultSetting(), p, false);
  const draft = new HierarchyDraft(doc);
  for (const id of requiredTargets(doc, selection, p)) {
    const node = draft.nodes[id], entries = [...(node.exports ?? [])];
    if (command === "export.add") entries.push(given ?? nextSetting(entries.at(-1)));
    else if (index >= entries.length) continue;
    else if (command === "export.remove") entries.splice(index, 1);
    else entries[index] = parseSetting(entries[index], p, false);
    const { exports: previous, ...rest } = node;
    draft.set(entries.length ? { ...rest, exports: Object.freeze(entries) } : rest);
  }
  return draft.finish();
}
