import { transformBounds } from "./affine";
import { layerSizing, readAutoLayout, type AutoLayout } from "./auto-layout";
import { withSizing } from "./child-layout-properties";
import { isFrameLike, layerTransform, type FrameLikeNode, type NodeId } from "./document";
import type { Rectangle } from "./geometry";
import { HierarchyDraft, subtreeIds } from "./hierarchy";
import { inspectedId, parseString } from "./parameters";

const defaults = readAutoLayout({});
type Direction = AutoLayout["mode"];
type Entry = {id: NodeId; box: Rectangle};
type Band = {ids: NodeId[]; lo: number; hi: number; crossLo: number; crossHi: number};

function frameEntries(draft: HierarchyDraft, frame: FrameLikeNode) {
  return frame.children.map(id => {
    const layer = draft.nodes[id];
    if (layer.kind === "page") throw new Error("Invalid frame child");
    return {id,box:transformBounds(layerTransform(layer),layer.width,layer.height),layer};
  });
}

function sortChildren(draft: HierarchyDraft, frame: FrameLikeNode, vertical: boolean) {
  const children: NodeId[] = [];
  let run: Entry[] = [], masked = false;
  const flush = () => {
    if (!masked) run.sort((a,b)=> vertical ? a.box.y-b.box.y : a.box.x-b.box.x);
    for (const item of run) children.push(item.id);
    run = [];
  };
  for (const item of frameEntries(draft,frame)) {
    if (item.layer.isMask) { flush(); children.push(item.id); masked = item.layer.visible !== false; }
    else run.push(item);
  }
  flush();
  return Object.freeze(children);
}

function inferLayout(boxes: readonly Entry[], frame: FrameLikeNode): AutoLayout {
  if (!boxes.length) return defaults;
  let x=Infinity,y=Infinity,right=-Infinity,bottom=-Infinity;
  for (const {box} of boxes) {
    x=Math.min(x,box.x); y=Math.min(y,box.y);
    right=Math.max(right,box.x+box.width); bottom=Math.max(bottom,box.y+box.height);
  }
  const vertical=bottom-y > right-x, sorted=[...boxes].sort((a,b)=>vertical ? a.box.y-b.box.y : a.box.x-b.box.x);
  let gaps=0;
  for (let i=1;i<sorted.length;i++) {
    const prev=sorted[i-1].box, next=sorted[i].box;
    gaps += vertical ? next.y-(prev.y+prev.height) : next.x-(prev.x+prev.width);
  }
  const pad=(n:number)=>Math.round(Math.max(0,n));
  return {...defaults,mode:vertical ? "vertical" : "horizontal",gap:boxes.length === 1 ? 10 : pad(gaps/(boxes.length-1)),
    padding:Object.freeze([pad(y),pad(frame.width-right),pad(frame.height-bottom),pad(x)] as const)};
}

function bands(entries: readonly Entry[], vertical: boolean) {
  const ordered = [...entries].sort((a,b) => vertical ? a.box.y-b.box.y : a.box.x-b.box.x);
  const result: Band[] = [];
  for (const {box,id} of ordered) {
    const [lo,hi,crossLo,crossHi] = vertical ? [box.y,box.y+box.height,box.x,box.x+box.width] :
      [box.x,box.x+box.width,box.y,box.y+box.height];
    const last = result.at(-1);
    if (last && (lo < last.hi-1e-6 || lo-last.lo < 1e-6)) {
      last.hi=Math.max(hi,last.hi); last.crossLo=Math.min(crossLo,last.crossLo); last.crossHi=Math.max(crossHi,last.crossHi);
      last.ids.push(id);
    } else result.push({ids:[id],lo,hi,crossLo,crossHi});
  }
  return result;
}

const rounded = (v:number) => Number.isFinite(v) ? Math.sign(v)*Math.round(Math.abs(v)*1000)/1000 : 0;

function warningNumber(value: number) {
  const n = rounded(value);
  return Object.is(n,-0) ? "-0" : String(n);
}

function bandLayout(items: Band[], vertical: boolean, frame: FrameLikeNode, warnings: string[]): AutoLayout {
  const gaps=items.slice(1).map((item,i)=>Math.max(0,item.lo-items[i].hi));
  const minGap=Math.min(...gaps),maxGap=Math.max(...gaps), what=vertical ? "rows" : "columns";
  const prefix='"'+frame.name+'": ';
  if (maxGap-minGap>.5) warnings.push(prefix+'the gaps between the '+what+' differ ('+warningNumber(minGap)+' to '+warningNumber(maxGap)+'), so the smallest is used and later '+what+' move');
  const low=Math.min(...items.map(i=>i.crossLo)),high=Math.max(...items.map(i=>i.crossLo));
  if (high-low>.5) warnings.push(prefix+'the '+what+' start at different offsets ('+warningNumber(low)+' to '+warningNumber(high)+'), so they are lined up at the smallest and some move');
  const inset=(v:number)=>rounded(Math.max(0,v));
  const start=inset(items[0].lo),end=inset((vertical ? frame.height : frame.width)-items.at(-1)!.hi);
  const cStart=inset(low), cEnd=inset((vertical ? frame.width : frame.height)-Math.max(...items.map(i=>i.crossHi)));
  return {...defaults,mode:vertical ? "vertical" : "horizontal",gap:rounded(minGap),
    padding:Object.freeze(vertical ? [start,cEnd,end,cStart] as const : [cStart,end,cEnd,start] as const)};
}

