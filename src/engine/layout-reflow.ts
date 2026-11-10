import { layerSizing } from "./auto-layout";
import { resizeChildren } from "./constraints";
import { isFrameLike, isLeaf, type DocumentNode, type FrameLikeNode, type LayerNode } from "./document";
import { cellRect, gridGeometry } from "./grid-layout";
import { clampSize, frameInsets, outerBox, placeLayer, size } from "./layout-geometry";
import { reflowFlow } from "./flow-layout";
import type { HierarchyDraft } from "./hierarchy";
import { measureLayoutText } from "./text-node-layout";

// A fill child can be visited in both grid passes and again by each ancestor. Keep only
// frames already settled at these dimensions during this synchronous document edit.
type SettledFrames = Map<string, readonly [number, number]>;

function resizeChild(draft: HierarchyDraft, node: LayerNode, width: number, height: number, depth: number, settled: SettledFrames) {
  if (node.kind === "text" && node.text.autoResize !== "none" && node.text.autoResize !== "truncate") {
    if (node.text.autoResize === "widthAndHeight") {
      node = {...node, text: Object.freeze({...node.text, autoResize: "height"})};
      draft.set(node);
    }
    size(draft, node, width, measureLayoutText(node, width).height);
  } else {
    size(draft, node, width, height);
    if (isFrameLike(node)) {
      resizeChildren(draft, node.id, node.width, node.height);
      const resized = draft.nodes[node.id] as FrameLikeNode;
      if (resized.layout) reflowFrame(draft, resized, depth+1, settled);
    }
  }
}

function prepareChild(draft: HierarchyDraft, node: LayerNode, depth: number, settled: SettledFrames) {
  const limits = node.childLayout;
  if (node.kind === "text" && (node.text.autoResize === "widthAndHeight" && !node.text.path ||
      node.text.autoResize === "height" && layerSizing(node).horizontal === "hug")) {
    const natural = measureLayoutText(node);
    const w = clampSize(natural.width, limits?.minWidth, limits?.maxWidth);
    const limited = Math.abs(w-natural.width) > 1e-6;
    const h = limited ? measureLayoutText(node, w).height : natural.height;
    const autoResize = limited ? "height" : "widthAndHeight";
    if (autoResize !== node.text.autoResize) {
      node = {...node, text: Object.freeze({...node.text, autoResize})};
      draft.set(node);
    }
    size(draft, node, w, h);
    node = draft.nodes[node.id] as LayerNode;
  }
  if (!limits) return;
  const w = clampSize(node.width, limits.minWidth, limits.maxWidth);
  const h = clampSize(node.height, limits.minHeight, limits.maxHeight);
  if (Math.abs(w-node.width) < 1e-9 && Math.abs(h-node.height) < 1e-9) return;
  if (node.kind === "text") size(draft, node, w, h);
  else resizeChild(draft, node, w, h, depth, settled);
}

function alignOffset(align: string, free: number) {
  return align === "center" ? free/2 : align === "max" ? free : 0;
}

export function reflowFrame(draft: HierarchyDraft, frame: FrameLikeNode, depth = 0, settled: SettledFrames = new Map()) {
  if (depth >= 256) return;
  const prior = settled.get(frame.id);
  if (prior && prior[0] === frame.width && prior[1] === frame.height) return;
  const layout = frame.layout!;
  for (const id of frame.children) {
    const n = draft.nodes[id];
    if (n.kind !== "page" && n.visible !== false && !n.childLayout?.absolute) prepareChild(draft, n, depth, settled);
  }
  if (layout.mode === "grid") reflowGrid(draft, frame, depth, settled);
  else reflowFlow(draft, frame, (child, width, height) => resizeChild(draft, child, width, height, depth, settled));
  const final = draft.nodes[frame.id] as FrameLikeNode;
  settled.set(frame.id, [final.width, final.height]);
}

