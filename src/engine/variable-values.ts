import { colour } from "./colour";
import { parseColour } from "./colour-css";
import { sameComponentValue } from "./component-groups";
import { parseNumber, parseString } from "./parameters";
import { compareScalarKeys } from "./text-breaks";
import { nextVariableId, syncExtensions } from "./variable-collections";
import { ownVariableValue, resolveVariable, variableIndex, type Variable, type Variables, type VariableType, type VariableValue } from "./variables";

export const valueSpecs={
  "variable.create":{label:"Create variable",undo:true},
  "variable.set":{label:"Set variable value",undo:true},
  "variable.resetOverride":{label:"Reset variable override",undo:true},
} as const;

const object=(v:unknown):v is Record<string,unknown>=>typeof v==="object" && v!==null && !Array.isArray(v);
function str(v:unknown) {
  const s=parseString(v);
  if (s===undefined) throw new Error("Expected a string");
  return s;
}
export const variableDefaults:Record<VariableType,VariableValue>={
  color:{type:"color",value:colour(0,0,0)},number:{type:"number",value:0},boolean:{type:"boolean",value:true},string:{type:"string",value:""},
};
function kind(v:unknown):VariableType {
  const s=str(v).toLowerCase();
  if (s==="float") return "number";
  if (s==="bool") return "boolean";
  if (s==="color" || s==="number" || s==="string" || s==="boolean") return s;
  throw new Error("Unknown variable type");
}
export function references(v:VariableValue):readonly string[] {
  switch (v.type) {
    case "alias": return [v.value];
    case "colorAlpha": return [v.value.variable];
    case "colorMix": return [v.value.from,v.value.to].flatMap(op=>"variable" in op ? [op.variable] : []);
    default: return [];
  }
}

