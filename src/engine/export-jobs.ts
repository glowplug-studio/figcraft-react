import { isLeaf, type Document, type LayerNode } from "./document";
import { subtreeIds } from "./hierarchy";
import { parseBoolean, parseNodeId } from "./parameters";
import type { ExportSetting } from "./export-settings";

export interface ExportJob { id: string; name: string; setting: ExportSetting }
export function sizeLabel(size: ExportSetting["size"]) {
  return String(size.value) + ({scale:"x",width:"w",height:"h"} as const)[size.by];
}
const isRaster = (format: ExportSetting["format"]) => format === "png" || format === "webp" || format === "jpg";
function safeName(name: string) {
  return Array.from(name).slice(0,200).join("").replace(/[\p{Cc}/\\:*?"<>|]/gu, "_");
}
function exportPath(name: string) {
  return name.split("/").map(s => safeName(s).trim().replace(/\.+$/,"")).filter(Boolean).slice(0,32).join("/") || "Untitled";
}

function isIcon(doc: Document, root: LayerNode) {
  if (root.width > 128 || root.height > 128) return false;
  let paths = false;
  function vectorOnly(id: string, depth: number): boolean {
    const node = doc.nodes[id];
    if (!node || node.kind === "page") return false;
    if (node.visible === false) return true;
    if ([...(node.fills ?? []), ...(node.strokes ?? [])].some(p => p.type === "image" || p.type === "pattern")) return false;
    switch (node.kind) {
      case "line": case "vector": case "booleanOp": case "polygon": case "star": paths = true; return true;
      case "rectangle": case "ellipse": return true;
      case "group": case "component": case "instance": case "frame":
        return depth < 16 && node.children.length > 0 && node.children.every(child => vectorOnly(child,depth + 1));
      default: return false;
    }
  }
  return vectorOnly(root.id,0) && paths;
}

function inspectAssets(doc: Document, ids: readonly string[]) {
  const stack = [...ids].reverse(), found = new Map<string,readonly ExportSetting[]>();
  for (let visited = 0; stack.length && found.size < 200 && visited < 20_000; visited++) {
    const id = stack.pop()!, n = doc.nodes[id];
    if (!n || n.kind !== "page" && n.visible === false) continue;
    if (n.kind !== "page") {
      let settings = n.exports;
      const icon = !settings?.length && isIcon(doc,n);
      if (icon || !settings?.length && n.fills?.some(p => p.type === "image" && p.visible)) {
        settings = [{size:{by:"scale",value:1},suffix:"",format:icon ? "svg" : "png"}];
      }
      if (settings?.length && !found.has(id)) found.set(id,settings);
      if (icon) continue;
    }
    if (!isLeaf(n)) for (let i = n.children.length - 1; i >= 0; i--) stack.push(n.children[i]);
  }
  return found;
}

export function layerExportJobs(doc: Document, selection: readonly string[], params: Record<string,unknown>) {
  const assets = parseBoolean(params.assets) ?? false, single = parseNodeId(params.id);
  let ids = Array.isArray(params.ids) ? params.ids.flatMap(v => parseNodeId(v) ?? []) : single ? [single] : selection;
  if (!ids.length) ids = assets ? [doc.currentPage] : subtreeIds(doc,doc.currentPage).slice(1).filter(id => doc.nodes[id].exports?.length);
  const items = assets ? inspectAssets(doc,ids) : ids.map(id => [id,doc.nodes[id]?.exports ?? []] as const);
  const jobs: ExportJob[] = [], used = new Set<string>(), layers = new Set<string>();
  for (const [id, settings] of items) {
    if (!settings.length) continue;
    const base = exportPath(doc.nodes[id].name);
    for (const setting of settings) {
      const {size, format} = setting;
      const suffix = setting.suffix || (isRaster(format) && size.by === "scale" && Math.abs(size.value-1)>1e-9 ? "@" + sizeLabel(size) : "");
      const stem = base + safeName(suffix), extension = format === "vectorDrawable" ? "xml" : format;
      let name = stem + "." + extension;
      for (let count=2; used.has(name.toLowerCase()); count++) name = stem + " " + count + "." + extension;
      jobs.push({id, name, setting}); used.add(name.toLowerCase()); layers.add(id);
      if (jobs.length === 1000) break;
    }
    if (jobs.length === 1000) break;
  }
  return { jobs, skipped: Math.max(0,ids.length - layers.size) };
}
