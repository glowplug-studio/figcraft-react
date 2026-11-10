import {componentOverrides} from "../../component-properties";
import {withOverrideSet} from "../../component-groups";
import {ancestors,type HierarchyDraft} from "../../hierarchy";

export const figOrigin=Symbol("Fig layer provenance");
export interface FigOrigin {
  id:string;rest:string;expanded:boolean;wireFrame:boolean;wireInstance:boolean;
  sizeOverride:boolean;slotOverride:boolean;slotContent:boolean;component?:string;
}
function expanded(owner:string,origin:string) {
  return owner.length+origin.length+2<=44*258 ? (owner.startsWith("I") ? owner : "I"+owner)+";"+origin : undefined;
}
export function linkFigSources(draft:HierarchyDraft,ids:Map<string,string>,metadata:Map<string,FigOrigin>) {
  if (!metadata.size) return 0;
  const doc=draft.document, duplicate=new Set<string>(), memo=new Map<string,string|undefined>(),active=new Set<string>();
  for (const [id,m] of metadata) if (ids.get(m.rest)!==id) duplicate.add(m.rest);
  const origin=(id:string)=>{const m=metadata.get(id);return m && !duplicate.has(m.rest) ? m : undefined;};
  const parents=(id:string)=>ancestors(doc,id);
  function missing(id:string) {
    const m=origin(id);
    return doc.nodes[id]?.kind==="frame" && m?.wireInstance && m.component && !ids.has(m.component);
  }
  function owner(id:string) {return parents(id).find(p=>doc.nodes[p].kind==="instance" || missing(p));}
  function namespace(id:string,root:string) {
    const base=origin(root);
    if (!base) return false;
    for (const p of [id,...parents(id)]) {
      if (p===root) return true;
      const m=origin(p);
      if (!m?.expanded || expanded(base.rest,m.id)!==m.rest) return false;
    }
    return false;
  }
  function owned(id:string) {
    if (parents(id).some(p=>doc.nodes[p].kind==="instance")) return false;
    for (let i=0;i<=256;i++) {
      const parent=owner(id);
      if (!parent || !missing(parent) || !namespace(id,parent)) return false;
      if (!origin(parent)?.expanded) return true;
      id=parent;
    }
    return false;
  }
  function mainOf(id:string) {
    const n=doc.nodes[id];
    if (n.kind!=="instance") return;
    const main=n.component,m=origin(main);
    if (m && !m.expanded && doc.nodes[main]?.kind==="component" && main!==id && !parents(main).includes(id) && !parents(id).includes(main)) return main;
  }
  function raw(id:string,main:string) {
    const target=ids.get(id),m=target && origin(target);
    if (target && m && !m.expanded && m.rest===id && target!==main && parents(target).includes(main)) return target;
  }
  function resolve(id:string,depth:number):string|undefined {
    const m=origin(id);
    if (!m) return;
    if (!m.expanded || m.slotContent) return mainOf(id);
    const parent=owner(id);
    if (!parent || !namespace(id,parent)) return;
    const sourceParent=source(parent,depth+1),parentNode=doc.nodes[parent];
    if (!sourceParent) return missing(parent) && owned(id) ? mainOf(id) : undefined;
    const base=doc.nodes[sourceParent],baseMeta=origin(sourceParent);
    if (!baseMeta) return;
    if (parentNode.kind==="instance") {
      const main=parentNode.component;
      if (sourceParent===main && base.kind==="component" || base.kind==="instance" && base.component!==main || base.kind==="frame" && baseMeta.wireFrame) return raw(m.id,main);
      if (base.kind!=="instance" || base.component!==main) return;
    } else if (!missing(parent) || !missing(sourceParent) || origin(parent)?.component!==baseMeta.component) return;
    const key=expanded(baseMeta.rest,m.id),target=key && ids.get(key),t=target && origin(target);
    if (!target || !t || !t.expanded || t.id!==m.id || owner(target)!==sourceParent || parents(target).includes(id) || target===id) return;
    if (parentNode.kind!=="instance") {
      if (!namespace(target,sourceParent)) return;
      const actualParent=doc.nodes[id].parent,targetParent=doc.nodes[target].parent;
      if (!actualParent || !targetParent) return;
      if (actualParent===parent ? targetParent!==sourceParent : targetParent===sourceParent || origin(actualParent)?.id!==origin(targetParent)?.id) return;
    }
    return target;
  }
  function source(id:string,depth:number):string|undefined {
    if (memo.has(id)) return memo.get(id);
    if (depth>256 || active.has(id)) return;
    active.add(id);
    const result=resolve(id,depth);
    active.delete(id);memo.set(id,result);
    return result;
  }
  for (const id of metadata.keys()) source(id,0);
  let unresolved=0;
  for (const [id,m] of metadata) {
    const node=draft.nodes[id];
    if (node.kind==="page") continue;
    const required=node.kind==="instance" || m.expanded && !m.slotContent && !owned(id);
    let target=memo.get(id);
    if (target) {
      const seen=new Set([id]);
      for (let p:string|undefined=target;p;p=memo.get(p)) {
        if (seen.has(p) || seen.size>256) {target=undefined;break;}
        seen.add(p);
      }
    }
    if (required && !target) unresolved++;
    if (target || m.sizeOverride || m.slotOverride) {
      const groups=new Set(componentOverrides(node));
      if (m.sizeOverride) groups.add("size");
      if (m.slotOverride) groups.add("slot");
      draft.set(withOverrideSet({...node,source:target},groups));
    }
  }
  return unresolved;
}