function placeFrame(draft: HierarchyDraft, id: NodeId, layout: AutoLayout) {
  const frame = draft.nodes[id] as FrameLikeNode;
  draft.set({...frame,layout:Object.freeze(layout),children:sortChildren(draft,frame,layout.mode === "vertical")});
}

function hugFrame(draft: HierarchyDraft, id: NodeId, preserveFill=false) {
  const frame=draft.nodes[id] as FrameLikeNode, s=layerSizing(frame);
  draft.set(withSizing(frame,preserveFill && s.horizontal === "fill" ? "fill" : "hug",preserveFill && s.vertical === "fill" ? "fill" : "hug"));
}

function split(draft: HierarchyDraft, id: NodeId, direction: Direction | undefined, depth: number, warnings: string[], wrap: (ids:NodeId[])=>NodeId): boolean {
  const frame=draft.nodes[id] as FrameLikeNode, entries=frameEntries(draft,frame);
  const flow=entries.filter(e=>e.layer.visible !== false && !e.layer.childLayout?.absolute);
  const flat=()=>{const layout=inferLayout(flow,frame); placeFrame(draft,id,{...layout,mode:direction ?? layout.mode}); return true;};
  if (flow.length<2) return flat();
  const reason=entries.some(e=>e.layer.isMask) ? "it has a mask" : depth>=16 ? "the frames are nested too deep" :
    flow.length>1000 ? "it has too many layers to analyse" : undefined;
  if (reason) { warnings.push('"'+frame.name+'": '+reason+', so its layers are laid out in one list'); return flat(); }
  if (direction === "grid") return flat();
  let vertical=direction !== "horizontal", parts=bands(flow,vertical);
  if (!direction && parts.length<2) { vertical=false; parts=bands(flow,false); }
  if (parts.length<2) {
    if (direction) {
      warnings.push('"'+frame.name+'": its layers don\'t separate along the direction asked for, so they are laid out in one list');
      return flat();
    }
    warnings.push('"'+frame.name+'": its layers overlap along both axes, so no auto layout was added');
    return false;
  }
  const layout=bandLayout(parts,vertical,frame,warnings);
  const nested=parts.filter(b=>b.ids.length>1).map(b=>wrap(b.ids));
  placeFrame(draft,id,layout);
  for (const child of nested) if (split(draft,child,undefined,depth+1,warnings,wrap)) hugFrame(draft,child);
  return true;
}

export function editLayoutStructure(command: string, draft: HierarchyDraft, ids: NodeId[], rawDirection: unknown,
  wrap: (ids:NodeId[])=>NodeId, convertGroup: (id:NodeId)=>void): {selected?: NodeId[]; result: Record<string,unknown>} {
  if (command === "layout.remove" || command === "layout.removeAll") {
    const all=command === "layout.removeAll", removed: NodeId[]=[];
    for (const root of ids) for (const id of all ? subtreeIds(draft.document,root) : [root]) {
      const n=draft.nodes[id];
      if (isFrameLike(n) && n.layout) {
        const {layout,...frame}=n;
        draft.set(frame); removed.push(id);
      }
    }
    return {result:all ? {removed:removed.map(inspectedId)} : {ok:true}};
  }
  const direction=parseString(rawDirection)?.toLowerCase();
  const mode=direction === undefined ? undefined : direction === "grid" ? "grid" :
    direction === "column" || direction === "vertical" ? "vertical" : "horizontal";
  const allFrames=ids.every(id=>{const n=draft.nodes[id];return isFrameLike(n) && !n.layout;});
  const group=ids.length === 1 && draft.nodes[ids[0]].kind === "group";
  if (group) convertGroup(ids[0]);
  const targets=allFrames || group ? ids : [wrap(ids)], warnings:string[]=[];
  for (const id of targets) {
    if (command === "layout.suggest") {
      if (split(draft,id,mode,0,warnings,wrap) && !allFrames) hugFrame(draft,id,group);
    } else {
      const frame=draft.nodes[id] as FrameLikeNode, flow=frameEntries(draft,frame).filter(e=>e.layer.visible !== false && !e.layer.childLayout?.absolute);
      const inferred=inferLayout(flow,frame);
      placeFrame(draft,id,{...inferred,mode:mode ?? inferred.mode});
      if (flow.length || !allFrames && !group) hugFrame(draft,id,group);
    }
  }
  return {selected:targets,result:{ids:targets.map(inspectedId),...(warnings.length && {warnings})}};
}
