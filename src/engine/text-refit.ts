import type { Document, NodeId } from "./document";
import { HierarchyDraft, rootIds, subtreeIds } from "./hierarchy";
import { inspectedId, parseNodeId } from "./parameters";
import { validateChangedGeometry } from "./rotation";
import { compareScalarKeys } from "./text-breaks";
import { textSpans } from "./text-ranges";
import { fitEditedText, hasFontFamily } from "./text-node-layout";

// Native document iteration is in ascending u64 order, including ids beyond JS array-index range.
function compareIds(a:NodeId,b:NodeId) {
  return a.length-b.length || (a<b ? -1 : a>b ? 1 : 0);
}

/** Explicit refitting measures stale boxes even when the stored text itself has not changed. */
export function refitText(document:Document, params:Record<string,unknown>) {
  if (Object.keys(params).some(key=>key!=="ids" && key!=="id")) throw new Error("Unknown text.refit option");
  let scope:Set<NodeId>|undefined;
  if (params.ids!=null) {
    if (!Array.isArray(params.ids) || !params.ids.length) throw new Error("Pass a non-empty array of layer ids");
    const targets=params.ids.map(value=>{
      const id=parseNodeId(value);
      if (!id || !document.nodes[id]) throw new Error("Unknown layer in text.refit");
      return id;
    });
    scope=new Set(rootIds(document,targets).flatMap(id=>subtreeIds(document,id)));
  }
  const draft=new HierarchyDraft(document), changed:NodeId[]=[];
  for (const node of Object.values(document.nodes)) {
    if (node.kind!=="text" || (scope && !scope.has(node.id))) continue;
    if (node.text.path || node.text.autoResize==="truncate" || node.text.autoResize==="none") continue;
    const updated=fitEditedText(node,node);
    if (Math.abs(updated.width-node.width)<=1e-6 && Math.abs(updated.height-node.height)<=1e-6) continue;
    draft.set(updated);
    changed.push(node.id);
  }
  draft.normaliseGroups();
  changed.sort(compareIds);
  return {document:validateChangedGeometry(draft),refitted:changed.map(inspectedId)};
}

export interface MissingFont {readonly family:string; readonly layers:number; readonly source:null}

export function missingFonts(document:Document):MissingFont[] {
  const usage=new Map<string,MissingFont>();
  for (const id of Object.keys(document.nodes).sort(compareIds)) {
    const node=document.nodes[id];
    if (node.kind!=="text") continue;
    const seen=new Set<string>();
    const families=textSpans(node.text).map(span=>span.style.fontFamily);
    for (const raw of [...families,node.text.style.fontFamily]) {
      const family=raw.trim(), key=family.toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      const previous=usage.get(key);
      usage.set(key,{family:previous?.family ?? family,layers:(previous?.layers ?? 0)+1,source:null});
    }
  }
  return [...usage.keys()].sort(compareScalarKeys).filter(key=>!hasFontFamily(key)).map(key=>usage.get(key)!);
}
