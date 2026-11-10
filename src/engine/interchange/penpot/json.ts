import { isLosslessNumber, parse } from "lossless-json";
import { archiveJsonText } from "../archive-json";
import type { JsonObject } from "../rest/values";
export type PenpotJsonResult = {cost:number;error:string} | {cost:number;value:unknown;tokens:Map<object,Map<string,string>>};
type Fields = Record<string, unknown>;

export function decodePenpotJson(buffer:ArrayBuffer,context:string,budget:number):PenpotJsonResult {
  const bytes=new Uint8Array(buffer);
  let cost=1,quoted=false;
  for (let i=0;i<bytes.length;i++) {
    const byte=bytes[i];
    if (quoted && byte===92) i++;
    else if (byte===34) quoted=!quoted;
    else if (!quoted && (byte===91 || byte===123 || byte===44 || byte===58)) cost++;
  }
  if (cost>budget) return {cost,error:"JSON structure exceeds import value budget"};
  try {
    const text=archiveJsonText(buffer,context),tokens=new Map<object,Map<string,string>>();
    const root: unknown = parse(text);
    const visit = (container: Fields) => {
      for (const [key, value] of Object.entries(container)) {
        if (isLosslessNumber(value)) {
          const numeric = Number(value.value);
          container[key] = numeric;
          if (String(numeric) !== value.value || !Number.isSafeInteger(numeric)) {
            let fields = tokens.get(container);
            if (!fields) tokens.set(container, fields = new Map());
            fields.set(key, value.value);
          }
        } else if (value !== null && typeof value === "object") visit(value as Fields);
      }
    };
    if (isLosslessNumber(root)) return {value:Number(root.value),cost,tokens};
    if (root !== null && typeof root === "object") visit(root as Fields);
    return {value:root,cost,tokens};
  } catch (e) {return {cost,error:e instanceof Error ? e.message : String(e)};}
}

/** Preserve lexical numbers wherever native serde distinguishes an integer from a float or a JS number loses bits. */
export class PenpotNumbers {
  private readonly tokens = new WeakMap<object, Map<string, string>>();

  read(text:string) {
    const {buffer}=new TextEncoder().encode(text);
    const result=decodePenpotJson(buffer,"Penpot source metadata",Infinity);
    if ("error" in result) throw new Error(result.error);
    this.adopt(result.tokens);
    return result.value;
  }
  adopt(tokens:ReadonlyMap<object,Map<string,string>>) {
    for (const [node,fields] of tokens) this.tokens.set(node,fields);
  }

  token(container: object, key: string, value: number) {
    return this.tokens.get(container)?.get(key) ?? String(value);
  }

  pick(container: JsonObject, keys: readonly string[]): JsonObject {
    const selected = Object.fromEntries(keys.filter(key => Object.hasOwn(container, key)).map(key => [key, container[key]]));
    const tokens = this.tokens.get(container);
    if (tokens) this.tokens.set(selected, tokens);
    return selected;
  }

  integer(container: JsonObject, key: string) {
    const value = container[key];
    if (typeof value !== "number") return;
    const token = this.token(container, key, value);
    if (token!=="-0" && /^-?\d{1,20}$/.test(token)) return BigInt(token);
  }
}
