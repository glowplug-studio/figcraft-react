import type { Document, DocumentNode, NodeId } from "./document";
import { ancestors, HierarchyDraft } from "./hierarchy";
import { parseNodeId, parseString } from "./parameters";
import type { Variables } from "./variables";

export interface LayerVariableModes {
  readonly variableModes?: Readonly<Record<string,string>>;
}

/** Instance mains contribute their own settings, never the settings of their ancestors. */
export function layerModes(doc:Document, id:NodeId, inheritedOnly=false):Readonly<Record<string,string>> {
  const modes:Record<string,string>=Object.create(null);
  for (const key of [...ancestors(doc,id).reverse(),id]) {
    const node=doc.nodes[key];
    if (node.kind==="instance") Object.assign(modes,doc.nodes[node.component]?.variableModes);
    if (!inheritedOnly || key!==id) Object.assign(modes,node.variableModes);
  }
  return modes;
}

export function withVariableModes<T extends DocumentNode>(node:T, patch:unknown):T {
  if (!patch || typeof patch!=="object" || Array.isArray(patch)) return node;
  const modes:Record<string,string>=Object.assign(Object.create(null),node.variableModes);
  let changed=false;
  for (const [key,value] of Object.entries(patch)) {
    if (typeof value==="string") {
      if (modes[key]!==value) {modes[key]=value;changed=true;}
    } else if (Object.hasOwn(modes,key)) {delete modes[key];changed=true;}
  }
  if (!changed) return node;
  const {variableModes,...rest}=node;
  return Object.freeze({...rest,...(Object.keys(modes).length>0 && {variableModes:Object.freeze(modes)})}) as T;
}

export function setVariableMode(doc:Document, selection:readonly NodeId[], p:Record<string,unknown>):Document {
  for (const key of Object.keys(p)) if (!["id","ids","collection","mode"].includes(key)) throw new Error("Unknown variable.setMode parameter "+key);
  const name=parseString(p.collection);
  const collection=doc.variables?.collections.find(c=>c.name===name || c.id===name);
  if (!collection) throw new Error("No such collection");
  const raw=parseString(p.mode);
  const mode=collection.modes.find(m=>m.name===raw || m.id===raw);
  if (p.mode!==null && !mode) throw new Error("No such mode");
  const single=parseNodeId(p.id);
  const ids=Array.isArray(p.ids) ? p.ids.map(parseNodeId).filter((id):id is string=>id!==undefined) : single!==undefined ? [single] : selection;
  const draft=new HierarchyDraft(doc);
  for (const id of ids.length ? ids : [doc.currentPage]) {
    const node=draft.nodes[id];
    if (!node) throw new Error("No node "+id);
    draft.set(withVariableModes(node,{[collection.id]:mode?.id ?? null}));
  }
  return draft.finish();
}

/** Only the directly deleted collection/mode is removed. Other file-supplied references survive. */
export function removeLayerMode(doc:Document, old:Variables, p:Record<string,unknown>, wholeCollection:boolean) {
  const name=parseString(p.collection);
  const c=old.collections.find(c=>c.id===name || c.name===name);
  if (!c) return doc;
  const raw=parseString(p.mode);
  const mode=c.modes.find(m=>m.name===raw || m.id===raw);
  let draft:HierarchyDraft|undefined;
  for (const node of Object.values(doc.nodes)) {
    if (!node.variableModes || !Object.hasOwn(node.variableModes,c.id) || !wholeCollection && node.variableModes[c.id]!==mode?.id) continue;
    (draft??=new HierarchyDraft(doc)).set(withVariableModes(node,{[c.id]:null}));
  }
  return draft?.finish() ?? doc;
}
