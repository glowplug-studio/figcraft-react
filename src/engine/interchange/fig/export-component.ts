import {isLosslessNumber} from "lossless-json";
import {sameComponentValue} from "../../component-groups";
import {orderedComponentPropertyNames,type ComponentProperty} from "../../component-properties";
import {variantPairs} from "../../component-variants";
import type {ComponentNode,ComponentSetNode,Document,InstanceNode,LayerNode} from "../../document";
import {ancestors} from "../../hierarchy";
import {compareScalarKeys} from "../../text-breaks";
import {figGuid} from "./export-layout";
import type {KiwiObject} from "./kiwi";

type PropType="BOOL"|"TEXT"|"INSTANCE_SWAP"|"VARIANT";
const propType=(d:ComponentProperty)=>d.type==="boolean" ? "BOOL" : d.type==="text" ? "TEXT" : d.type==="instanceSwap" ? "INSTANCE_SWAP" : undefined;
const aux=(id:number)=>figGuid(id,2);
const position=(i:number)=>(i>=93 ? "~" : "")+String.fromCharCode(34+i%93);
const defKey=(owner:string,name:string,type:PropType)=>JSON.stringify([owner,name,type]);
const propertyNames=(n:ComponentNode)=>Object.keys(n.props).sort(compareScalarKeys);
function valueOf(type:PropType,value:string|boolean|KiwiObject) {
  let initial:KiwiObject,encoded:KiwiObject,tag:string;
  switch (type) {
    case "BOOL":initial=encoded={boolValue:value};tag="BOOLEAN";break;
    case "INSTANCE_SWAP":initial={guidValue:value};encoded={symbolIdValue:{guid:value}};tag="SYMBOL_ID";break;
    case "VARIANT":initial={};encoded={textValue:""};tag="STRING";break;
    case "TEXT":{
      const characters=String(value),lines=characters.split("\n").map(()=>({lineType:"PLAIN",styleId:0,indentationLevel:0,
        sourceDirectionality:"AUTO",listStartOffset:0,isFirstLineOfList:false}));
      const text={characters,lines};
      initial={textValue:text};encoded={textDataValue:text};tag="TEXT_DATA";break;
    }
  }
  return {initial,varValue:{dataType:tag,resolvedDataType:tag,value:encoded}};
}

