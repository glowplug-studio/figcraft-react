import { colour } from "../../colour";
import { compareScalarKeys } from "../../text-breaks";

export type JsonObject = Readonly<Record<string, unknown>>;
export const maximumSize = 1e6;
export const maximumCoordinate = 1e7;
export const clamp = (value:number,min:number,max:number) => Math.max(min,Math.min(value,max));
export const finite = (value:unknown):value is number => typeof value==="number" && Number.isFinite(value);
export const numeric = (value:unknown) => finite(value) ? value : undefined;
export const string = (value:unknown) => typeof value==="string" ? value : undefined;
export function object(value:unknown):JsonObject {
  return value!==null && typeof value==="object" && !Array.isArray(value) ? value as JsonObject : {};
}
export const children = (value:unknown):readonly unknown[] => Array.isArray(value) ? value : [];
export const list = (value:unknown) => children(value).slice(0,256);
export function clipped(value:string) {
  if (value.length<=200) return value;
  let end=0, count=0;
  for (const ch of value) { if (count++===200) break; end+=ch.length; }
  return value.slice(0,end);
}
export function entries(value:unknown) {
  const source=object(value);
  return Object.keys(source).sort(compareScalarKeys).map(key=>[key,source[key]] as const);
}
export function restColour(input:unknown) {
  const {r,g,b,a}=object(input);
  return finite(r) && finite(g) && finite(b) ? colour(r,g,b,numeric(a) ?? 1) : undefined;
}
export class ImportWarnings {
  readonly #counts=new Map<string,number>();
  add(message:string,count=1) {
    if (this.#counts.has(message) || this.#counts.size<200) this.#counts.set(message,(this.#counts.get(message) ?? 0)+count);
  }
  finish() {
    return [...this.#counts].map(([message,count])=>count===1 ? message : message+" (×"+count+")");
  }
}
