import { sameComponentValue } from "../component-groups";
import type { Document, LayerNode } from "../document";
import { remapVariableReferences } from "../library-variables";
import type { PrototypeAction, PrototypeExpression } from "../prototype-data";
import { U64_MAX } from "../native-values";
import type { SharedStyle, StyleRefs } from "../shared-styles";
import type { TextStyle } from "../text-style";
import { references } from "../variable-values";
import { emptyVariables, type Collection, type Variable } from "../variables";

type Kind="styles"|"collections"|"variables";
type Item=Collection|Variable|SharedStyle;
type Ids=Record<Kind,Map<string,string>>;
const kinds=["collections","variables","styles"] as const;
const prefix={collections:"VariableCollectionId:",variables:"VariableID:",styles:"S:"};
const key=(kind:Kind,id:string)=>kind+"/"+id;
type Allocator=(minimum:bigint)=>bigint;

export function appendedAssets(doc:Document,other:Document,client:number,allocate:Allocator) {
  const own=doc.variables ?? emptyVariables, incoming=other.variables ?? emptyVariables;
  const here={styles:doc.styles ?? [],collections:own.collections,variables:own.variables};
  const there={styles:other.styles ?? [],collections:incoming.collections,variables:incoming.variables};
  const depends=new Map<string,Set<string>>(), taken=new Set<string>(), linked=new Set<string>(), differs=new Set<string>();
  function depend(dependency:string,consumer:string) {
    let list=depends.get(dependency);
    if (!list) {list=new Set();depends.set(dependency,list);}
    list.add(consumer);
  }
  for (const kind of kinds) {
    const existing=new Map<string,Item>(here[kind].map(v=>[v.id,v] as const));
    const copies=new Set(other.libraryRecords?.[kind]?.map(r=>r.local));
    for (const item of there[kind]) {
      const id=key(kind,item.id),previous=existing.get(item.id);
      if (previous) taken.add(id);
      if (previous && copies.has(item.id)) linked.add(id);
      else if (!sameComponentValue(previous,item)) differs.add(id);
    }
  }
  for (const c of incoming.collections) if (c.extends) depend(key("collections",c.extends),key("collections",c.id));
  for (const v of incoming.variables) {
    const id=key("variables",v.id),coll=key("collections",v.collection);
    depend(id,coll);depend(coll,id);
    if (v.extends) depend(key("variables",v.extends),id);
    for (const value of Object.values(v.values)) for (const ref of references(value)) depend(key("variables",ref),id);
  }
  for (const s of there.styles) for (const v of Object.values(s.bound ?? {})) depend(key("variables",v),key("styles",s.id));
  for (const id of differs) for (const dependent of depends.get(id) ?? []) if (!linked.has(dependent)) differs.add(dependent);

  const ids:Ids={styles:new Map(),collections:new Map(),variables:new Map()};
  for (const kind of kinds) {
    const used=new Set([...here[kind],...there[kind]].map(x=>x.id)), start=prefix[kind];
    let highest=0n, ordinal=here[kind].length+1;
    for (const name of used) {
      if (!name.startsWith(start)) continue;
      const n=name.slice(start.length);
      if (!/^\d{1,20}$/.test(n)) continue;
      const value=BigInt(n);
      if (value<=U64_MAX && (!client || value>>32n===BigInt(client)) && value>highest) highest=value;
    }
    for (const {id} of there[kind]) {
      if (!taken.has(key(kind,id)) || !differs.has(key(kind,id))) continue;
      let fresh:string;
      if (client) {highest=allocate(highest+1n);fresh=start+highest;}
      else if (kind==="styles") {
        while (used.has(start+ordinal)) ordinal++;
        fresh=start+ordinal++;
      } else {
        if (highest===U64_MAX) throw new Error("Document identifiers are exhausted");
        fresh=start+(++highest);
      }
      ids[kind].set(id,fresh);used.add(fresh);
    }
  }
  const rename=(kind:Kind,id:string)=>ids[kind].get(id) ?? id;
  const sources=new Map(incoming.collections.map(c=>[c.id,c]));
  function mode(collection:string,id:string) {
    let c:Collection|undefined=sources.get(collection);
    const seen=new Set<string>();
    while (c && !seen.has(c.id)) {
      if (id.startsWith(c.id+"/mode")) return rename("collections",c.id)+id.slice(c.id.length);
      seen.add(c.id);c=c.extends ? sources.get(c.extends) : undefined;
    }
    return id;
  }
  const vars=(id:string)=>rename("variables",id);
  const bound=(values:Readonly<Record<string,string>>)=>Object.fromEntries(Object.entries(values).map(([k,v])=>[k,vars(v)]));
  const extra=<T extends Item>(here:readonly T[],there:readonly T[],kind:Kind,move:(v:T)=>T)=>{
    const occupied=new Set(here.map(v=>v.id));
    return [...here,...there.filter(v=>!occupied.has(rename(kind,v.id))).map(move)];
  };
  const styles=extra(here.styles,there.styles,"styles",s=>({...s,id:rename("styles",s.id),...(s.bound && {bound:bound(s.bound)})}));
  const collections=extra(own.collections,incoming.collections,"collections",c=>({...c,id:rename("collections",c.id),
    modes:c.modes.map(m=>({...m,id:mode(c.id,m.id)})),...(c.extends && {extends:rename("collections",c.extends)})}));
  const variables=extra(own.variables,incoming.variables,"variables",v=>({...v,id:vars(v.id),collection:rename("collections",v.collection),
    values:Object.fromEntries(Object.entries(v.values).map(([m,value])=>[mode(v.collection,m),remapVariableReferences(value,vars)])),
    ...(v.extends && {extends:vars(v.extends)}),...(v.overrides && {overrides:v.overrides.map(m=>mode(v.collection,m))})}));
  const style=(s:TextStyle)=>s.styleId && ids.styles.has(s.styleId) ? {...s,styleId:ids.styles.get(s.styleId)!} : s;
  const variableCollections=new Map(incoming.variables.map(v=>[v.id,v.collection]));
  function expression(e:PrototypeExpression,depth=0):PrototypeExpression {
    if ("value" in e) return {value:remapVariableReferences(e.value,vars)};
    if ("op" in e) return depth<32 ? {op:{...e.op,args:e.op.args.map(x=>expression(x,depth+1))}} : e;
    if ("mode" in e) return {mode:{collection:rename("collections",e.mode.collection)}};
    const {variable,mode:id}=e.inMode, collection=variableCollections.get(variable);
    return {inMode:{variable:vars(variable),mode:collection ? mode(collection,id) : id}};
  }
  function action(a:PrototypeAction,depth:number):PrototypeAction {
    if (a.type==="setVariable") return {...a,variable:vars(a.variable),...(a.expr && {expr:expression(a.expr)})};
    if (a.type==="setVariableMode") return {...a,collection:rename("collections",a.collection),mode:mode(a.collection,a.mode)};
    if (a.type==="conditional") return {...a,blocks:a.blocks.map(b=>({
      ...(b.condition && {condition:expression(b.condition)}),actions:depth<16 ? b.actions.map(x=>action(x,depth+1)) : b.actions
    }))};
    return a;
  }
  function apply(n:LayerNode):LayerNode {
    if (!ids.styles.size && !ids.collections.size && !ids.variables.size) return n;
    let copy={...n};
    if (n.interactions?.length) copy.interactions=n.interactions.map(i=>({...i,actions:i.actions.map(a=>action(a,0))}));
    if (n.styles) copy.styles=Object.fromEntries(Object.entries(n.styles).map(([k,v])=>[k,v && rename("styles",v)])) as StyleRefs;
    if (n.boundVariables) copy.boundVariables=bound(n.boundVariables);
    if (n.variableModes) copy.variableModes=Object.fromEntries(Object.entries(n.variableModes).map(([c,m])=>[rename("collections",c),mode(c,m)]));
    if (copy.kind==="text") copy={...copy,text:{...copy.text,style:style(copy.text.style),
      runs:copy.text.runs.map(r=>({...r,style:style(r.style)}))}};
    return copy;
  }
  return {styles,variables:{collections,variables},apply};
}
