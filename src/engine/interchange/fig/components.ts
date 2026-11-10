import {guid,items,num,obj} from "./fields";
import type {KiwiObject,KiwiValue} from "./kiwi";

interface Property {name:string;type:string}
interface Row {data:KiwiObject;level:number;ordinal:number;explicit:boolean}
export interface FigInstance {
  root:string;path:string;main:string;outer?:FigInstance;
  rows:Map<string,Row[]>;props:Map<string,KiwiObject>;slots:Map<string,string>;
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
  constructor(readonly records:Map<string,KiwiObject>,readonly warn:(s:string)=>void) {
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
        out.characters=propText(value); delete out.characterStyleOverrides;delete out.styleOverrideTable;
      }
    }
    out.componentPropertyReferences=refs;
    return {swap,slot};
  }
  override(n:KiwiObject,id:string,instance:FigInstance|undefined) {
    if (!instance) return {node:n,sizeOverride:false};
    const gathered:{row:Row;depth:number}[]=[];
    let path=id,depth=0;
    for (let i:FigInstance|undefined=instance;i;i=i.outer) {
      for (const row of i.rows.get(path) ?? []) gathered.push({row,depth});
      path=i.path.split(";").at(-1)+";"+path;depth++;
    }
    if (!gathered.length) return {node:n,sizeOverride:false};
    gathered.sort((a,b)=>(a.depth-a.row.level)-(b.depth-b.row.level) || a.depth-b.depth || a.row.ordinal-b.row.ordinal);
    const merged={...n};
    for (const {row} of gathered) Object.assign(merged,row.data);
    return {node:merged,sizeOverride:gathered.some(({row})=>row.explicit && row.data.size!==undefined)};
  }
  instance(out:Record<string,unknown>,n:KiwiObject,id:string,restId:string,swap:string|undefined,outer?:FigInstance):FigInstance|undefined {
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
    const rows=new Map<string,Row[]>();let ordinal=0;
    for (const [kind,list] of [sd.symbolOverrides,n.derivedSymbolData].entries()) for (const value of items(list)) {
      const data=obj(value),key=items(obj(data.guidPath).guids).map(guid).filter(Boolean).join(";");
      if (!key || key===main) continue;
      const group=rows.get(key) ?? [];group.push({data,explicit:kind===0,level:Math.max(0,Math.min(256,num(data.overrideLevel) ?? 0)),ordinal:ordinal++});rows.set(key,group);
    }
    return {root:outer?.root ?? restId,path:outer ? (outer.path ? outer.path+";" : "")+id : "",main,rows,outer,props,slots};
  }
}