function reflowGrid(draft: HierarchyDraft, frame: FrameLikeNode, depth: number, settled: SettledFrames) {
  const layout = frame.layout!, limits = frame.childLayout, sizing = layerSizing(frame);
  const [top,right,bottom,left] = frameInsets(frame);
  const hugW = sizing.horizontal === "hug", hugH = sizing.vertical === "hug";
  size(draft, frame, hugW ? frame.width : Math.max(left+right, clampSize(frame.width, limits?.minWidth, limits?.maxWidth)),
    hugH ? frame.height : Math.max(top+bottom, clampSize(frame.height, limits?.minHeight, limits?.maxHeight)));
  const current = () => draft.nodes[frame.id] as FrameLikeNode;
  let grid = gridGeometry(draft.document, current()), widened = false;
  for (const [id, cell] of grid.cells) {
    const node = draft.nodes[id] as LayerNode;
    if (!hugW && layerSizing(node).horizontal === "fill") {
      const w = clampSize(cellRect(grid,cell).width, node.childLayout?.minWidth, node.childLayout?.maxWidth);
      resizeChild(draft, node, w, outerBox(node).height, depth, settled);
      widened = true;
    }
  }
  if (widened) grid = gridGeometry(draft.document, current());
  size(draft, current(), grid.width, grid.height);
  resizeChildren(draft, frame.id, frame.width, frame.height);
  for (const [id, cell] of grid.cells) {
    let node = draft.nodes[id] as LayerNode;
    const rect = cellRect(grid, cell), child = layerSizing(node), cl = node.childLayout;
    const fillW = !hugW && child.horizontal === "fill", fillH = !hugH && child.vertical === "fill";
    if (fillW || fillH) {
      const box = outerBox(node);
      resizeChild(draft, node, fillW ? clampSize(rect.width, cl?.minWidth, cl?.maxWidth) : box.width,
        fillH ? clampSize(rect.height, cl?.minHeight, cl?.maxHeight) : box.height, depth, settled);
      node = draft.nodes[id] as LayerNode;
    }
    const box = outerBox(node);
    placeLayer(draft, node, rect.x + alignOffset(cl?.gridAlignH ?? layout.mainAlign, rect.width-box.width),
      rect.y + alignOffset(cl?.gridAlignV ?? layout.crossAlign, rect.height-box.height));
  }
}

function reshaped(a: DocumentNode | undefined, b: LayerNode) {
  if (!a || a.kind === "page" || a.kind !== b.kind) return true;
  return a.width !== b.width || a.height !== b.height || a.parent !== b.parent || a.visible !== b.visible ||
    a.childLayout !== b.childLayout || layerSizing(a) !== layerSizing(b) || a.stroke !== b.stroke ||
    a.strokes?.length !== b.strokes?.length || !isLeaf(a) && !isLeaf(b) && a.children !== b.children ||
    isFrameLike(a) && isFrameLike(b) && a.layout !== b.layout ||
    a.kind === "text" && b.kind === "text" && a.text !== b.text;
}

export function reflowChangedFrames(draft: HierarchyDraft) {
  const frames = new Set<FrameLikeNode>();
  for (const id of draft.changedIds) {
    const n = draft.nodes[id];
    if (!n || n.kind === "page") continue;
    const a = draft.layoutBaseline.nodes[id];
    const shape = reshaped(a, n);
    if (!shape && a && a.kind !== "page" && a.x === n.x && a.y === n.y && a.transform === n.transform) continue;
    if (shape && isFrameLike(n) && n.layout) frames.add(n);
    let parent = draft.nodes[n.parent];
    while (parent && parent.kind !== "page") {
      if (isFrameLike(parent) && parent.layout) frames.add(parent);
      parent = draft.nodes[parent.parent];
    }
  }
  if (!frames.size) return;
  const depth = (frame: FrameLikeNode) => {
    let n: DocumentNode = frame, d = 0;
    while (n.parent !== null) { n = draft.nodes[n.parent]; d++; }
    return d;
  };
  const settled: SettledFrames = new Map();
  for (const f of [...frames].sort((a,b) => depth(b)-depth(a))) reflowFrame(draft, draft.nodes[f.id] as FrameLikeNode, 0, settled);
}
