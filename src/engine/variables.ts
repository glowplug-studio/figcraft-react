import { colour, withAlpha, type Colour } from "./colour";
import { parseColour } from "./colour-css";
import { appearanceValue, fail, number } from "./native-values";
import { compareScalarKeys } from "./text-breaks";
import { textBool, textEnum, textRecord, textString } from "./text-style";

const kinds = ["color","number","string","boolean"] as const;
export type VariableType = typeof kinds[number];
type Literal = {type:"color";value:Colour} | {type:"number";value:number} | {type:"string";value:string} | {type:"boolean";value:boolean};
type Operand = Readonly<{variable:string} | {literal:Colour}>;
export type VariableValue = Readonly<Literal | {type:"alias";value:string} |
  {type:"colorAlpha";value:Readonly<{variable:string;opacity:number}>} |
  {type:"colorMix";value:Readonly<{from:Operand;to:Operand;t:number}>}>;
export type Mode = Readonly<{id:string;name:string}>;
export interface Collection extends Mode { readonly modes:readonly Mode[]; readonly extends?:string }
export interface Variable extends Mode {
  readonly collection:string; readonly resolvedType:VariableType; readonly values:Readonly<Record<string,VariableValue>>;
  readonly description:string; readonly scopes?:readonly string[]; readonly hiddenFromPublishing?:true;
  readonly extends?:string; readonly overrides?:readonly string[]; readonly codeSyntax?:Readonly<Record<string,string>>;
}
export function inVariableScope(scopes:readonly string[]|undefined,scope:string) {
  return scopes===undefined || scopes.includes(scope) || scopes.includes("ALL_SCOPES") || scopes.includes("ALL_FILLS") && scope.endsWith("_FILL");
}
export interface Variables {readonly collections:readonly Collection[]; readonly variables:readonly Variable[]}
export const emptyVariables:Variables = Object.freeze({collections:Object.freeze([]),variables:Object.freeze([])});

function fields(raw:unknown, allowed:readonly string[]) {
  const value=textRecord(raw,"variable record");
  for (const key of Object.keys(value)) if (!allowed.includes(key)) fail("unsupported variable property "+key);
  return value;
}
function list<T>(raw:unknown, read:(v:unknown)=>T):readonly T[] {
  if (!Array.isArray(raw)) fail("expected a variable record list");
  return Object.freeze(raw.map(read));
}
function mapValues<T>(raw:unknown, read:(v:unknown)=>T):Readonly<Record<string,T>> {
  const value=textRecord(raw,"variable value map");
  return Object.freeze(Object.fromEntries(Object.keys(value).sort(compareScalarKeys).map(k=>[k,read(value[k])])));
}
const string = (v:unknown)=>textString(v,"variable string");
const identity = (v:Record<string,unknown>)=>({id:string(v.id),name:string(v.name)});
function readColour(v:unknown) {
  const c=parseColour(appearanceValue(v));
  if (!c) fail("invalid variable colour");
  return c;
}
function operand(raw:unknown):Operand {
  const v=fields(raw,["variable","literal"]);
  if (Object.hasOwn(v,"variable") && !Object.hasOwn(v,"literal")) return Object.freeze({variable:string(v.variable)});
  if (Object.hasOwn(v,"literal") && !Object.hasOwn(v,"variable")) return Object.freeze({literal:readColour(v.literal)});
  return fail("invalid variable colour operand");
}
export function readVariableValue(raw:unknown):VariableValue {
  const v=fields(raw,["type","value"]), type=textEnum(v.type,[...kinds,"alias","colorAlpha","colorMix"],"variable value type");
  switch(type) {
    case "color": return Object.freeze({type,value:readColour(v.value)});
    case "boolean": return Object.freeze({type,value:textBool(v.value,"variable boolean")});
    case "number": return Object.freeze({type,value:number(v.value,"variable number")});
    case "string": case "alias": return Object.freeze({type,value:string(v.value)});
    case "colorAlpha": {
      const x=fields(v.value,["variable","opacity"]);
      return Object.freeze({type,value:Object.freeze({variable:string(x.variable),opacity:Math.fround(number(x.opacity,"variable alpha"))})});
    }
    case "colorMix": {
      const x=fields(v.value,["from","to","t"]);
      return Object.freeze({type,value:Object.freeze({from:operand(x.from),to:operand(x.to),t:Math.fround(number(x.t,"mix weight"))})});
    }
  }
}
function readVariable(raw:unknown):Variable {
  const v=fields(raw,["id","name","collection","resolvedType","values","description","scopes","hiddenFromPublishing","extends","overrides","codeSyntax"]);
  const overrides=v.overrides===undefined ? [] : [...new Set(list(v.overrides,string))].sort(compareScalarKeys);
  const syntax=v.codeSyntax===undefined ? undefined : mapValues(v.codeSyntax,string);
  return Object.freeze({...identity(v),collection:string(v.collection),resolvedType:textEnum(v.resolvedType,kinds,"variable type"),
    values:mapValues(v.values,readVariableValue),description:v.description===undefined ? "" : string(v.description),
    ...(v.extends!=null && {extends:string(v.extends)}),...(v.scopes!=null && {scopes:list(v.scopes,string)}),
    ...(v.hiddenFromPublishing!==undefined && textBool(v.hiddenFromPublishing,"publishing flag") && {hiddenFromPublishing:true as const}),
    ...(overrides.length>0 && {overrides:Object.freeze(overrides)}),...(syntax && Object.keys(syntax).length>0 && {codeSyntax:syntax})});
}
export function readVariables(raw:unknown):Variables {
  const record=fields(raw,["collections","variables"]);
  const collections=list(record.collections===undefined ? [] : record.collections,entry=>{
    const v=fields(entry,["id","name","modes","extends"]);
    return Object.freeze({...identity(v),modes:list(v.modes,m=>Object.freeze(identity(fields(m,["id","name"])))),
      ...(v.extends!=null && {extends:string(v.extends)})});
  });
  const variables=list(record.variables===undefined ? [] : record.variables,readVariable);
  return collections.length || variables.length ? Object.freeze({collections,variables}) : emptyVariables;
}

