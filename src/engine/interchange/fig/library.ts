import {guid,items,obj} from "./fields";
import type {KiwiObject,KiwiValue} from "./kiwi";
type Children=Map<string,{id:string}[]>;
/** Follow visible references first, then retain their definitions and surrounding frames. */
export function* libraryBranches(
  visible:string[],internal:string[],records:Map<string,KiwiObject>,children:Children,
  isSwap:(id:KiwiValue|undefined)=>boolean,limit:number,warn:(s:string)=>void
) {
  const needed=new Set<string>(),visited=new Set<string>();
  const pending:{id:string;depth:number}[]=[];
  for (const page of visible) for (const child of children.get(page) ?? []) pending.push({id:child.id,depth:1});
  function target(id:string|undefined) {
    if (id && !needed.has(id)) {needed.add(id);pending.push({id,depth:1});}
  }
  while (pending.length) {
    const {id,depth}=pending.pop()!;
    if (depth>256) {warn("component references below 256 layer levels were skipped");continue;}
    if (visited.has(id)) continue;
    visited.add(id);
    if (visited.size>limit) {warn("the component reference scan reached the "+limit+"-layer limit");break;}
    if (visited.size%128===0) yield;
    const node=records.get(id);
    if (!node) continue;
    for (const v of items(node.componentPropDefs)) {
      const d=obj(v);
      if (isSwap(d.id)) target(guid(obj(d.initialValue).guidValue));
    }
    const rows=node.type==="INSTANCE" ? [node] : [];
    for (let i=0;rows.length && i<limit;i++) {
      const row=rows.pop()!,data=obj(row.symbolData);
      target(guid(row.overriddenSymbolID));target(guid(data.symbolID));
      for (const v of items(row.componentPropAssignments)) {
        const a=obj(v);
        if (!isSwap(a.defID)) continue;
        const val=Object.keys(obj(a.value)).length ? obj(a.value) : obj(obj(a.varValue).value);
        target(guid(val.guidValue) ?? guid(obj(val.symbolIdValue).guid));
      }
      for (const v of items(data.symbolOverrides)) rows.push(obj(v));
      for (const v of items(row.derivedSymbolData)) rows.push(obj(v));
    }
    for (const child of children.get(id) ?? []) pending.push({id:child.id,depth:depth+1});
  }
  const branches=new Map<string,Set<string>>();
  let scanned=0;
  for (const page of internal) {
    const included=new Set<string>(),seen=new Set([page]),parents=new Map<string,string>();
    const stack=(children.get(page) ?? []).map(child=>({id:child.id,depth:1,inside:false}));
    while (stack.length) {
      const {id,depth,inside}=stack.pop()!;
      if (depth>256) {warn("internal library layers nested deeper than 256 levels were skipped");continue;}
      if (seen.has(id)) continue;
      seen.add(id);
      if (++scanned>limit) {warn("the internal library scan reached the "+limit+"-layer limit; the remaining branches were skipped");break;}
      if (scanned%128===0) yield;
      const node=records.get(id);
      if (!node) continue;
      const definition=needed.has(id) && (node.type==="SYMBOL" || node.type==="FRAME" && node.isStateGroup===true);
      if (inside || definition) included.add(id);
      if (definition) for (let p=parents.get(id);p && !included.has(p);p=parents.get(p)) included.add(p);
      const kids=children.get(id) ?? [];
      for (let i=kids.length-1;i>=0;i--) {
        const child=kids[i].id;
        if (seen.has(child)) continue;
        if (!parents.has(child)) parents.set(child,id);
        stack.push({id:child,depth:depth+1,inside:inside || definition});
      }
    }
    if (included.size) branches.set(page,included);
  }
  return branches;
}
