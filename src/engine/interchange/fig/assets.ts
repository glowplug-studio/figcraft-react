import {compareScalarKeys} from "../../text-breaks";
import {colour, guid, items, num, obj} from "./fields";
import type {KiwiObject, KiwiValue} from "./kiwi";

const noStyle="4294967295:4294967295";
const text=(v:KiwiValue|undefined)=>typeof v==="string" ? v : "";
function version(v:KiwiValue|undefined) {
  const parts=text(v).split(":",2);
  const n=(s:string|undefined)=>s && /^\+?\d{1,20}$/.test(s.trim()) && BigInt(s.trim())<(1n<<64n) ? BigInt(s.trim()) : 0n;
  return (n(parts[0])<<64n)+n(parts[1]);
}
const propFields:Record<string,string>={STROKE_WEIGHT:"strokeWeight",STACK_SPACING:"itemSpacing",STACK_COUNTER_SPACING:"counterAxisSpacing",
  STACK_PADDING_LEFT:"paddingLeft",STACK_PADDING_TOP:"paddingTop",STACK_PADDING_RIGHT:"paddingRight",STACK_PADDING_BOTTOM:"paddingBottom",
  VISIBLE:"visible",TEXT_DATA:"characters",OPACITY:"opacity",MIN_WIDTH:"minWidth",MIN_HEIGHT:"minHeight",MAX_WIDTH:"maxWidth",MAX_HEIGHT:"maxHeight",
  RECTANGLE_TOP_LEFT_CORNER_RADIUS:"topLeftRadius",RECTANGLE_TOP_RIGHT_CORNER_RADIUS:"topRightRadius",
  RECTANGLE_BOTTOM_RIGHT_CORNER_RADIUS:"bottomRightRadius",RECTANGLE_BOTTOM_LEFT_CORNER_RADIUS:"bottomLeftRadius"};
const textFields:Record<string,string>={FONT_SIZE:"fontSize",FONT_FAMILY:"fontFamily",FONT_STYLE:"fontStyle",LETTER_SPACING:"letterSpacing",
  LINE_HEIGHT:"lineHeight",PARAGRAPH_SPACING:"paragraphSpacing",PARAGRAPH_INDENT:"paragraphIndent"};