export const ownVariableValue = <T,>(map:Readonly<Record<string,T>>,key:string) => Object.hasOwn(map,key) ? map[key] : undefined;
const f32=Math.fround;
function mix(a:Colour,b:Colour,weight:number):Colour {
  const t=Number.isFinite(weight) ? Math.max(0,Math.min(1,weight)) : 0, inv=f32(1-t);
  const ch=(x:number,y:number)=>f32(f32(x*inv)+f32(y*t));
  return colour(ch(a.r,b.r),ch(a.g,b.g),ch(a.b,b.b),ch(a.a,b.a));
}

function byId<T extends Mode>(values:readonly T[]) {
  const map=new Map<string,T>();
  for (const value of values) if (!map.has(value.id)) map.set(value.id,value);
  return map;
}
const indexes=new WeakMap<Variables,{variables:Map<string,Variable>;collections:Map<string,Collection>}>();
export function variableIndex(data:Variables) {
  let index=indexes.get(data);
  if (!index) {index={variables:byId(data.variables),collections:byId(data.collections)}; indexes.set(data,index);}
  return index;
}

/** Each root resolution has its own 32-variable budget, including failed or in-flight references. */
export function resolveVariable(data:Variables,id:string,modes:Readonly<Record<string,string>>={}, proposed?:VariableValue):Readonly<Literal>|undefined {
  const index=variableIndex(data);
  const done=new Map<string,Readonly<Literal>|undefined>();
  function read(key:string):Readonly<Literal>|undefined {
    if (done.has(key)) return done.get(key);
    if (done.size >= 32) return;
    done.set(key,undefined);
    let stored=key===id ? proposed : undefined;
    if (!stored) {
      const v=index.variables.get(key);
      const c=v && index.collections.get(v.collection);
      if (!v || !c) return;
      const chosen=ownVariableValue(modes,c.id);
      const mode=chosen!==undefined && Object.hasOwn(v.values,chosen) ? chosen : c.modes[0]?.id;
      if (mode===undefined) return;
      stored=ownVariableValue(v.values,mode) ?? v.values[Object.keys(v.values).sort(compareScalarKeys)[0]];
    }
    if (!stored) return;
    let out:Readonly<Literal>|undefined;
    if (stored.type==="alias") out=read(stored.value);
    else if (stored.type==="colorAlpha") {
      const base=read(stored.value.variable);
      if (base?.type==="color") out={type:"color",value:withAlpha(base.value,stored.value.opacity)};
    } else if (stored.type==="colorMix") {
      const resolveColour=(op:Operand)=>{
        if ("literal" in op) return op.literal;
        const value=read(op.variable);
        return value?.type==="color" ? value.value : undefined;
      };
      const a=resolveColour(stored.value.from), b=a && resolveColour(stored.value.to);
      if (a && b) out={type:"color",value:mix(a,b,stored.value.t)};
    } else out=stored;
    done.set(key,out);
    return out;
  }
  return read(id);
}

export function convertVariableColours(data:Variables,convert:(c:Colour)=>Colour):Variables {
  const convertOperand=(op:Operand)=>"literal" in op ? Object.freeze({literal:convert(op.literal)}) : op;
  const variables=data.variables.map(v=>{
    const values=Object.entries(v.values).map(([mode,value])=>{
      if (value.type==="color") return [mode,Object.freeze({...value,value:convert(value.value)})];
      if (value.type==="colorMix") return [mode,Object.freeze({...value,value:Object.freeze({...value.value,
        from:convertOperand(value.value.from),to:convertOperand(value.value.to)})})];
      return [mode,value];
    });
    return Object.freeze({...v,values:Object.freeze(Object.fromEntries(values))});
  });
  return Object.freeze({...data,variables:Object.freeze(variables)});
}
