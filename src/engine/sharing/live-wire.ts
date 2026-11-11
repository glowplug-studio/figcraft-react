import { idString } from "../native-values";
import { nodePropertyOrder } from "../branch-diff";
import { validatePosition } from "../branch-position";
import type { LiveChange } from "./live-changes";

const properties = new Set([...nodePropertyOrder,"position"]);
const entryKinds = new Set(["image","collection","comment","style","variable"]);
const documentProperties = new Set(["name","currentPage","documentColors","colorProfile","imagePresets","libraries",
  "styles","styleOrder","comments","commentOrder","collections","collectionOrder","variables","variableOrder"]);
export const maxLiveMessageBytes = 64 * 1024 * 1024;
export const maxLiveChanges = 500_000;

function record(raw: unknown): Record<string,unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Expected a live change");
  return raw as Record<string,unknown>;
}

function text(raw: unknown, label: string) {
  if (typeof raw !== "string") throw new Error("Invalid live " + label);
  return raw;
}

function member(raw: unknown, allowed: ReadonlySet<string>, label: string) {
  const key = text(raw,label);
  if (!allowed.has(key)) throw new Error("Unsupported live " + label);
  return key;
}

function readChange(raw: unknown): LiveChange {
  const c = record(raw);
  if (c.type === "setDoc") return {type:c.type,prop:member(c.prop,documentProperties,"document property"),value:text(c.value,"value")};
  if (c.type === "put" || c.type === "remove") {
    const entry = member(c.entry,entryKinds,"entry");
    const key = text(c.key,"entry key");
    if (entry === "comment") idString(key,"comment ID");
    return c.type === "remove" ? {type:c.type,entry,key} : {type:c.type,entry,key,value:text(c.value,"value")};
  }
  const id = idString(text(c.id,"ID"),"layer");
  if (c.type === "delete") return {type:c.type,id};
  if (c.type === "set") return {type:c.type,id,prop:member(c.prop,properties,"property"),value:text(c.value,"value")};
  if (c.type !== "create" || !Array.isArray(c.props)) throw new Error("Invalid live operation");
  const parent = c.parent === null ? null : idString(text(c.parent,"parent"),"parent");
  const position = text(c.position,"position");
  validatePosition(position);
  const props = c.props.map((item: unknown): [string,string] => {
    if (!Array.isArray(item) || item.length !== 2) throw new Error("Invalid live property");
    return [member(item[0],properties,"property"),text(item[1],"value")];
  });
  return {type:c.type,id,kind:text(c.kind,"kind"),parent,position,props};
}

/** The host bounds the request bytes before parsing. Only copy recognised DTO fields into the journal. */
export function readLiveChanges(raw: unknown): LiveChange[] {
  if (!Array.isArray(raw) || raw.length > maxLiveChanges) throw new Error("Invalid live batch size");
  return raw.map(readChange);
}

const encoder = new TextEncoder();
function jsonWeight(v: unknown): number {
  if (typeof v === "string") return encoder.encode(v).length + 2;
  if (Array.isArray(v)) return v.reduce((sum,n) => sum + jsonWeight(n),2);
  if (v && typeof v === "object") return Object.entries(v).reduce((sum,[key,val]) => sum + encoder.encode(key).length + 3 + jsonWeight(val),2);
  return 8;
}

/** Native server::weight accounts for decoded JSON values. Numeric tokens have constant weight. */
export function liveChangeWeight(changes: readonly LiveChange[]) {
  const weight = (json: string) => jsonWeight(JSON.parse(json));
  let size = 0;
  for (const c of changes) {
    switch (c.type) {
      case "create":
        size += 64 + weight(c.kind) + c.position.length;
        for (const [,value] of c.props) size += 16 + weight(value);
        break;
      case "set": case "setDoc": size += 32 + weight(c.value); break;
      case "put": size += 64 + weight(c.value); break;
      case "remove": size += 64; break;
      case "delete": size += 16; break;
    }
  }
  return size;
}
