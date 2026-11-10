import { parseBoolean, parseString } from "./parameters";
import { sameComponentValue } from "./component-groups";
import { nextVariableId, syncExtensions } from "./variable-collections";
import { references } from "./variable-values";
import { emptyVariables, resolveVariable, variableIndex, type Variable, type Variables, type VariableType } from "./variables";

export const metadataSpecs={
  "variable.update":{label:"Edit variable",undo:true},"variable.duplicate":{label:"Duplicate variable",undo:true},
  "variable.delete":{label:"Delete variable",undo:true},"variable.deleteCollection":{label:"Delete variable collection",undo:true},
} as const;
export const variableScopes:Record<VariableType,readonly string[]>={
  color:["FRAME_FILL","SHAPE_FILL","TEXT_FILL","STROKE_COLOR","EFFECT_COLOR"],
  number:["CORNER_RADIUS","WIDTH_HEIGHT","GAP","OPACITY","STROKE_FLOAT","EFFECT_FLOAT","FONT_WEIGHT","FONT_SIZE","LINE_HEIGHT","LETTER_SPACING","PARAGRAPH_SPACING","PARAGRAPH_INDENT","TEXT_CONTENT"],
  string:["TEXT_CONTENT","FONT_FAMILY","FONT_STYLE"],boolean:[],
};

function metadata(v:Variable,p:Record<string,unknown>,data:Variables):Variable {
  const {scopes:previous,codeSyntax,hiddenFromPublishing,...base}=v;
  const raw=parseString(p.name);
  let name=v.name;
  if (raw!==undefined) {
    if (v.extends!==undefined) throw new Error("An inherited variable keeps its parent's name");
    name=Array.from(raw.split("/").map(part=>part.trim()).filter(Boolean).join("/")).slice(0,500).join("");
    if (!name || data.variables.some(x=>x.id!==v.id && x.collection===v.collection && x.name===name)) throw new Error("The variable needs a unique name in this collection");
  }
  let scopes=previous;
  if (Object.hasOwn(p,"scopes")) {
    if (p.scopes===null) scopes=undefined;
    else {
      const allowed=variableScopes[v.resolvedType];
      if (!Array.isArray(p.scopes) || !p.scopes.every((s:unknown)=>typeof s==="string" && (allowed.includes(s) || s==="ALL_SCOPES" || s==="ALL_FILLS" && v.resolvedType==="color")))
        throw new Error("Unknown scope for "+v.resolvedType);
      const items=[...new Set<string>(p.scopes)];
      scopes=items.includes("ALL_SCOPES") || allowed.length && allowed.every(k=>items.includes(k)) ? undefined : Object.freeze(items);
    }
  }
  const code={...codeSyntax};
  if (p.codeSyntax!=null) {
    if (typeof p.codeSyntax!=="object" || Array.isArray(p.codeSyntax)) throw new Error("Expected code syntax by platform");
    for (const [k,value] of Object.entries(p.codeSyntax)) {
      if (!["WEB","iOS","ANDROID"].includes(k) || value!==null && typeof value!=="string") throw new Error("Invalid code syntax");
      if (value?.trim()) code[k]=Array.from(value.trim()).slice(0,500).join("");
      else delete code[k];
    }
  }
  const desc=parseString(p.description);
  return Object.freeze({...base,name,description:desc===undefined ? v.description : Array.from(desc).slice(0,10000).join(""),
    ...(scopes && {scopes}),...(Object.keys(code).length && {codeSyntax:Object.freeze(code)}),
    ...((parseBoolean(p.hiddenFromPublishing) ?? hiddenFromPublishing) && {hiddenFromPublishing:true as const})});
}

function forget(data:Variables,gone:Set<string>) {
  return data.variables.filter(v=>!gone.has(v.id)).map(v=>{
    const values={...v.values}; let changed=false;
    for (const [mode,x] of Object.entries(v.values)) {
      if (!references(x).some(ref=>gone.has(ref))) continue;
      const resolved=resolveVariable(data,v.id,{[v.collection]:mode});
      if (resolved) {values[mode]=Object.freeze(resolved);changed=true;}
    }
    return changed ? Object.freeze({...v,values:Object.freeze(values)}) : v;
  });
}
export function editVariableMetadata(data:Variables,command:string,p:Record<string,unknown>, allocate?: () => bigint) {
  const removeCollection=command==="variable.deleteCollection";
  const allowed=removeCollection ? ["collection"] : command==="variable.update" ? ["variable","name","description","scopes","hiddenFromPublishing","codeSyntax"] : ["variable"];
  for (const k of Object.keys(p)) if (!allowed.includes(k)) throw new Error("Unknown "+command+" parameter "+k);
  let collections=data.collections, variables=[...data.variables], result:Record<string,unknown>={ok:true};
  if (removeCollection) {
    const key=parseString(p.collection), c=collections.find(c=>c.id===key || c.name===key);
    if (!c) throw new Error("No such collection");
    const gone=new Set(variables.filter(v=>v.collection===c.id).map(v=>v.id));
    collections=Object.freeze(collections.filter(x=>x.id!==c.id));
    variables=forget(data,gone);result={deletedVariables:gone.size};
  } else {
    const key=parseString(p.variable);
    const v=key===undefined ? undefined : command==="variable.duplicate" ? variables.find(v=>v.id===key || v.name===key)
      : variableIndex(data).variables.get(key) ?? variables.find(v=>v.name===key);
    if (!v) throw new Error("No such variable");
    const i=variables.indexOf(v);
    if (command==="variable.delete") {
      if (v.extends!==undefined) throw new Error("An inherited variable stays with its parent");
      variables=forget(data,new Set([v.id]));
    } else if (command==="variable.duplicate") {
      const {extends:link,overrides,...base}=v;
      const used=new Set(variables.filter(x=>x.collection===v.collection).map(x=>x.name));
      const prefix=v.name+" copy";
      let name=prefix;
      for (let n=2;used.has(name);n++) {
        if (n>=1000) throw new Error("Too many copies");
        name=prefix+" "+n;
      }
      const id=allocate ? "VariableID:" + allocate() : nextVariableId(variables,"VariableID:");
      variables.splice(i+1,0,Object.freeze({...base,id,name}));result={id};
    } else {
      const next=metadata(v,p,data);
      if (sameComponentValue(v,next)) return {data,result};
      variables[i]=next;
    }
  }
  return {data:collections.length || variables.length ? syncExtensions(Object.freeze({collections,variables:Object.freeze(variables)}), allocate) : emptyVariables,result};
}
