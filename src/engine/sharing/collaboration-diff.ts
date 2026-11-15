import {isLosslessNumber,parse} from "lossless-json";
import type {Document} from "../document";
import {inspectedId} from "../parameters";
import {diffLive,liveReplica,type LiveChange} from "./live-changes";
import {changeMessageSize} from "./session-postcard";

export type CollaborationValue = null | boolean | number | string | CollaborationValue[] | {[key:string]:CollaborationValue};
export type CollaborationChange =
  | {create:{id:number|string;kind:CollaborationValue;parent:number|string|null;position:string;props:[string,CollaborationValue][]}}
  | {set:{id:number|string;prop:string;value:CollaborationValue}}
  | {delete:{id:number|string}}
  | {setDoc:{prop:string;value:CollaborationValue}}
  | {put:{entry:Record<string,number|string>;value:CollaborationValue}}
  | {remove:{entry:Record<string,number|string>}};

/** Match public inspected IDs recursively, without leaking lossless-json wrappers.
 * Native floating tokens become JS numbers; unsafe integer tokens keep every digit. */
function readable(value:unknown):CollaborationValue {
  if(isLosslessNumber(value))return /^-?\d+$/.test(value.value)?inspectedId(value.value):Number(value.value);
  if(Array.isArray(value))return value.map(readable);
  if(value && typeof value==="object")return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,readable(item)]));
  if(value===null || typeof value==="boolean" || typeof value==="string" || typeof value==="number")return value;
  throw new Error("Invalid collaboration JSON value");
}
function json(value:string){return readable(parse(value));}
function entry(change:{entry:string;key:string}):Record<string,number|string> {
  return {[change.entry]:change.entry==="comment" || change.entry==="devSnapshot"?inspectedId(change.key):change.key};
}

/** Native readable shapes; binary measurement uses the original canonical JSON strings. */
export function collaborationDiffReceipt(changes:readonly LiveChange[]) {
  const projected:CollaborationChange[]=changes.map(change=>{
    switch(change.type){
      case "create":return {create:{id:inspectedId(change.id),kind:json(change.kind),parent:change.parent===null?null:inspectedId(change.parent),
        position:change.position,props:change.props.map(([prop,value])=>[prop,json(value)])}};
      case "set":return {set:{id:inspectedId(change.id),prop:change.prop,value:json(change.value)}};
      case "delete":return {delete:{id:inspectedId(change.id)}};
      case "setDoc":return {setDoc:{prop:change.prop,value:json(change.value)}};
      case "put":return {put:{entry:entry(change),value:json(change.value)}};
      case "remove":return {remove:{entry:entry(change)}};
    }
  });
  return {changes:projected,count:changes.length,bytes:changeMessageSize(changes)};
}

/** Compare a fresh replica of the captured baseline, like native collab.diff. */
export async function collaborationDiff(before:Document,after:Document) {
  const {changes}=await diffLive(liveReplica(before),after);
  return collaborationDiffReceipt(changes);
}