export class FigAssets {
  readonly #versions=new Map<string,Map<string,string>>();
  readonly #variables=new Map<string,string>();
  readonly #sets=new Map<string,string>();
  readonly #ordered:readonly string[];
  constructor(readonly records:Map<string,KiwiObject>,changes:KiwiValue[]) {
    for (const v of changes) {
      const n=obj(v),id=guid(n.guid),key=text(n.key),ver=text(n.version);
      if (!id || !key || new TextEncoder().encode(key).length>256) continue;
      const versions=this.#versions.get(key) ?? new Map<string,string>();
      const tag=new TextEncoder().encode(ver).length<=256 ? ver : "";
      if (!versions.has(tag)) versions.set(tag,id);
      this.#versions.set(key,versions);
    }
    this.#ordered=[...records.keys()].sort(compareScalarKeys);
    for (const id of this.#ordered) {
      const n=records.get(id)!,key=text(n.key);
      if (!key || n.isSoftDeleted || n.type!=="VARIABLE_SET" && n.type!=="VARIABLE") continue;
      const map=n.type==="VARIABLE" ? this.#variables : this.#sets;
      const prior=map.get(key);
      if (!prior || version(n.version)>=version(records.get(prior)!.version)) map.set(key,id);
    }
  }
  resource(v:KiwiValue|undefined) {
    const r=obj(v),id=guid(r.guid);
    if (id && id!==noStyle && this.records.has(id)) return id;
    const a=obj(r.assetRef), versions=this.#versions.get(text(a.key));
    if (!versions) return;
    return a.version!==undefined ? versions.get(text(a.version)) : versions.get("") ?? (versions.size===1 ? versions.values().next().value : undefined);
  }
  set(v:KiwiValue|undefined) {
    const id=this.resource(v),record=id ? this.records.get(id) : undefined;
    return record ? this.#sets.get(text(record.key)) ?? id : this.#sets.get(text(obj(obj(v).assetRef).key)) ?? id;
  }
  alias=(data:KiwiValue|undefined)=>{
    const binding=obj(data);
    if (binding.dataType!=="ALIAS") return;
    const ref=obj(obj(binding.value).alias),id=guid(ref.guid);
    const record=id && this.records.get(id);
    const target=record && record.type==="VARIABLE" && !record.isSoftDeleted ? this.#variables.get(text(record.key)) ?? id :
      this.#variables.get(text(obj(ref.assetRef).key)) ?? id;
    return target && target!==noStyle ? {type:"VARIABLE_ALIAS",id:target} : undefined;
  };
  bindings(out:Record<string,unknown>,n:KiwiObject,warn:(s:string)=>void) {
    const layer:Record<string,unknown>=Object.create(null),font:Record<string,unknown>=Object.create(null),size:Record<string,unknown>={};
    for (const item of items(obj(n.variableConsumptionMap).entries)) {
      const e=obj(item),a=this.alias(e.variableData),f=text(e.variableField);
      if (!a) continue;
      if (Object.hasOwn(propFields,f)) layer[propFields[f]]=a;
      else if (Object.hasOwn(textFields,f)) font[textFields[f]]=a;
      else if (f==="CORNER_RADIUS") for (const k of ["topLeftRadius","topRightRadius","bottomLeftRadius","bottomRightRadius"]) layer[k]=a;
      else if (f.startsWith("BORDER_")) layer[f==="BORDER_TOP_WEIGHT" ? "strokeTopWeight" : f==="BORDER_RIGHT_WEIGHT" ? "strokeRightWeight" : f==="BORDER_BOTTOM_WEIGHT" ? "strokeBottomWeight" : "strokeLeftWeight"]=a;
      else if (f==="WIDTH" || f==="HEIGHT") {size[f==="WIDTH" ? "x" : "y"]=a;layer.size=size;}
      else warn("variables bound to "+f.toLowerCase().replaceAll("_"," ")+" are not imported from .fig files yet");
    }
    if (Object.keys(layer).length) out.boundVariables=layer;
    if (Object.keys(font).length) out.style={...out.style as object,boundVariables:font};
    const modes:Record<string,string>=Object.create(null);
    let lost=false;
    for (const item of items(obj(n.variableModeBySetMap).entries)) {
      const e=obj(item),mode=guid(e.variableModeID);
      if (!mode) continue;
      const id=this.set(e.variableSetID);
      if (id) modes[id]=mode;
      else if (obj(e.variableSetID).guid || obj(e.variableSetID).assetRef) lost=true;
    }
    if (lost) warn("variable modes of collections that aren't in the file were skipped");
    if (Object.keys(modes).length) out.explicitVariableModes=modes;
  }
  definitions() {
    const byKind=(kind:string,field:string)=>this.#ordered.filter(id=>{const n=this.records.get(id)!;return n.type===kind && !n.isSoftDeleted;})
      .sort((a,b)=>{const pos=(id:string)=>{const v=this.records.get(id)![field];return text(obj(v).position ?? v);};return compareScalarKeys(pos(a),pos(b));});
    const collectionOrder:string[]=[], variableOrder:string[]=[];
    const variableCollections:Record<string,{id:string;name:string;modes:{modeId:string;name:string}[];defaultModeId?:string}>=Object.create(null);
    const extra=new Map<string,{modeId:string;name:string}[]>();
    for (const id of byKind("VARIABLE_SET","parentIndex")) {
      const n=this.records.get(id)!,canonical=this.#sets.get(text(n.key));
      const modes=items(n.variableSetModes).map(obj).sort((a,b)=>compareScalarKeys(text(a.sortPosition),text(b.sortPosition))).flatMap(m=>{
        const modeId=guid(m.id);return modeId ? [{modeId,name:typeof m.name==="string" ? m.name : "Mode"}] : [];
      });
      if (canonical && canonical!==id) {const list=extra.get(canonical) ?? [];for (const m of modes) list.push(m);extra.set(canonical,list);continue;}
      collectionOrder.push(id);
      variableCollections[id]={id,name:typeof n.name==="string" ? n.name : "Collection",modes,defaultModeId:modes[0]?.modeId};
    }
    if (!collectionOrder.length) return;
    for (const [id,modes] of extra) {
      const target=variableCollections[id].modes,seen=new Set(target.map(m=>m.modeId));
      for (const m of modes) if (!seen.has(m.modeId)) {target.push(m);seen.add(m.modeId);}
    }
    const variables:Record<string,unknown>=Object.create(null);
    for (const id of byKind("VARIABLE","sortPosition")) {
      const n=this.records.get(id)!,canonical=this.#variables.get(text(n.key)),set=this.set(n.variableSetID);
      const resolvedType=text(n.variableResolvedType);
      if (canonical && canonical!==id || !set || !variableCollections[set] || !["BOOLEAN","FLOAT","STRING","COLOR"].includes(resolvedType)) continue;
      const valuesByMode:Record<string,unknown>=Object.create(null);
      for (const item of items(obj(n.variableDataValues).entries)) {
        const e=obj(item), mode=guid(e.modeID),v=obj(obj(e.variableData).value);
        const val=this.alias(e.variableData) ?? (v.colorValue ? colour(v.colorValue) : typeof v.boolValue==="boolean" ? v.boolValue : num(v.floatValue) ?? v.textValue);
        if (mode && val!==undefined) valuesByMode[mode]=val;
      }
      variableOrder.push(id);variables[id]={id,name:n.name ?? "Variable",description:n.description ?? "",variableCollectionId:set,resolvedType,valuesByMode,
        scopes:n.variableScopes && items(n.variableScopes).filter(s=>typeof s==="string").map(s=>s==="STROKE" ? "STROKE_COLOR" : s)};
    }
    return {collectionOrder,variableOrder,variableCollections,variables};
  }
}
