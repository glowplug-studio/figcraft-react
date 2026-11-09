import type {Document} from "./document";
import {compareScalarKeys} from "./text-breaks";
import type {Variable, Variables} from "./variables";

type Role = "radius"|"text"|"spacing"|"length"|"unitless";
const scopes = new Map<string,Role>([
  ["CORNER_RADIUS","radius"],["FONT_SIZE","text"],["GAP","spacing"],["WIDTH_HEIGHT","spacing"],
  ["OPACITY","unitless"],["FONT_WEIGHT","unitless"],["STROKE_FLOAT","length"],["EFFECT_FLOAT","length"],
  ["LINE_HEIGHT","length"],["LETTER_SPACING","length"],["PARAGRAPH_SPACING","length"],["PARAGRAPH_INDENT","length"],
]);
function fieldRole(key:string):Role|undefined {
  if (["cornerRadius","topLeftRadius","topRightRadius","bottomRightRadius","bottomLeftRadius"].includes(key)) return "radius";
  if (key==="fontSize") return "text";
  if (key==="opacity" || key==="fontWeight") return "unitless";
  if (["gap","counterAxisSpacing","width","height"].includes(key) || /^(padding|min|max)/.test(key)) return "spacing";
  if (["strokeWeight","lineHeight","letterSpacing","paragraphSpacing","paragraphIndent"].includes(key)) return "length";
}
export function numberRoles(doc:Document,data:Variables) {
  const roles=new Map<string,Role>();
  for (const n of Object.values(doc.nodes).filter(n=>n.boundVariables).sort((a,b)=>a.id.length-b.id.length || compareScalarKeys(a.id,b.id))) {
    if (!n.boundVariables) continue;
    for (const key of Object.keys(n.boundVariables).sort(compareScalarKeys)) {
      const role=fieldRole(key), id=n.boundVariables[key];
      if (role && !roles.has(id)) roles.set(id,role);
    }
  }
  for (const v of data.variables) {
    if (roles.has(v.id) || v.resolvedType!=="number") continue;
    const role=v.scopes?.map(s=>scopes.get(s)).find(r=>r!==undefined);
    if (role) roles.set(v.id,role);
  }
  // Native precedence is file order within each propagation pass. Process only readers
  // which have acquired a role, keeping (pass, file index) order in a priority queue.
  const readers=new Map<string,number[]>(),targets=data.variables.map(v=>{
    const ids=new Set<string>();
    for (const value of Object.values(v.values)) if (value.type==="alias") ids.add(value.value);
    return ids;
  });
  const queue:number[]=[],count=data.variables.length;
  for (const [i,v] of data.variables.entries()) if (targets[i].size) {
    const list=readers.get(v.id);
    if (list) list.push(i);else readers.set(v.id,[i]);
    if (roles.has(v.id)) queue.push(i);
  }
  function schedule(rank:number) {
    let i=queue.length;
    while (i>0) {
      const parent=Math.floor((i-1)/2);
      if (queue[parent]<=rank) break;
      queue[i]=queue[parent];i=parent;
    }
    queue[i]=rank;
  }
  while (queue.length) {
    const rank=queue[0],last=queue.pop()!;
    if (queue.length) {
      let i=0;
      while (i*2+1<queue.length) {
        let child=i*2+1;
        if (child+1<queue.length && queue[child+1]<queue[child]) child++;
        if (last<=queue[child]) break;
        queue[i]=queue[child];i=child;
      }
      queue[i]=last;
    }
    const i=rank%count,role=roles.get(data.variables[i].id)!;
    for (const id of targets[i]) if (!roles.has(id)) {
      roles.set(id,role);
      for (const j of readers.get(id) ?? []) schedule(rank-i+j+(j<=i ? count : 0));
    }
  }
  return roles;
}

export function cssVariableName(name:string) {
  let out="--",count=0;
  characters: for (const character of name) for (const c of character.toLowerCase()) {
    if (++count>80) break characters;
    if (/[\p{Alphabetic}\p{Number}_]/u.test(c)) out+=c;
    else if (!out.endsWith("-")) out+="-";
  }
  return out.replace(/-+$/,"") || "--variable";
}
function cssName(v:Variable) {
  const web=v.codeSyntax?.WEB?.trim();
  if (web===undefined) return cssVariableName(v.name);
  const inner=web.startsWith("var(") ? web.slice(4).split(/[,)]/,1)[0].trim() : web;
  return /^--[\p{Alphabetic}\p{Number}_-]+$/u.test(inner) ? Array.from(inner).slice(0,80).join("") : cssVariableName(inner);
}

export function variableCssNames(data:Variables,roles:ReadonlyMap<string,Role>,tailwind:boolean) {
  function candidate(v:Variable,full:boolean) {
    if (!tailwind) return cssName(v);
    const role=roles.get(v.id);
    const ns=v.resolvedType==="color" ? "color" : v.resolvedType==="string" && v.scopes?.includes("FONT_FAMILY") ? "font" :
      v.resolvedType==="number" && (role==="radius" || role==="text" || role==="spacing") ? role : undefined;
    if (!ns) return full ? cssVariableName(v.name) : cssName(v);
    let slug=cssVariableName(full ? v.name : v.name.split("/").at(-1)!).replace(/^-+/,"");
    for (const prefix of [ns+"s-",ns+"-"]) if (slug.startsWith(prefix)) {slug=slug.slice(prefix.length);break;}
    if (slug===ns || slug===ns+"s") slug="base";
    return "--"+ns+"-"+slug;
  }
  const plain=data.variables.map(v=>candidate(v,false)),counts=new Map<string,number>();
  for (const name of plain) counts.set(name,(counts.get(name) ?? 0)+1);
  const names=new Map<string,string>(),taken=new Set<string>(),suffix=new Map<string,number>();
  for (const [i,v] of data.variables.entries()) {
    const base=tailwind && counts.get(plain[i])!>1 ? candidate(v,true) : plain[i];
    let name=base;
    if (taken.has(name)) {
      let n=suffix.get(base) ?? 1;
      do {name=base+"-"+(++n);} while (taken.has(name) || !tailwind && counts.has(name));
      suffix.set(base,n);
    }
    taken.add(name);names.set(v.id,name);
  }
  return names;
}
