import { identity, inverse, multiply, type Affine } from "../../affine";
import { withAlpha, type Colour } from "../../colour";
import { isLeaf, isFrameLike, withMaskProperties, type DocumentNode, type LayerNode } from "../../document";
import { readNode, type DecodedFigcraft } from "../../file-format";
import { wireId } from "../../native-values";
import { solidPaint } from "../../solid-paint";
import { type SharedStyle } from "../../shared-styles";
import { children, object, string, type JsonObject } from "../rest/values";
import { componentDefinitions,linkComponents,rebaseCopies,designSystemWarnings } from "./components";
import { keepInteractions,resolvePrototypes } from "./prototype";
import { typography, missingFonts } from "./fonts";
import { fontRefs, textLayer } from "./text";
import { autoLayout, cells, childLayout, finishLayout, layoutFingerprint } from "./layout";
import { wireVectorNetwork } from "../../vector-codec";
import { vector } from "./path";
import { displayGrids } from "./grids";
import { PenpotMedia } from "./media";
import { RawSvgLayers } from "./raw-svg";
import { bindTokens } from "./bindings";
import { PenpotTokens, variableFingerprint } from "./tokens";
import { SvgPaintServers, svgFillSource } from "./svg-paint";
import { appearance, paints } from "./appearance";
import { PenpotArchive, isUuid, penpotError, rootId } from "./archive";
import { clipped, guides, hex, keepSource, numberField as num, records } from "./values";

const sourceFields = ["layout", "layoutMode", "layoutFlexDir", "layoutWrapType", "layoutGap", "layoutPadding", "layoutJustifyContent", "layoutAlignItems",
  "layoutAlignContent", "layoutGridColumns", "layoutGridRows", "layoutGridCells", "layoutItemMargin", "layoutItemAlignSelf", "layoutItemAbsolute",
  "layoutItemHSizing", "layoutItemVSizing", "touched", "appliedTokens", "interactions", "variantProperties", "pluginData", "grids", "guides", "maskType",
  "svgAttrs", "svgViewbox", "svgDefs", "layoutGapType", "layoutPaddingType", "layoutJustifyItems", "layoutGridDir", "componentRoot", "mainInstance",
  "layoutItemZIndex", "exports", "hideInViewer", "strokes"];
const fileFields = ["features", "version", "migrations", "options", "isShared", "createdAt", "modifiedAt"];

function matrix(v: JsonObject, x: number, y: number, w: number, h: number): Affine {
  const t = object(v.transform), snap = (n: number) => Math.abs(n - Math.round(n)) < 1e-5 ? Math.round(n) : n;
  let a = snap(num(t, "a", 1)), b = snap(num(t, "b", 0)), c = snap(num(t, "c", 0)), d = snap(num(t, "d", 1));
  if (!Object.hasOwn(v, "transform") || Math.abs(a * d - b * c) <= 1e-9) {
    const angle = -num(v, "rotation", 0) * Math.PI / 180, cosine = Math.cos(angle), sine = Math.sin(angle);
    const fx = v.flipX === true ? -1 : 1, fy = v.flipY === true ? -1 : 1;
    a = cosine * fx; b = sine * fx; c = -sine * fy; d = cosine * fy;
  }
  return multiply(multiply([1, 0, 0, 1, x + w / 2, y + h / 2], [a,b,c,d,0,0]), [1,0,0,1,-w/2,-h/2]);
}

function kind(layer: JsonObject, warn: (message: string) => void) {
  switch (layer.type) {
    case "frame": return {type: layer.isVariantContainer === true ? "componentSet" : "frame", clip: layer.showContent !== true};
    case "group": return {type: "group"};
    case "bool": return {type: "booleanOp", op: layer.boolType === "difference" ? "subtract" : layer.boolType === "intersection" ? "intersect" :
      layer.boolType === "exclude" || layer.boolType === "exclusion" ? "exclude" : "union"};
    case "rect": case "image": return {type: "rectangle"};
    case "circle": case "ellipse": return {type: "ellipse", start: 0, sweep: 2 * Math.PI, inner: 0};
    case "svg-raw": return {type: "frame"};
    case "path": return {type: "vector"};
    case "text": return {type:"text"};
    default: warn("Unsupported Penpot layer type '" + (string(layer.type) ?? "") + "': imported as frame"); return {type: "frame"};
  }
}

