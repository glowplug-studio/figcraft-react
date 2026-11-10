import {guid,items,num,obj} from "./fields";
import {figLineStarts} from "../rest/text";
import {scaledRecord} from "./instance-geometry";
import type {KiwiObject,KiwiValue} from "./kiwi";

interface Property {name:string;type:string}
interface Row {data:KiwiObject;level:number;ordinal:number;explicit:boolean; stale:boolean; scale:number; depth:number}
interface RowTree {rows:Row[]; children:Map<string,RowTree>}
const tree=():RowTree=>({rows:[],children:new Map()});
export interface FigInstance {
  root:string;path:string;main:string;outer?:FigInstance;
  trees:RowTree[];scale:number;depth:number;props:Map<string,KiwiObject>;slots:Map<string,string>;
}
const propText=(v:KiwiObject)=>obj(v.textValue ?? v.textDataValue).characters;
const propGuid=(v:KiwiObject)=>guid(v.guidValue) ?? guid(obj(v.symbolIdValue).guid);
const fields:Record<string,string>={VISIBLE:"visible",TEXT_DATA:"characters",OVERRIDDEN_SYMBOL_ID:"mainComponent",SLOT_CONTENT_ID:"slot"};
function property(instance:FigInstance|undefined,id:string) {
  let found:KiwiObject|undefined;
  for (let i=instance;i;i=i.outer) found=i.props.get(id) ?? found;
  return found;
}
export class FigComponents {
  readonly #properties=new Map<string,Property>();
  readonly #parents=new Map<string,string>();
  readonly components:Record<string,unknown>=Object.create(null);
  readonly sets:Record<string,unknown>=Object.create(null);
  readonly hasAliases:boolean;
  constructor(readonly records:Map<string,KiwiObject>,readonly warn:(s:string)=>void,readonly children:Map<string,{id:string}[]>,readonly limit:number) {
    this.hasAliases=[...records.values()].some(n=>n.overrideKey!==undefined);
    for (const n of records.values()) for (const value of items(n.componentPropDefs)) {
      const d=obj(value),id=guid(d.id);
      if (!id) continue;
      if (typeof d.name==="string" && typeof d.type==="string") this.#properties.set(id,{name:d.name+"#"+id,type:d.type});
      else {const parent=guid(d.parentPropDefId);if (parent) this.#parents.set(id,parent);}
    }
  }
  #root(id:string) {
    const seen=new Set<string>();
    while (this.#parents.has(id) && !seen.has(id) && seen.size<256) {seen.add(id);id=this.#parents.get(id)!;}
    return id;
  }
  isSwap(id:KiwiValue|undefined) {
    const key=guid(id);
    return !!key && this.#properties.get(this.#root(key))?.type==="INSTANCE_SWAP";
  }
  definition(out:Record<string,unknown>,n:KiwiObject,id:string) {
    const defs:Record<string,unknown>=Object.create(null);
    for (const value of items(n.componentPropDefs)) {
      const d=obj(value), key=guid(d.id), p=key && this.#properties.get(key);
      if (!p || d.isDeleted) continue;
      const init=obj(d.initialValue);
      switch (p.type) {
        case "BOOL": defs[p.name]={type:"BOOLEAN",defaultValue:typeof init.boolValue==="boolean" ? init.boolValue : true};break;
        case "TEXT": defs[p.name]={type:"TEXT",defaultValue:propText(init) ?? ""};break;
        case "INSTANCE_SWAP": {const target=guid(init.guidValue);if (target) defs[p.name]={type:"INSTANCE_SWAP",defaultValue:target};break;}
        case "VARIANT": defs[p.name]={type:"VARIANT"};break;
        case "SLOT": {
          defs[p.name]={type:"SLOT"};
          const config=obj(d.slotPropConfig);
          if (["stretchChildOnInsert","displayByDefault","allowPreferredValuesOnly"].some(k=>config[k]!==undefined && config[k]!==false) ||
              ["minChildren","maxChildren"].some(k=>config[k]!==undefined && num(config[k])!==0)) this.warn("non-default slot settings are not represented and were skipped");
          if (items(obj(d.preferredValues).instanceSwapValues).length) this.warn("preferred slot component keys cannot be resolved to file nodes and were skipped");
          break;
        }
        default: this.warn(p.type.toLowerCase()+" component properties are not supported and were skipped");
      }
    }
    out.componentPropertyDefinitions=defs;
    const description=n.symbolDescription ?? n.description;
    if (typeof description==="string" && description) (out.type==="COMPONENT_SET" ? this.sets : this.components)[id]={description};
  }
  references(out:Record<string,unknown>,n:KiwiObject,instance?:FigInstance) {
    const refs:Record<string,string>=Object.create(null);
    let swap:string|undefined,slot:string|undefined;
    for (const v of items(obj(n.parameterConsumptionMap).entries)) {
      const e=obj(v),field=fields[String(e.variableField ?? "")],ref=obj(obj(e.variableData).value).propRefValue;
      const key=guid(obj(ref).defId);
      if (!key || typeof field!=="string") continue;
      const root=this.#root(key), p=this.#properties.get(root);
      if (p && (field!=="slot" || !instance)) refs[field]=p.name;
      if (field==="slot") for (let i=instance;i;i=i.outer) slot=i.slots.get(root) ?? slot;
      const value=property(instance,root);
      if (!value) continue;
      if (field==="mainComponent") swap=propGuid(value);
      if (field==="visible" && typeof value.boolValue==="boolean") out.visible=value.boolValue;
      if (field==="characters" && typeof propText(value)==="string" && propText(value)!==out.characters) {
        out.characters=propText(value);delete (out as Record<PropertyKey,unknown>)[figLineStarts]; delete out.characterStyleOverrides;delete out.styleOverrideTable;
      }
    }
    out.componentPropertyReferences=refs;
    return {swap,slot};
  }
  readonly #aliasScopes=new Map<string,Map<string,string>>();
  #aliasEntries=0;
  #aliases(main:string) {
    const cached=this.#aliasScopes.get(main);
    if (cached) return cached;
    const pending=(this.children.get(main) ?? []).map(c=>({id:c.id,depth:1})),current=new Set<string>(),aliases=new Map<string,string>();
    while (pending.length) {
      const {id,depth}=pending.pop()!;
      if (depth>256 || current.size>=this.limit) {aliases.clear();break;}
      if (current.has(id)) continue;
      current.add(id);
      const record=this.records.get(id)!,alias=guid(record.overrideKey);
      if (alias) aliases.set(alias,aliases.has(alias) ? "" : id);
      if (record.type!=="INSTANCE") for (const c of this.children.get(id) ?? []) pending.push({id:c.id,depth:depth+1});
    }
    const byId=new Map<string,string>();
    for (const [alias,id] of aliases) if (id && !current.has(alias)) byId.set(id,alias);
    if (this.#aliasEntries+byId.size<=this.limit) {
      this.#aliasScopes.set(main,byId);
      this.#aliasEntries+=byId.size;
    }
    return byId;
  }
  #subtrees(id:string,instance?:FigInstance) {
    if (!instance?.trees.length) return [];
    const alias=this.hasAliases ? this.#aliases(instance.main).get(id) : undefined;
    const result:RowTree[]=[];
    for (const tree of instance.trees) {
      const current=tree.children.get(id),old=alias && tree.children.get(alias);
      if (current) result.push(current);
      if (old) result.push(old);
    }
    return result;
  }
  override(n:KiwiObject,id:string,instance:FigInstance|undefined) {
    const scale=instance?.scale ?? 1,base=scaledRecord(n,scale);
    const rows=this.#subtrees(id,instance).flatMap(t=>t.rows).sort((a,b)=>
      (b.depth+b.level)-(a.depth+a.level) || b.depth-a.depth || a.ordinal-b.ordinal);
    const sources=new Map<string,number>();
    const node=rows.length ? {...base} : base;
    let currentTextLayout=true;
    let sizeOverride=false,hasSize=false,hasTransform=false,derived=false;
    for (const row of rows) {
      if (row.data.textData!==undefined) currentTextLayout=false;
      if (row.data.derivedTextData!==undefined) currentTextLayout=true;
      for (const [key,value] of Object.entries(scaledRecord(row.data,row.scale))) {
        if (row.stale && (key==="size" || key==="transform")) continue;
        node[key]=value;sources.set(key,row.scale);
      }
      if (row.stale) continue;
      hasSize ||= row.data.size!==undefined;
      hasTransform ||= row.data.transform!==undefined;
      sizeOverride ||= row.explicit && row.data.size!==undefined;
      derived ||= !row.explicit && (row.data.size!==undefined || row.data.transform!==undefined);
    }
    return {node,base,sizeOverride,hasSize,hasTransform,derived,currentTextLayout,scaleOf:(key:string)=>sources.get(key) ?? scale};
  }
  instance(out:Record<string,unknown>,n:KiwiObject,id:string,restId:string,swap:string|undefined,scaleOf:(key:string)=>number,outer?:FigInstance):FigInstance|undefined {
    const sd=obj(n.symbolData), main=swap ?? guid(n.overriddenSymbolID) ?? guid(sd.symbolID);
    if (!main) {this.warn("instances without a main component were imported as empty frames");return;}
    out.componentId=main;
    const props=new Map<string,KiwiObject>(), slots=new Map<string,string>(), result:Record<string,unknown>=Object.create(null);
    for (const v of items(n.componentPropAssignments)) {
      const a=obj(v),def=guid(a.defID);
      if (!def) continue;
      const root=this.#root(def),p=this.#properties.get(root);
      const val=Object.keys(obj(a.value)).length ? obj(a.value) : obj(obj(a.varValue).value);
      if (!props.has(root)) props.set(root,val);
      if (!p) continue;
      if (p.type==="BOOL" && typeof val.boolValue==="boolean") result[p.name]={type:"BOOLEAN",value:val.boolValue};
      if (p.type==="TEXT" && typeof propText(val)==="string") result[p.name]={type:"TEXT",value:propText(val)};
      if (p.type==="INSTANCE_SWAP" && propGuid(val)) result[p.name]={type:"INSTANCE_SWAP",value:propGuid(val)};
      if (p.type==="SLOT") {
        const target=guid(obj(obj(obj(a.varValue).value).slotContentIdValue).guid);
        if (obj(a.varValue).dataType!=="SLOT_CONTENT_ID" || !target) this.warn("malformed slot content assignment was skipped");
        else if (target==="4294967295:4294967295") this.warn("slot content assignment uses the empty GUID sentinel and was skipped");
        else if (!this.records.get(target)?.isSlotContent) this.warn("slot content assignment target is missing or is not slot content");
        else if (!slots.has(root)) slots.set(root,target);
      }
    }
    out.componentProperties=result;
    if (!this.records.has(main)) {this.warn("instances of components that aren't in the file show no layers");return;}
    for (let i=outer;i;i=i.outer) if (i.main===main) return;
    const root=tree(), depth=(outer?.depth ?? -1)+1;
    const base=obj(this.records.get(id)?.size),actual=obj(n.size),ambient=outer?.scale ?? 1;
    const tolerance=ambient===1 ? 1e-6 : 1e-4;
    const resized=!!outer && ["x","y"].some(axis=>{
      const raw=num(base[axis]),b=num(actual[axis]);
      if (raw===undefined || b===undefined) return raw!==b;
      const a=raw*ambient;
      return Math.abs(a-b)>tolerance*Math.max(Math.abs(a),Math.abs(b),1);
    });
    let ordinal=0;
    for (const [kind,list] of [sd.symbolOverrides,n.derivedSymbolData].entries()) for (const value of items(list)) {
      const data=obj(value),path=items(obj(data.guidPath).guids).map(guid).filter((v):v is string=>v!==undefined);
      if (!path.length || path.length>256 || path.length===1 && path[0]===main) continue;
      let branch=root;
      for (const key of path) {
        let child=branch.children.get(key);
        if (!child) {child=tree();branch.children.set(key,child);}
        branch=child;
      }
      branch.rows.push({data,explicit:kind===0,stale:kind===1 && resized,level:Math.max(0,Math.min(256,Math.trunc(num(data.overrideLevel) ?? 0))),
        ordinal:ordinal++,scale:scaleOf(kind===0 ? "symbolData" : "derivedSymbolData"),depth});
    }
    const trees=this.#subtrees(id,outer).filter(t=>t.children.size);
    if (root.children.size) trees.push(root);
    const factor=num(sd.uniformScaleFactor) ?? 1;
    const scale=Math.max(.001,Math.min(1000,ambient*(factor>=.001 && factor<=1000 ? factor : 1)));
    return {root:outer?.root ?? restId,path:outer ? (outer.path ? outer.path+";" : "")+id : "",main,scale,depth,trees,outer,props,slots};
  }
}
