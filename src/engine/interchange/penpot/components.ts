import { wireChildLayout, layerSizing } from "../../auto-layout";
import { differentComponentGroups, sameComponentValue, withOverrideSet } from "../../component-groups";
import { rebaseOwnedInstance } from "../../component-sync";
import { isFrameLike, type Document, type LayerNode, type DocumentNode } from "../../document";
import { ancestors, HierarchyDraft } from "../../hierarchy";
import { object, string, type JsonObject } from "../rest/values";
import { PenpotArchive, isUuid } from "./archive";
import { clipped, records, keepSource } from "./values";

type Warn = (message:string)=>void;
export async function componentDefinitions(archive: PenpotArchive, base: string) {
  const prefix=base+"/components/", paths=[];
  const map=new Map<string,{id:string;name:string;source?:string}>();
  for (const p of archive.names()) if (p.startsWith(prefix) && p.endsWith(".json") && isUuid(p.slice(prefix.length,-5))) {
    paths.push(p);
    if (paths.length>10000) return map;
  }
  const clean=(s:string)=>clipped(s.replace(/[,=]/g," ").trim(),200);
  for (const path of paths) {
    let entry:JsonObject;
    try {entry=object(await archive.json(path));} catch {archive.check();continue;}
    if (!isUuid(entry.id) || !isUuid(entry.mainInstanceId)) continue;
    const pairs=records(entry.variantProperties).slice(0,64).flatMap(p=>{
      const key=typeof p.name==="string" ? clean(p.name) : "";
      return key ? [key+"="+clean(string(p.value) ?? "")] : [];
    });
    const record=archive.numbers.pick(entry,Object.keys(entry).filter(key=>key!=="objects"));
    const source:Record<string,string>={};
    keepSource(source,"component",record,archive.numbers);
    map.set(entry.mainInstanceId,{id:entry.id,name:pairs.join(", "),source:source.component});
  }
  return map;
}

function near(a:unknown,b:unknown):boolean {
  if (typeof a==="number" && typeof b==="number") return Math.abs(a-b)<=.01;
  if (a===b) return true;
  if (!a || !b || typeof a!=="object" || typeof b!=="object") return false;
  const keys=Object.keys(a);
  return keys.length===Object.keys(b).length && keys.every(k=>Object.hasOwn(b,k) && near((a as Record<string,unknown>)[k],(b as Record<string,unknown>)[k]));
}
function shape(node:LayerNode) {
  switch (node.kind) {
    case "vector":return node.network;
    case "booleanOp":return node.op;
    case "ellipse":return [node.start,node.sweep,node.inner];
    default:return node.kind;
  }
}

function blockedFields(a:LayerNode,b:LayerNode) {
  const rows:[string,unknown,unknown,boolean?][]=[
    ["clip",isFrameLike(a) && a.clip,isFrameLike(b) && b.clip],["mask",a.isMask,b.isMask,true],
    ["layout",isFrameLike(a) && a.layout,isFrameLike(b) && b.layout],["constraints",a.constraints,b.constraints,true],
    ["absolute",a.childLayout?.absolute,b.childLayout?.absolute,true],["grids",a.grids,b.grids],
    ["mask type",a.maskType,b.maskType],["guides",a.guides,b.guides,true],["exports",a.exports,b.exports,true],
    ["interactions",a.interactions,b.interactions,true],["styles",a.styles,b.styles],["variable bindings",a.boundVariables,b.boundVariables],["variable modes",a.variableModes,b.variableModes,true],
  ];
  return rows.filter(([,a,b])=>!sameComponentValue(a,b));
}

