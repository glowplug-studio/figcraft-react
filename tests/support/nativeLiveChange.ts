import {stringify,type LosslessNumber} from "lossless-json";
import type {LiveChange} from "../../src/engine/sharing/live-changes";

export type NativeChange =
  | { create: {id: LosslessNumber; parent: LosslessNumber | null; position: string; kind: unknown; props: [string,unknown][]} }
  | { delete: {id: LosslessNumber} }
  | { set: {id: LosslessNumber; prop: string; value: unknown} }
  | { setDoc: {prop: string; value: unknown} }
  | { put: {entry: Record<string,string | LosslessNumber>; value: unknown} }
  | { remove: {entry: Record<string,string | LosslessNumber>} };

export function nativeLiveChange(c: NativeChange): LiveChange {
  if ("create" in c) {
    const n = c.create;
    return {type:"create", id:String(n.id), parent:n.parent === null ? null : String(n.parent),
      kind:stringify(n.kind)!, position:n.position, props:n.props.map(([p,v]) => [p,stringify(v)!])};
  }
  if ("delete" in c) return {type:"delete", id:String(c.delete.id)};
  if ("set" in c) return {type:"set", id:String(c.set.id), prop:c.set.prop, value:stringify(c.set.value)!};
  if ("setDoc" in c) return {type:"setDoc", prop:c.setDoc.prop, value:stringify(c.setDoc.value)!};
  const [[entry,k]] = Object.entries("put" in c ? c.put.entry : c.remove.entry);
  const key = String(k);
  return "put" in c ? {type:"put",entry,key,value:stringify(c.put.value)!} : {type:"remove",entry,key};
}