export class FigComponentProperties {
  readonly #defs=new Map<string,number>();
  readonly #children=new Map<string,number>();
  constructor(readonly doc:Document,readonly ids:Map<string,number>,readonly allocate:()=>number,readonly warn:(s:string)=>void) {
    for (const id of ids.keys()) {
      const n=doc.nodes[id];
      if (n.kind!=="component") continue;
      const set=this.#set(n),owner=set?.id ?? id;
      for (const name of propertyNames(n)) {
        const type=propType(n.props[name]);
        if (!type) continue;
        this.#reserve(owner,name,type);
        if (set) this.#children.set(defKey(id,name,type),allocate());
      }
      if (set) for (const [name] of variantPairs(n.name)) if (name) this.#reserve(owner,name,"VARIANT");
    }
  }
  #set(n:ComponentNode) {
    const parent=this.doc.nodes[n.parent];
    return parent?.kind==="componentSet" ? parent : undefined;
  }
  #reserve(owner:string,name:string,type:PropType) {
    const k=defKey(owner,name,type);
    if (!this.#defs.has(k)) this.#defs.set(k,this.allocate());
  }
  #local(owner:string,name:string,type:PropType) {
    const k=defKey(owner,name,type);
    return this.#children.get(k) ?? this.#defs.get(k);
  }
  #definition(owner:string,name:string,d:ComponentProperty,index:number) {
    const type=propType(d);
    if (!type || d.type==="slot") return;
    const id=this.#defs.get(defKey(owner,name,type));
    if (!id) return;
    let value:string|boolean|KiwiObject=d.default;
    if (d.type==="instanceSwap") {
      if (d.preferred.length) this.warn("preferred values of instance swap properties were left out");
      const target=this.ids.get(d.default);
      if (!target) return;
      value=figGuid(target);
    }
    const {initial,varValue}=valueOf(type,value);
    return {id:aux(id),name,initialValue:initial,sortPosition:position(index),type,preferredValues:{},varValue};
  }
  #setDefinitions(out:KiwiObject,set:ComponentSetNode) {
    const variants=set.children.map(id=>this.doc.nodes[id]).filter((n):n is ComponentNode=>n?.kind==="component");
    const order=new Map<string,Set<string>>();
    for (const n of variants) for (const [name,value] of variantPairs(n.name)) {
      if (!name) continue;
      const values=order.get(name) ?? new Set<string>();
      values.add(value);order.set(name,values);
    }
    const defs:KiwiObject[]=[];
    for (const name of order.keys()) {
      const id=this.#defs.get(defKey(set.id,name,"VARIANT"));
      if (id) defs.push({id:aux(id),name,type:"VARIANT",initialValue:{},preferredValues:{},sortPosition:position(defs.length),varValue:valueOf("VARIANT","").varValue});
    }
    const seen=new Map<string,ComponentProperty>();
    for (const n of variants) for (const name of orderedComponentPropertyNames(n.props,n.propOrder)) {
      const d=n.props[name],type=propType(d);
      if (!type) continue;
      const key=defKey(set.id,name,type),existing=seen.get(key);
      if (existing) {if (!sameComponentValue(existing,d)) this.warn("variants with different defaults for one property were written with the first variant's");continue;}
      seen.set(key,d);
      const row=this.#definition(set.id,name,d,defs.length);
      if (row) defs.push(row);
    }
    if (defs.length) out.componentPropDefs=defs;
    if (order.size) out.stateGroupPropertyValueOrders=Array.from(order,([property,values])=>({property,values:[...values]}));
  }
  definitions(out:KiwiObject,n:LayerNode) {
    if (n.kind==="componentSet") return this.#setDefinitions(out,n);
    if (n.kind!=="component") return;
    const set=this.#set(n),defs:KiwiObject[]=[];
    if (set) {
      for (const name of propertyNames(n)) {
        const type=propType(n.props[name]);
        if (!type) continue;
        const child=this.#local(n.id,name,type),parent=this.#local(set.id,name,type);
        if (child && parent) defs.push({id:aux(child),parentPropDefId:aux(parent)});
      }
      const specs=variantPairs(n.name).flatMap(([name,value])=>{
        const id=this.#local(set.id,name,"VARIANT");return id ? [{propDefId:aux(id),value}] : [];
      });
      if (specs.length) out.variantPropSpecs=specs;
    } else for (const [i,name] of orderedComponentPropertyNames(n.props,n.propOrder).entries()) {
      const row=this.#definition(n.id,name,n.props[name],i);
      if (row) defs.push(row);
    }
    if (defs.length) out.componentPropDefs=defs;
    if (Object.values(n.props).some(p=>p.type==="slot")) this.warn("slot properties were left out");
  }
  references(out:KiwiObject,n:LayerNode) {
    if (!n.propRefs) return;
    let source=n;
    for (let i=0;i<256 && source.source && ancestors(this.doc,source.id).some(a=>this.doc.nodes[a].kind==="instance");i++) {
      const next=this.doc.nodes[source.source];
      if (!next || next.kind==="page" || next.id===source.id) break;
      source=next;
    }
    const owner=[source.id,...ancestors(this.doc,source.id)].find(id=>this.doc.nodes[id].kind==="component");
    const entries:KiwiObject[]=[],refs:KiwiObject[]=[];
    for (const [field,name] of Object.entries(n.propRefs)) {
      let type:PropType,variableField:string,resolvedDataType:string;
      switch (field) {
        case "visible":type="BOOL";variableField="VISIBLE";resolvedDataType="BOOLEAN";break;
        case "characters":type="TEXT";variableField="TEXT_DATA";resolvedDataType="TEXT_DATA";break;
        case "mainComponent":type="INSTANCE_SWAP";variableField="OVERRIDDEN_SYMBOL_ID";resolvedDataType="SYMBOL_ID";break;
        default:this.warn("slot layers were written as plain layers");continue;
      }
      const id=owner && this.#local(owner,name,type);
      if (!id) continue;
      const defID=aux(id);
      refs.push({defID,componentPropNodeField:variableField});
      entries.push({variableField,variableData:{value:{propRefValue:{defId:defID}},dataType:"PROP_REF",resolvedDataType}});
    }
    if (entries.length) {out.parameterConsumptionMap={entries};out.componentPropRefs=refs;}
  }
  assignments(out:KiwiObject,n:InstanceNode) {
    const assignments=[];
    for (const name of Object.keys(n.props).sort(compareScalarKeys)) {
      const value=n.props[name];
      let type:PropType,arg:string|boolean|KiwiObject;
      if (typeof value==="boolean") {type="BOOL";arg=value;}
      else if (typeof value==="string") {type="TEXT";arg=value;}
      else if (typeof value==="number" || isLosslessNumber(value)) {
        const local=this.ids.get(String(value));
        if (!local) continue;
        type="INSTANCE_SWAP";arg=figGuid(local);
      } else continue;
      const id=this.#local(n.component,name,type);
      if (!id) continue;
      const {initial,varValue}=valueOf(type,arg);
      assignments.push({defID:aux(id),value:initial,varValue});
    }
    if (assignments.length) out.componentPropAssignments=assignments;
  }
}
