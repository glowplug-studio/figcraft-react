import { numericOrder } from "../branch-diff";
import type { Document } from "../document";
import { U64_MAX } from "../native-values";
import type { LiveChange, LiveReplica } from "./live-changes";
import { applyLive,MissingLiveLayer } from "./live-replica";
import { maxLiveChanges } from "./live-wire";

export interface RemovedLiveIds {
  readonly nodes: readonly string[];
  readonly entries: readonly string[];
}
export const emptyRemovedIds: RemovedLiveIds = {nodes:[],entries:[]};

const entryFamilies = {style:"styles",comment:"comments",variable:"variables",collection:"collections"} as const;
type Family = keyof typeof entryFamilies;
const prefixes = {style:"S:",comment:"",variable:"VariableID:",collection:"VariableCollectionId:"};

function entries(doc: Document, family: Family) {
  switch (family) {
    case "style": return doc.styles ?? [];
    case "comment": return doc.comments ?? [];
    case "variable": return doc.variables?.variables ?? [];
    case "collection": return doc.variables?.collections ?? [];
  }
}

function namespace(family: Family, key: string) {
  const prefix = prefixes[family];
  if (!key.startsWith(prefix)) return 0;
  const digits = key.slice(prefix.length).replace(/^0+/,"") || "0";
  if (!/^\d{1,20}$/.test(digits)) return 0;
  const value = BigInt(digits);
  return value > U64_MAX ? 0 : Number(value >> 32n);
}

function touchedFamilies(changes: readonly LiveChange[]) {
  const families = new Set<Family>();
  for (const c of changes) {
    if ((c.type === "put" || c.type === "remove") && Object.hasOwn(entryFamilies,c.entry)) families.add(c.entry as Family);
    if (c.type === "setDoc") for (const family of Object.keys(entryFamilies) as Family[]) {
      if (c.prop === entryFamilies[family]) families.add(family);
    }
  }
  return families;
}

function checkEntries(before: Document, after: Document, changes: readonly LiveChange[], from: number,
  issued: ReadonlySet<number>, removed: Set<string>) {
  for (const family of touchedFamilies(changes)) {
    const old = new Set(entries(before,family).map(e => e.id)), next = new Set(entries(after,family).map(e => e.id));
    for (const key of next) {
      if (old.has(key)) continue;
      const space = namespace(family,key), name = family + "/" + key;
      if (!removed.has(name) && space !== from && (issued.has(space) || space >= 0x80000000)) {
        throw new Error("New " + family + " belongs to another client's ID space");
      }
      removed.delete(name);
    }
    for (const key of old) if (!next.has(key)) removed.add(family + "/" + key);
  }
}

export function liveRefusalReason(error:unknown) {
  if(error instanceof MissingLiveLayer)return "a layer it changes was deleted by someone else";
  return error instanceof Error ? error.message : "Invalid live batch";
}

export function permitsLiveChanges(access: "edit" | "comment" | "view", changes: readonly LiveChange[]) {
  return access === "edit" || access === "comment" && changes.every(c =>
    (c.type === "put" || c.type === "remove") && c.entry === "comment" ||
    c.type === "setDoc" && (c.prop === "comments" || c.prop === "commentOrder"));
}

/** Validate against the same confirmed sequence and issued-client set that the journal commits. */
export async function admitLiveChanges(replica: LiveReplica, removed: RemovedLiveIds, issued: ReadonlySet<number>, request: {
  client: number; base: bigint; sequence: bigint; access: "view" | "comment" | "edit"; changes: readonly LiveChange[];
}) {
  const {changes,client} = request;
  if (!permitsLiveChanges(request.access,changes)) throw new Error(request.access === "view" ? "You can only view this file" : "You can only view and comment on this file");
  if (request.base > request.sequence || request.base < 0n) throw new Error("Batch refers to a future or invalid sequence");
  if (changes.length > maxLiveChanges) throw new Error("Too many changes in one batch");
  const nodes = new Set(removed.nodes);
  for (const c of changes) if (c.type === "create" && !replica.document.nodes[c.id] && !nodes.has(c.id) && Number(BigInt(c.id) >> 32n) !== client) {
    throw new Error("New layer belongs to another client's ID space");
  }
  const applied = await applyLive(replica,changes);
  if (applied.replica.document.nodes !== replica.document.nodes && Object.keys(applied.replica.document.nodes).length > 5_000_000) {
    throw new Error("Session has too many layers");
  }
  const detached = new Set(removed.entries);
  checkEntries(replica.document,applied.replica.document,changes,client,issued,detached);
  for (const c of changes) if (c.type === "create") nodes.delete(c.id);
  for (const id of applied.deleted) nodes.add(id);
  const retained = nodes.size > 1 << 18 ? [...nodes].sort(numericOrder).slice(-(1 << 18)) : [...nodes];
  return {replica:applied.replica,removed:{nodes:retained,entries:[...detached]}};
}
