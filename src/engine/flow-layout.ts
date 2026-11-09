import { layerSizing, type AutoLayout } from "./auto-layout";
import { resizeChildren } from "./constraints";
import { isFrameLike, layerTransform, type Document, type FrameLikeNode, type LayerNode, type NodeId } from "./document";
import type { HierarchyDraft } from "./hierarchy";
import { clampSize, frameInsets, outerBox, placeLayer, size } from "./layout-geometry";
import { textNodeLayout } from "./text-node-layout";

interface Item {
  id: NodeId; main: number; cross: number; fillMain: boolean; fillCross: boolean;
  minMain?: number; maxMain?: number; minCross?: number; maxCross?: number;
  inset: number; baseline?: number; baselineOffset: number;
}
type Resize = (node: LayerNode, width: number, height: number) => void;

function baseline(doc: Document, node: LayerNode, depth = 0): number | undefined {
  const [a,b,c,d] = layerTransform(node);
  if (Math.abs(b)>1e-9 || Math.abs(c)>1e-9 || a<0 || d<0) return;
  if (node.kind === "text") {
    const measured = textNodeLayout(node), line = measured.layout.lines[0];
    if (line) return line.baseline + measured.dy;
  }
  if (!isFrameLike(node) || !node.layout || depth >= 32) return;
  for (const id of node.children) {
    const child = doc.nodes[id];
    if (child.kind === "page" || child.visible === false || child.childLayout?.absolute) continue;
    const childBase = baseline(doc, child, depth+1);
    if (childBase !== undefined) return outerBox(child).y + child.y + childBase;
  }
}

function offsets(align: AutoLayout["mainAlign"], inner: number, total: number, count: number, gap: number) {
  const free = inner-total, gaps = gap*Math.max(0,count-1);
  switch (align) {
    case "min": return [0,gap];
    case "center": return [(free-gaps)/2,gap];
    case "max": return [free-gaps,gap];
    case "spaceBetween": return [0,count>1 ? Math.max(0,free/(count-1)) : 0];
    case "spaceAround": { const step = Math.max(0,free/Math.max(1,count)); return [step/2,step]; }
    case "spaceEvenly": { const step = Math.max(0,free/(Math.max(1,count)+1)); return [step,step]; }
  }
}

function wrapLines(items: Item[], wrap: boolean, gap: number, room: number): Item[][] {
  if (!wrap) return [items];
  const lines: Item[][] = [];
  let line: Item[] = [], used = 0;
  for (const item of items) {
    const width = item.fillMain ? item.minMain ?? 0 : item.main;
    const added = width + (line.length ? Math.max(0,gap) : 0);
    if (line.length && used+added > room+1e-6) { lines.push(line); line = []; used = width; }
    else used += added;
    line.push(item);
  }
  if (line.length) lines.push(line);
  return lines;
}

function distribute(line: Item[], available: number) {
  let open = line.filter(item => item.fillMain);
  let free = Math.max(0, available-line.reduce((n,it) => n+(it.fillMain ? 0 : it.main), 0));
  while (open.length) {
    const insets = open.reduce((n,it) => n+it.inset, 0);
    const share = Math.max(0,(free-insets)/open.length);
    let violation = 0;
    for (const item of open) {
      const want = share+item.inset;
      item.main = clampSize(want,item.minMain,item.maxMain);
      violation += item.main-want;
    }
    if (Math.abs(violation) < 1e-9) return;
    const next = open.filter(item => {
      const want = share+item.inset;
      const freeze = violation > 0 ? item.main > want+1e-9 : item.main < want-1e-9;
      if (freeze) free -= item.main;
      return !freeze;
    });
    if (next.length === open.length) return;
    free = Math.max(0,free);
    open = next;
  }
}

function lineExtents(items: Item[], gap: number) {
  const maxBase = items.reduce((n,it) => Math.max(n,it.baseline ?? 0), 0);
  const allFill = items.every(it => it.fillCross);
  let main = gap*Math.max(0,items.length-1), cross = 0;
  for (const it of items) {
    it.baselineOffset = it.baseline === undefined ? 0 : maxBase-it.baseline;
    main += it.main;
    if (allFill || !it.fillCross) cross = Math.max(cross,it.baselineOffset+it.cross);
  }
  return {main,cross,items};
}