function target(data:Variables,name:unknown,type:VariableType,owner:string|undefined) {
  const index=variableIndex(data).variables;
  const v=typeof name==="string" && (index.get(name) ?? data.variables.find(v=>v.name===name));
  if (!v || v.resolvedType!==type) throw new Error("Reference requires an existing "+type+" variable");
  if (owner!==undefined && refersBack(index,v.id,owner)) throw new Error("Variable would refer back to itself");
  return v.id;
}
export function refersBack(index:ReadonlyMap<string,Variable>,target:string,owner:string) {
  const seen=new Set<string>(),stack=[target];
  while (stack.length) {
    const id=stack.pop()!;
    if (id===owner) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    if (seen.size>10000) continue;
    const v=index.get(id);
    if (v) for (const value of Object.values(v.values)) stack.push(...references(value));
  }
  return false;
}
function checked(raw:unknown,keys:readonly string[]) {
  if (!object(raw) || Object.keys(raw).length!==keys.length || keys.some(k=>!Object.hasOwn(raw,k))) throw new Error("Invalid colour expression");
  return raw;
}
function unit(v:unknown) {
  if (typeof v!=="number" || !Number.isFinite(v) || v<0 || v>1) throw new Error("Expected a number between 0 and 1");
  return Math.fround(v || 0);
}
function colorOf(v:unknown) {
  const c=parseColour(v);
  if (!c) throw new Error("Invalid variable colour");
  return c;
}
/** serde_json orders object keys when coercing a non-string value to a string variable. */
function jsonString(v:unknown):string {
  if (Array.isArray(v)) return "["+v.map(jsonString).join(",")+"]";
  if (object(v)) return "{"+Object.keys(v).sort(compareScalarKeys).map(k=>JSON.stringify(k)+":"+jsonString(v[k])).join(",")+"}";
  return JSON.stringify(v);
}
function inputValue(data:Variables,type:VariableType,raw:unknown,owner?:string):VariableValue {
  if (object(raw) && (Object.hasOwn(raw,"alpha") || Object.hasOwn(raw,"mix"))) {
    if (type!=="color" || Object.keys(raw).length!==1) throw new Error("Expected a single colour calculation");
    if (Object.hasOwn(raw,"alpha")) {
      const v=checked(raw.alpha,["variable","opacity"]);
      return Object.freeze({type:"colorAlpha",value:Object.freeze({opacity:unit(v.opacity),variable:target(data,v.variable,"color",owner)})});
    }
    const v=checked(raw.mix,["from","to","t"]);
    function operand(op:unknown) {
      if (object(op) && Object.hasOwn(op,"variable")) return Object.freeze({variable:target(data,checked(op,["variable"]).variable,"color",owner)});
      return Object.freeze({literal:colorOf(checked(op,["literal"]).literal)});
    }
    return Object.freeze({type:"colorMix",value:Object.freeze({t:unit(v.t),from:operand(v.from),to:operand(v.to)})});
  }
  if (object(raw) && typeof raw.alias==="string") return Object.freeze({type:"alias",value:raw.alias});
  switch (type) {
    case "color": return Object.freeze({type,value:colorOf(raw)});
    case "number": return Object.freeze({type,value:parseNumber(raw)});
    case "string": return Object.freeze({type,value:typeof raw==="string" ? raw : jsonString(raw)});
    case "boolean":
      if (typeof raw!=="boolean") throw new Error("Expected a boolean variable value");
      return Object.freeze({type,value:raw});
  }
}
export function editVariableValue(data:Variables,command:string,p:Record<string,unknown>, allocate?: () => bigint) {
  const create=command==="variable.create", reset=command==="variable.resetOverride";
  const allowed=create ? ["name","collection","type","values","value","description"] : reset ? ["variable","mode"] : ["variable","mode","value"];
  for (const k of Object.keys(p)) if (!allowed.includes(k)) throw new Error("Unknown "+command+" parameter "+k);
  const index=variableIndex(data);
  let original:Variable|undefined;
  if (!create) {
    const key=str(p.variable);
    original=index.variables.get(key) ?? data.variables.find(v=>v.name===key);
    if (!original) throw new Error("No such variable");
  }
  const cid=original?.collection ?? str(p.collection);
  const coll=index.collections.get(cid) ?? (create && data.collections.find(c=>c.name===cid));
  if (!coll) throw new Error("No such collection");
  const type=original?.resolvedType ?? kind(p.type);
  const values:Record<string,VariableValue>=Object.assign(Object.create(null),original?.values);
  let overrides=original?.overrides;
  const verify=(value:VariableValue,mode:string):VariableValue=>{
    if (value.type==="alias") return Object.freeze({type:"alias",value:target(data,value.value,type,original?.id)});
    if ((value.type==="colorAlpha" || value.type==="colorMix") && !resolveVariable(data,original?.id ?? "",{[coll.id]:mode},value))
      throw new Error("The colour calculation could not be resolved within 32 variables");
    return value;
  };
  if (create) {
    if (object(p.values)) for (const k of Object.keys(p.values).sort(compareScalarKeys)) {
      const m=coll.modes.find(m=>m.id===k || m.name===k);
      if (!m) throw new Error("No such mode");
      values[m.id]=inputValue(data,type,p.values[k]);
    }
    const fallback=p.value==null ? Object.freeze(variableDefaults[type]) : inputValue(data,type,p.value);
    for (const m of coll.modes) if (!Object.hasOwn(values,m.id)) values[m.id]=fallback;
    for (const [mode,v] of Object.entries(values)) values[mode]=verify(v,mode);
  } else {
    const key=parseString(p.mode);
    const mode=key===undefined ? coll.modes[0] : coll.modes.find(m=>m.id===key) ?? coll.modes.find(m=>m.name===key);
    if (!mode && (!reset || key!==undefined)) throw new Error("No such mode");
    const inherited=new Set(overrides);
    if (reset) {
      const parent=original?.extends!==undefined && index.variables.get(original.extends);
      if (!parent) throw new Error("Only inherited variables have overrides");
      for (const id of key===undefined ? [...inherited] : [mode!.id]) {
        inherited.delete(id);
        const value=ownVariableValue(parent.values,id);
        if (value) values[id]=value;
      }
    } else {
      if (p.value==null) throw new Error("A variable value is required");
      values[mode!.id]=verify(inputValue(data,type,p.value,original!.id),mode!.id);
      if (original!.extends!==undefined) inherited.add(mode!.id);
    }
    overrides=inherited.size ? Object.freeze([...inherited].sort(compareScalarKeys)) : undefined;
  }
  const id=original?.id ?? (allocate ? "VariableID:" + allocate() : nextVariableId(data.variables,"VariableID:"));
  const {overrides:previous,...base}=original ?? {id,name:str(p.name),resolvedType:type,collection:coll.id,description:parseString(p.description) ?? ""};
  const next:Variable=Object.freeze({...base,values:Object.freeze(values),...(overrides && {overrides})});
  const result=create ? {id} : {ok:true};
  if (original && sameComponentValue(original,next)) return {data,result};
  const variables=original ? data.variables.map(v=>v===original ? next : v) : [...data.variables,next];
  return {data:syncExtensions(Object.freeze({...data,variables:Object.freeze(variables)}), allocate), result};
}
