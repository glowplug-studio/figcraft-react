import { type Document, pageOf } from "./document";
import { pageForNode, rootIds, zSorted } from "./hierarchy";
import { parseBoolean, parseNodeId, parseNumber } from "./parameters";
import { worldRenderBounds } from "./render-bounds";
import { boundsOf } from "./viewport";
import type { Rectangle } from "./geometry";
import type { ColourProfile } from "./colour-spaces";

export type ExportSize = { by: "scale" | "width" | "height"; value: number };

export function exportSize(input: unknown): ExportSize {
  let by: unknown = "scale", value: unknown = input;
  if (typeof input === "string") {
    const match = /^@*([+\-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+\-]?\d+)?)\s*([xwh]?)$/i.exec(input.trim());
    value = match ? Number(match[1]) : 0;
    const unit = match?.[2].toLowerCase();
    by = unit === "w" ? "width" : unit === "h" ? "height" : "scale";
  } else if (input && typeof input === "object" && !Array.isArray(input)) {
    ({ by, value } = input as Record<string, unknown>);
  }
  if ((by !== "scale" && by !== "width" && by !== "height") || typeof value !== "number"
    || !Number.isFinite(value) || value <= 0 || value > (by === "scale" ? 64 : 16384)) {
    throw new Error("size: 2x, 512w or 512h (or {by: scale|width|height, value})");
  }
  return { by, value };
}

function flag(p: Record<string, unknown>, key: string, fallback: boolean) {
  if (p[key] == null) return fallback;
  const value = parseBoolean(p[key]);
  if (value === undefined) throw new Error(key + ": true or false");
  return value;
}

export function rasterExportPlan(doc: Document, selection: readonly string[], p: Record<string, unknown>, savedSize?: ExportSize) {
  const currentPage = pageOf(doc);
  const id = parseNodeId(p.id);
  const requested = Array.isArray(p.ids) ? p.ids.flatMap(value => parseNodeId(value) ?? []) : id ? [id] : selection;
  const ids = requested.length ? requested : currentPage.children;
  const profile: unknown = p.colorProfile == null || p.colorProfile === "sameAsFile" ? doc.colourProfile ?? "srgb" : p.colorProfile;
  if (profile !== "srgb" && profile !== "displayP3") throw new Error("colorProfile: sameAsFile|srgb|displayP3");
  const quality = p.quality === undefined ? 90 : typeof p.quality === "boolean" ? NaN : parseNumber(p.quality, "quality");
  if (!Number.isInteger(quality) || quality < 1 || quality > 100) throw new Error("quality: a whole number from 1 to 100 (JPG)");
  const size = savedSize ?? (p.size == null ? undefined : exportSize(p.size));
  const contentsOnly = flag(p, "contentsOnly", true), boundingBox = flag(p, "includeBoundingBox", false);
  const layers = ids.filter(id => doc.nodes[id]);
  const anyVisible = layers.some(id => { const n = doc.nodes[id]; return n.kind === "page" || n.visible !== false; });
  let area: Rectangle | undefined;
  for (const id of layers) {
    const n = doc.nodes[id];
    if (!boundingBox && anyVisible && n.kind !== "page" && n.visible === false) continue;
    const box = boundingBox || n.kind === "page" ? boundsOf(doc, [id]) : worldRenderBounds(doc, id);
    if (!box) continue;
    if (!area) area = box;
    else {
      const right = Math.max(area.x + area.width, box.x + box.width), bottom = Math.max(area.y + area.height, box.y + box.height);
      const x = Math.min(area.x, box.x), y = Math.min(area.y, box.y);
      area = { x, y, width: right - x, height: bottom - y };
    }
  }
  if (!area || !layers.length) throw new Error("nothing to export");
  const pageId = pageForNode(doc, layers[0]), page = pageId ? doc.nodes[pageId] : undefined;
  const parentPage = page?.kind === "page" ? page : currentPage;
  const drawn = contentsOnly ? zSorted(doc, rootIds(doc, layers)) : parentPage.children;
  let scale: number;
  if (!size) scale = Math.max(0.01, Math.min(64, p.scale == null ? 1 : parseNumber(p.scale)));
  else if (size.by === "scale") scale = size.value;
  else {
    const span = area[size.by];
    scale = span > 0 ? Math.min(64, size.value / span) : 1;
  }
  if (size) scale = Number.isFinite(scale) && scale > 0 ? Math.min(scale,64) : 1;
  const width = Math.max(1, Math.ceil(area.width * scale - 1e-6)), height = Math.max(1, Math.ceil(area.height * scale - 1e-6));
  if (width > 16384 || height > 16384 || !Object.values(area).every(Number.isFinite)) throw new Error("render failed (empty or too large)");
  return { area, drawn, scale, width, height, profile: profile as ColourProfile, quality };
}