export function linkComponents(document:Document,nodes:Record<string,DocumentNode>,warn:Warn) {
  const masters=new Map<string,string>(), ids=new Map<string,string>();
  const candidates=[];
  for (const n of Object.values(nodes)) {
    const meta=n.sourceMetadata;
    if (!meta) continue;
    if (meta["penpot.id"]) ids.set(meta["penpot.id"],n.id);
    if (n.kind==="component") masters.set(meta["penpot.fileId"]+":"+meta["penpot.componentMasterId"],n.id);
    if (n.kind!=="page" && meta["penpot.componentLinkStatus"]) {
      const chain=ancestors(document,n.id), inMain=chain.some(id=>nodes[id].kind==="component");
      candidates.push({id:n.id,mains:inMain ? 0 : 1, depth:inMain ? -chain.length : chain.length,chain});
    }
  }
  candidates.sort((a,b)=>a.mains-b.mains || a.depth-b.depth || Number(a.id)-Number(b.id));
  let missing=false, editorState=0;
  for (const {id,chain} of candidates) {
    const copy=nodes[id] as LayerNode, meta=copy.sourceMetadata!;
    if (chain.some(id=>nodes[id].kind==="instance")) continue;
    const main=masters.get((meta["penpot.componentFile"] ?? meta["penpot.fileId"])+":"+meta["penpot.componentId"]);
    if (!main) {missing=true;continue;}
    if (chain.includes(main) || ancestors(document,main).includes(id)) continue;
    const pairs:{copy:LayerNode;source:LayerNode;groups:Set<string>}[]=[];
    function match(copy:LayerNode,source:LayerNode,depth:number):string|undefined {
      if (depth>=128) return "nesting too deep";
      const root=depth===0, at=(s:string)=>s+" at '"+clipped(copy.name,60)+"'";
      let ref=copy.sourceMetadata?.["penpot.shapeRef"];
      const target=source.sourceMetadata?.["penpot.id"];
      for (let hop=0;ref && ref!==target && hop<128;hop++) ref=nodes[ids.get(ref) ?? ""]?.sourceMetadata?.["penpot.shapeRef"];
      if (!ref || ref!==target) return at("layer does not reference its main counterpart");
      const compatible=root ? copy.kind==="frame" && source.kind==="component" :
        copy.kind==="frame" && source.kind==="instance" || copy.kind===source.kind && !["component","instance","componentSet"].includes(copy.kind) && near(shape(copy),shape(source));
      if (!compatible) return at("layer type differs from main");
      const kids="children" in copy ? copy.children : [], originals="children" in source ? source.children : [];
      if (kids.length!==originals.length) return at("children added or removed");
      if (!root && source.kind==="instance" && copy.sourceMetadata?.["penpot.componentId"]!==source.sourceMetadata?.["penpot.componentId"]) return at("swapped nested component instance");
      const blocked=blockedFields(copy,source);
      if (blocked.some(([, , ,childOnly])=>!root || !childOnly)) return at("unsupported override ("+blocked.map(([key])=>key).join(", ")+")");
      const groups=new Set<string>(differentComponentGroups(copy,source).filter(g=>["name","fills","strokes","effects","opacity","visible","corners","characters","textStyle"].includes(g)));
      if (copy.width!==source.width || copy.height!==source.height || !sameComponentValue(wireChildLayout(copy.childLayout,layerSizing(copy)),wireChildLayout(source.childLayout,layerSizing(source)))) groups.add("size");
      if (!root && (copy.x!==source.x || copy.y!==source.y || !sameComponentValue(copy.transform,source.transform))) groups.add("position");
      pairs.push({copy,source,groups});
      for (let i=0;i<kids.length;i++) {
        const error=match(nodes[kids[i]] as LayerNode,nodes[originals[i]] as LayerNode,depth+1);
        if (error) return error;
      }
    }
    const reason=match(copy,nodes[main] as LayerNode,0);
    if (reason) {
      warn("Component copy '"+copy.name+"' kept independent: "+reason);
      nodes[id]={...copy,sourceMetadata:{...meta,"penpot.componentLinkReason":reason}};continue;
    }
    for (const {copy,source,groups} of pairs) {
      if (copy.id!==id && (copy.locked!==source.locked || copy.constrainProportions!==source.constrainProportions)) editorState++;
      const placed=withOverrideSet({...copy,source:source.id},groups), data={...placed.sourceMetadata};
      if (copy.id===id || source.kind==="instance") {
        data["penpot.componentLinkStatus"]="linked";
        nodes[copy.id]={...placed,kind:"instance",clip:isFrameLike(copy) && copy.clip,children:"children" in copy ? copy.children : [],
          component:copy.id===id ? main : (source.kind==="instance" ? source.component : main),props:source.kind==="instance" ? source.props : {},sourceMetadata:data};
      } else {
        if (data["penpot.componentLinkStatus"]) data["penpot.componentLinkStatus"]="layer-of-linked-instance";
        nodes[copy.id]={...placed,sourceMetadata:data};
      }
    }
  }
  if (missing) warn("Some Penpot component copies could not find their local masters; kept as editable independent frames");
  if (editorState) warn(editorState+" layer(s) inside linked component copies now take their lock and proportion-lock state from the main component");
}

export function designSystemWarnings(nodes:Record<string,DocumentNode>,warn:Warn) {
  let variants=0,missing=0;
  for (const n of Object.values(nodes)) {
    const meta=n.sourceMetadata;
    if ((meta?.["penpot.variantId"]!==undefined || meta?.["penpot.source.variantProperties"]!==undefined) &&
        !(n.kind==="component" && nodes[n.parent]?.kind==="componentSet")) variants++;
    if (meta?.["penpot.componentLinkStatus"]==="not-linked") missing++;
  }
  if (variants) warn(variants+" Penpot variant layers are not inside a variant set; variant switching is unavailable for them");
  if (missing) warn(missing+" component copies have no native link; editing their masters will not update those copies");
}

export function rebaseCopies(doc:Document) {
  const instances=Object.values(doc.nodes).filter(n=>n.kind==="instance").map(n=>({n,depth:ancestors(doc,n.id).length})).sort((a,b)=>b.depth-a.depth);
  if (!instances.length) return doc;
  const draft=new HierarchyDraft(doc);
  for (const {n} of instances) {
    const src=draft.nodes[n.component];
    if (src?.kind==="component") rebaseOwnedInstance(draft,n,src);
  }
  // Native file loading repairs source links without running interactive edit reflow.
  return Object.freeze({...doc,nodes:Object.freeze(draft.nodes)});
}