async function swatches(archive: PenpotArchive, base: string, palette: Colour[], styles: SharedStyle[], warn: (reason: string) => void) {
  const dir = base + "/colors/";
  let count = 0;
  for (const path of archive.names()) {
    if (!path.startsWith(dir) || !path.endsWith(".json") || !isUuid(path.slice(dir.length, -5))) continue;
    if (++count > 2048) {warn("Penpot color library exceeds 2048 swatches; truncated"); break;}
    let value;
    try { value = object(await archive.json(path)); } catch { archive.check(); continue; }
    const color = hex(value.color);
    if (!color) {
      if ("gradient" in value || "image" in value) warn("Gradient/image library swatches kept on imported shapes; not added to the solid color palette");
      continue;
    }
    const c = withAlpha(color, color.a * num(value, "opacity", 1, 0, 1));
    if (!palette.some(p => p.r === c.r && p.g === c.g && p.b === c.b && p.a === c.a)) palette.push(c);
    if (isUuid(value.id) && typeof value.name === "string" && styles.length < 8192)
      styles.push({type: "paint", id: "penpot:color:" + base + ":" + value.id, name: clipped((value.path ? value.path + "/" : "") + value.name, 256),
        description: "Imported from Penpot color library", paints: [solidPaint(c)]});
  }
}