export function reflowFlow(draft: HierarchyDraft, frame: FrameLikeNode, resize: Resize) {
  const layout = frame.layout!, horizontal = layout.mode === "horizontal", sizing = layerSizing(frame);
  const [top,right,bottom,left] = frameInsets(frame), limits = frame.childLayout;
  const width = Math.max(left+right,clampSize(frame.width,limits?.minWidth,limits?.maxWidth));
  const height = Math.max(top+bottom,clampSize(frame.height,limits?.minHeight,limits?.maxHeight));
  const innerMain = horizontal ? width-left-right : height-top-bottom;
  const innerCross = horizontal ? height-top-bottom : width-left-right;
  const hugMain = (horizontal ? sizing.horizontal : sizing.vertical) === "hug";
  const hugCross = (horizontal ? sizing.vertical : sizing.horizontal) === "hug";
  const wrap = layout.wrap && !hugMain, gap = layout.gap;
  const items: Item[] = [];
  const n = (id: NodeId) => draft.nodes[id] as LayerNode;
  for (const id of frame.children) {
    const child = n(id), props = child.childLayout;
    if (child.visible === false || props?.absolute) continue;
    const box = outerBox(child), s = layerSizing(child);
    const inset = isFrameLike(child) && child.layout ? frameInsets(child) : [0,0,0,0];
    items.push({id, main: horizontal ? box.width : box.height, cross: horizontal ? box.height : box.width,
      fillMain: !hugMain && (horizontal ? s.horizontal : s.vertical) === "fill",
      fillCross: !hugCross && (horizontal ? s.vertical : s.horizontal) === "fill",
      minMain: horizontal ? props?.minWidth : props?.minHeight, maxMain: horizontal ? props?.maxWidth : props?.maxHeight,
      minCross: horizontal ? props?.minHeight : props?.minWidth, maxCross: horizontal ? props?.maxHeight : props?.maxWidth,
      inset: horizontal ? inset[1]+inset[3] : inset[0]+inset[2], baselineOffset: 0});
  }
  const resizeItem = (it: Item, cross: number) => resize(n(it.id), horizontal ? it.main : cross, horizontal ? cross : it.main);
  if (!wrap) for (const it of items) if (it.fillCross && !it.fillMain) {
    resizeItem(it,clampSize(innerCross,it.minCross,it.maxCross));
    const box = outerBox(n(it.id));
    it.main = horizontal ? box.width : box.height;
  }
  const groups = wrapLines(items,wrap,gap,innerMain);
  const autoGap = layout.mainAlign.startsWith("space");
  for (const line of groups) distribute(line,innerMain-(autoGap ? 0 : gap*Math.max(0,line.length-1)));
  for (const it of items) {
    if (it.fillMain) {
      resizeItem(it,it.fillCross && !wrap ? clampSize(innerCross,it.minCross,it.maxCross) : it.cross);
      const box = outerBox(n(it.id));
      it.cross = horizontal ? box.height : box.width;
    }
    if (horizontal && layout.crossAlign === "baseline" && !it.fillCross) it.baseline = baseline(draft.document,n(it.id)) ?? it.cross;
  }
  const lines = groups.map(line => lineExtents(line,gap));
  const contentMain = lines.reduce((max,line) => Math.max(max,line.main), 0);
  let crossGap = layout.crossGap;
  const totalCross = lines.reduce((sum,line) => sum+line.cross, 0);
  const between = Math.max(0,lines.length-1), contentCross = totalCross+crossGap*between;
  const w = Math.max(left+right,clampSize(sizing.horizontal === "hug" ? (horizontal ? contentMain : contentCross)+left+right : width,limits?.minWidth,limits?.maxWidth));
  const h = Math.max(top+bottom,clampSize(sizing.vertical === "hug" ? (horizontal ? contentCross : contentMain)+top+bottom : height,limits?.minHeight,limits?.maxHeight));
  size(draft,frame,w,h);
  resizeChildren(draft,frame.id,frame.width,frame.height);
  const finalMain = horizontal ? w-left-right : h-top-bottom, finalCross = horizontal ? h-top-bottom : w-left-right;
  let crossPos = horizontal ? top : left;
  if (between) {
    const spread = (finalCross-totalCross)/between;
    if (layout.contentAlign === "spaceBetween" && spread>0) crossGap = spread;
    else {
      if (layout.contentAlign === "spaceBetween") crossGap = 0;
      const free = finalCross-totalCross-crossGap*between;
      if (free>0 && items.every(it => it.fillCross)) for (const line of lines) line.cross += free/lines.length;
      else crossPos += layout.crossAlign === "center" ? free/2 : layout.crossAlign === "max" ? free : 0;
    }
  }
  for (const line of lines) {
    const cross = lines.length === 1 ? finalCross : line.cross;
    const [offset,step] = offsets(layout.mainAlign,finalMain,line.main-gap*Math.max(0,line.items.length-1),line.items.length,gap);
    let pos = (horizontal ? left : top)+offset;
    for (const it of line.items) {
      const crossSize = it.fillCross ? clampSize(cross,it.minCross,it.maxCross) : it.cross;
      const shift = layout.crossAlign === "baseline" ? it.baselineOffset : layout.crossAlign === "center" ?
        (cross-crossSize)/2 : layout.crossAlign === "max" ? cross-crossSize : 0;
      if (it.fillCross && wrap) resizeItem(it,crossSize);
      placeLayer(draft,n(it.id),horizontal ? pos : crossPos+shift,horizontal ? crossPos+shift : pos);
      pos += it.main+step;
    }
    crossPos += cross+crossGap;
  }
}
