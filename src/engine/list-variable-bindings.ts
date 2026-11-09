import { sameComponentValue } from "./component-groups";
import type { DocumentNode } from "./document";
import { parseIndex } from "./parameters";
import type { Paint } from "./solid-paint";
import { bindingItem } from "./style-variables";
import { compareScalarKeys } from "./text-breaks";

type Item = NonNullable<ReturnType<typeof bindingItem>>;

/** Apply moves simultaneously. Colliding aliases are resolved in native scalar-key order. */
export function remapBindings<T extends DocumentNode>(node:T,map:(key:string)=>string|undefined):T {
  if (!node.boundVariables) return node;
  const moves=Object.keys(node.boundVariables).sort(compareScalarKeys).map(key=>[key,map(key)] as const).filter(([a,b])=>a!==b);
  if (!moves.length) return node;
  const {boundVariables,...rest}=node;
  const next:Record<string,string>=Object.assign(Object.create(null),boundVariables);
  for (const [key] of moves) delete next[key];
  for (const [key,destination] of moves) if (destination!==undefined) next[destination]=boundVariables[key];
  return Object.freeze({...rest,...(Object.keys(next).length>0 && {boundVariables:Object.freeze(next)})}) as T;
}

export function shiftListBindings<T extends DocumentNode>(node:T,list:string,from:number,to?:number):T {
  return remapBindings(node,key=>{
    const item=bindingItem(key);
    if (item?.list!==list) return key;
    if (item.index===from && to===undefined) return;
    let index=item.index;
    if (item.index===from) index=to!;
    else {
      if (index>from) index--;
      if (to!==undefined && index>=to) index++;
    }
    return index===item.index ? key : list+"/"+index+"/"+item.field;
  });
}

function editedPaintKey(key:string,item:Item,old:Paint,next:Paint|undefined) {
  if (!next) return;
  if (item.field==="color") return old.type==="solid" && next.type==="solid" && sameComponentValue(old.color,next.color) ? key : undefined;
  if (item.field==="opacity") return old.opacity===next.opacity ? key : undefined;
  const match=/^stops\/(\d+)\/color$/.exec(item.field);
  if (!match) return sameComponentValue(old,next) ? key : undefined;
  if (next.type!=="gradient" || old.type!=="gradient") return;
  const stop=Number(match[1]);
  if (old.stops.length===next.stops.length+1) {
    const mismatch=next.stops.findIndex((s,i)=>!sameComponentValue(s,old.stops[i]));
    const removed=mismatch<0 ? next.stops.length : mismatch;
    if (stop>=removed && next.stops.slice(removed).every((s,i)=>sameComponentValue(s,old.stops[removed+i+1]))) {
      return stop===removed ? undefined : item.list+"/"+item.index+"/stops/"+(stop-1)+"/color";
    }
  }
  return sameComponentValue(old.stops[stop]?.color,next.stops[stop]?.color) ? key : undefined;
}

export function reconcilePaintBindings<T extends DocumentNode>(node:T,list:string,before:readonly Paint[],after:readonly Paint[]):T {
  return remapBindings(node,key=>{
    const item=bindingItem(key);
    if (item?.list!==list || !before[item.index] || before[item.index]===after[item.index]) return key;
    return editedPaintKey(key,item,before[item.index],after[item.index]);
  });
}

export function editPaintBindings<T extends DocumentNode>(node:T,list:string,action:string,params:Record<string,unknown>,before:readonly Paint[],after:readonly Paint[]):T {
  if (!node.boundVariables || before===after) return node;
  if (action==="move") return shiftListBindings(node,list,parseIndex(params.from),parseIndex(params.to));
  if (action==="remove") return shiftListBindings(node,list,params.index==null ? before.length-1 : parseIndex(params.index));
  return action==="set" ? reconcilePaintBindings(node,list,before,after) : node;
}