export async function penpotScene(archive: PenpotArchive): Promise<DecodedFigcraft> {
  const files = await archive.manifest();
  const warnings = new Set<string>();
  const warn = (message: string) => { if (warnings.size < 100) warnings.add(message); };
  const font = await archive.fontWarning();
  if (font) warn(font);
  const name = clipped(string(files[0].name) ?? "Penpot import", 256);
  const nodes: Record<string, DocumentNode> = Object.create(null), pages: string[] = [];
  const palette: Colour[] = [], styles: SharedStyle[] = [];
  const media = new PenpotMedia(archive);
  const tokens = new PenpotTokens();
  const rawSvg = new RawSvgLayers(archive);
  let next = 1, total = 0, lastYield = performance.now();
  for (const file of files) {
    if (!isUuid(file.id)) throw penpotError("invalid file UUID");
    const base = "files/" + file.id;
    const masters = await componentDefinitions(archive,base);
    let header: JsonObject | undefined;
    try { header = object(await archive.json(base + ".json")); } catch { archive.check(); }
    await swatches(archive, base, palette, styles, warn);
    const libraryFonts = await typography(archive, base, styles, warn);
    await tokens.read(archive,base,file.id,styles,warn);
    let savedFontRefs = false;
    for (const page of await archive.pages(file)) {
      const pageId = String(next++), shapes = await archive.shapes(file.id, page);
      const source = shapes.get(rootId)!;
      const paintServers = new SvgPaintServers(shapes);
      const pageMeta: Record<string, string> = {"penpot.fileId": file.id, "penpot.pageId": page.id};
      if (header) {
        const kept = archive.numbers.pick(header, fileFields);
        keepSource(pageMeta, "penpot.source.file", kept, archive.numbers);
        header = undefined;
      }
      if (!savedFontRefs && libraryFonts.length) {
        pageMeta["penpot.customLibraryFontRefs"] = JSON.stringify(libraryFonts); savedFontRefs = true;
      }
      keepSource(pageMeta, "penpot.flows", page.data.flows, archive.numbers);
      const bg = records(source.fills).map(f => hex(f.fillColor)).find(Boolean) ?? hex(page.data.background) ?? "#f5f5f5";
      const childIds = new Map<string, string[]>(), byParent = new Map<string, string[]>();
      const ordered = [...shapes.keys()].sort(), seen = new Set<string>();
      for (const id of ordered) {
        const pid = shapes.get(id)!.parentId;
        if (id === rootId || !isUuid(pid)) continue;
        let kids = byParent.get(pid);
        if (!kids) byParent.set(pid, kids = []);
        kids.push(id);
      }
      childIds.set(pageId, []);
      nodes[pageId] = readNode(pageId, {id: wireId(pageId), type: "page", name: page.name, width: 0, height: 0, background: bg,
        plugin_data: pageMeta, guides: guides(Object.hasOwn(page.data, "guides") ? page.data.guides : object(page.data.options).guides)});
      pages.push(pageId);
      async function add(id: string, parent: string, parentTransform: Affine, depth: number, cell?: JsonObject): Promise<void> {
        if ((total & 63) === 0 && performance.now() - lastYield > 12) {
          await new Promise<void>(resolve => setTimeout(resolve, 0)); archive.check(); lastYield = performance.now();
        }
        if (depth >= 128) {warn("Penpot layer nesting deeper than 128 was omitted");return;}
        if (seen.has(id)) return;
        seen.add(id);
        const raw = shapes.get(id);
        if (!raw) {warn("Missing layer " + id); return;}
        if (++total > 50_000) throw penpotError("too many layers");
        const label = clipped(string(raw.name) ?? "Layer", 512);
        if (isLeaf(nodes[parent])) throw penpotError("layer '" + label + "': " + parent + " can't contain children");
        const geometry = (key: string, fallback: number) => num(raw[key] == null ? object(raw.selrect) : raw, key, fallback);
        const x = geometry("x", 0), y = geometry("y", 0), width = Math.max(0.01, geometry("width", 1)), height = Math.max(0.01, geometry("height", 1));
        const master = masters.get(id);
        const layer = master && raw.type==="frame" ? {type:"component",clip:raw.showContent!==true} : kind(raw, warn);
        let absolute: Affine = layer.type === "group" || layer.type === "booleanOp" ? [1,0,0,1,x,y] : matrix(raw,x,y,width,height);
        const key = String(next++), meta: Record<string, string> = {"penpot.fileId": String(file.id), "penpot.id": id};
        for (const field of sourceFields) keepSource(meta, "penpot.source." + field, raw[field], archive.numbers, 16384, raw, field);
        for (const field of ["componentId", "componentFile", "shapeRef", "variantId"]) {
          const value = string(raw[field]);
          if (value !== undefined && new TextEncoder().encode(value).length <= 1024) meta["penpot." + field] = value;
        }
        if (master) {
          meta["penpot.componentMasterId"] = master.id;
          if (master.source && layer.type==="component") meta["penpot.source.component"]=master.source;
        }
        if (master && master.name && layer.type==="component" && nodes[parent].kind==="componentSet") meta["penpot.originalName"]=label;
        if (!master && Object.hasOwn(raw, "componentId")) meta["penpot.componentLinkStatus"] = "not-linked";
        keepInteractions(raw,meta,archive.numbers,warn);
        const child = childLayout(raw, cell, meta);
        const look = await appearance(raw, meta, warn, media, base);
        let w = width, h = height, shape: Record<string, unknown> = layer;
        const path = layer.type === "vector" ? vector(raw, absolute, x, y, warn) : undefined;
        if (path?.bounds) {
          w = Math.max(0.01, path.bounds.width); h = Math.max(0.01, path.bounds.height); absolute = path.transform!;
        }
        let fills: readonly unknown[] = look.fills;
        if (["rect", "circle", "path", "bool"].includes(String(raw.type))) {
          const svg = svgFillSource(raw, shapes);
          if (svg.fills) fills = await paints({fills:svg.fills},false,warn,media,base);
          if (!fills.length && svg.reference) {
            const gradient = paintServers.resolve(svg.reference,raw,absolute,x,y,w,h);
            if (gradient) fills = [{type:"gradient",...gradient,visible:true,opacity:1,blend:"normal"}];
            else warn("Penpot SVG paint-server url(#" + svg.reference + ") cannot be represented as a native gradient; original SVG attributes retained");
          }
        }
        if (layer.type === "vector") shape = path ? {...layer, network:wireVectorNetwork(path.network(fills.length>0))} : {type:"frame"};
        if (raw.type === "svg-raw") rawSvg.keep(raw,label,w,h,meta,warn);
        if (raw.type === "text") {
          const text = textLayer(raw,look.fills);
          shape = {...layer,...text.wire};
          for (const field of ["content","positionData"]) keepSource(meta,"penpot.source."+field,raw[field],archive.numbers,256*1024,raw,field);
          for (const [prefix,key] of [["gfont-","googleFontRefs"],["custom-","customFontRefs"]]) {
            const refs=fontRefs(raw,prefix);
            if (refs.length) meta["penpot."+key]=JSON.stringify(refs);
          }
          if (meta["penpot.source.content"] !== undefined) meta["penpot.fp.text"]=text.hash;
          shape.fills=text.fills;
        }
        if (layer.type === "vector" && shape.type !== "vector" && !records(raw.strokes).length) shape.stroke = undefined;
        nodes[key] = readNode(key, {id: wireId(key), parent: wireId(parent), name: meta["penpot.originalName"]!==undefined ? master!.name : label, child_layout: child, ...look, fills, ...shape,
          width: w, height: h, transform: multiply(inverse(parentTransform), absolute), plugin_data: meta,
          ...(["frame", "component", "componentSet", "instance"].includes(layer.type) && {guides: guides(raw.guides), grids: displayGrids(raw.grids, warn)})});
        childIds.get(parent)!.push(key);
        childIds.set(key, []);
        let layout = autoLayout(raw, warn);
        const node = nodes[key] as LayerNode;
        if (!isFrameLike(node) && (Object.hasOwn(raw,"layout") || Object.hasOwn(raw,"layoutMode"))) {
          warn("Layout on non-frame-like Penpot layer retained as metadata"); layout = undefined;
        }
        const grid = cells(raw), declared = children(raw.shapes).filter((id): id is string => typeof id === "string");
        const order = layout?.reverseZ ? [...declared].reverse() : declared;
        for (const child of order) await add(child, key, absolute, depth + 1, grid.get(child));
        for (const child of byParent.get(id) ?? []) if (!seen.has(child)) {
          warn("Penpot group omitted a child from its stacking list; recovered it by parentId"); await add(child, key, absolute, depth + 1);
        }
        const kids = childIds.get(key)!;
        const final = finishLayout(node, layout, kids.map(id=>nodes[id] as LayerNode), raw, warn);
        if (isFrameLike(node) && final) nodes[key] = Object.freeze({...node,layout:final});
        if (raw.maskedGroup === true) {
          const mask = kids.find(k=>declared[0] && nodes[k].sourceMetadata?.["penpot.id"] === declared[0]);
          if (!mask) warn("Penpot masked group has no first layer to use as its mask; original group preserved");
          else {
            for (const k of kids) nodes[k] = withMaskProperties(nodes[k],k===mask);
            kids.splice(kids.indexOf(mask),1); kids.unshift(mask); meta["penpot.maskImported"]="true";
          }
        }
        if (meta["penpot.source.layout"] !== undefined)
          meta["penpot.fp.layout"] = layoutFingerprint(nodes[key] as LayerNode,kids.map(k=>nodes[k] as LayerNode));
        if (meta["penpot.fp.layout"] || meta["penpot.maskImported"]) nodes[key] = Object.freeze({...nodes[key],sourceMetadata:Object.freeze(meta)});
      }
      for (const id of children(source.shapes)) if (typeof id === "string") await add(id, pageId, identity, 0);
      for (const id of byParent.get(rootId) ?? []) if (!seen.has(id)) {
        warn("Penpot page omitted a top-level child from its stacking list; recovered it by parentId"); await add(id, pageId, identity, 0);
      }
      for (const id of ordered) {
        if (id === rootId || seen.has(id)) continue;
        const shape = shapes.get(id)!, parent = string(shape.parentId);
        if (parent !== undefined && parent !== id && shapes.has(parent)) continue;
        warn("Penpot orphan layer '" + clipped(string(shape.name) ?? id, 80) + "' has no reachable parent; attached to page");
        await add(id, pageId, identity, 0);
      }
      for (const id of ordered) if (id !== rootId && !seen.has(id)) {
        warn("Penpot disconnected/cyclic layer graph at " + id + "; recovered as a page layer"); await add(id, pageId, identity, 0);
      }
      for (const [id, list] of childIds) if (list.length) nodes[id] = Object.freeze({...nodes[id], children: Object.freeze(list)}) as DocumentNode;
    }
  }
  if (!pages.length) throw penpotError("no pages found");
  const variables = tokens.data();
  if (Object.keys(tokens.sources).length) {
    const first = nodes[pages[0]];
    nodes[first.id] = {...first,sourceMetadata:{...first.sourceMetadata,...tokens.sources,"penpot.fp.tokens":variableFingerprint(variables)}};
  }
  if (Object.keys(tokens.modes).length) for (const id of pages) nodes[id]={...nodes[id],variableModes:{...tokens.modes}};
  const doc = {name,pages,currentPage:pages[0],nodes};
  linkComponents(doc,nodes,warn);
  bindTokens(variables,tokens.modes,nodes,warn);
  resolvePrototypes(nodes,pages,warn);
  const unsupported = Object.values(nodes).filter(n=>n.sourceMetadata?.["penpot.unsupported.alignSelf"]);
  if (unsupported.length) {
    const names = unsupported.slice(0,3).map(n=>"'" + clipped(n.name.replace(/\p{Cc}/gu,""),80) + "'").join(", ");
    warn("Penpot: " + unsupported.length + " layer(s) use unsupported unrecognized per-element alignment; original values are preserved in layer metadata, but may change visually after auto-layout edits. Example(s): " + names);
  }
  designSystemWarnings(nodes,warn);
  next = await rawSvg.expand(nodes,next,media.resources,warn);
  const missing = await missingFonts(nodes);
  archive.check();
  return {document: rebaseCopies(Object.freeze({name, pages: Object.freeze(pages), currentPage: pages[0], nodes: Object.freeze(nodes),
    ...(variables.variables.length && {variables}),
    ...(Object.keys(media.resources).length && {images: Object.freeze(media.resources)}),
    ...(palette.length && {documentColours: Object.freeze(palette)}), ...(styles.length && {styles: Object.freeze(styles)})})),
    nextId: String(next), issues: [...(missing ? [missing] : []), ...warnings]};
}
