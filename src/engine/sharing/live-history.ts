import type { Document } from "../document";
import { diffLive, type LiveChange, type LiveReplica } from "./live-changes";

export interface LiveStep {
  forward: LiveChange[];
  backward: LiveChange[];
  taken: Set<string>;
  confirmed: boolean;
}

function key(c: LiveChange) {
  switch (c.type) {
    case "create": case "delete": return "node/"+c.id;
    case "set": return "prop/"+c.id+"/"+c.prop;
    case "setDoc": return "doc/"+c.prop;
    case "put": case "remove": return "entry/"+c.entry+"/"+c.key;
  }
}

const lists: Record<string,string> = {comments:"comment",styles:"style",collections:"collection",variables:"variable"};

export function taintStep(step: LiveStep, changes: readonly LiveChange[]) {
  const touched = new Set<string>(), whole = new Set<string>(), families = new Set<string>();
  for (const c of changes) {
    if (c.type === "delete") continue;
    touched.add(key(c));
    if (c.type === "put" || c.type === "remove") families.add(c.entry);
    if (c.type === "setDoc") {
      if (lists[c.prop]) { whole.add(lists[c.prop]); families.add(lists[c.prop]); }
      else if (c.prop.endsWith("Order")) families.add(c.prop.slice(0,-5));
    }
  }
  for (const c of [...step.forward,...step.backward]) {
    const name = key(c);
    if (touched.has(name) || c.type === "set" && touched.has("node/"+c.id) ||
        c.type === "setDoc" && (families.has(lists[c.prop]) || c.prop.endsWith("Order") && whole.has(c.prop.slice(0,-5))) ||
        (c.type === "put" || c.type === "remove") && whole.has(c.entry)) step.taken.add(name);
  }
}

export async function captureLiveStep(before: LiveReplica, after: LiveReplica, changes: LiveChange[]): Promise<LiveStep> {
  const inverse = (await diffLive(after,before.document)).changes;
  // Undo restores the keys that were actually present, including simultaneous equal-key inserts.
  const backward = inverse.map(c => {
    if (c.type === "create") return {...c,position:before.positions.get(c.id) ?? c.position};
    if (c.type === "set" && c.prop === "position") return {...c,value:JSON.stringify(before.positions.get(c.id) ?? "a0")};
    return c;
  });
  return {forward:changes,backward,taken:new Set(),confirmed:false};
}

function safeDeletes(document: Document, removable: Set<string>) {
  const protectedNodes = new Set<string>();
  for (const id of removable) {
    const node = document.nodes[id];
    if (node && "children" in node && node.children.some(c => !removable.has(c))) {
      let parent: string | null = id;
      while (parent !== null && removable.has(parent) && !protectedNodes.has(parent)) {
        protectedNodes.add(parent);
        parent = document.nodes[parent].parent;
      }
    }
  }
  return [...removable].filter(id => {
    const n = document.nodes[id];
    return n && !protectedNodes.has(id) && (n.parent === null || !removable.has(n.parent) || protectedNodes.has(n.parent));
  }).map((id): LiveChange => ({type:"delete",id}));
}

export function travelLiveStep(step: LiveStep, undo: boolean, doc: Document) {
  const direction = undo ? step.backward : step.forward, opposite = undo ? step.forward : step.backward;
  const result = direction.filter(c => c.type !== "delete" && !step.taken.has(key(c)) &&
    !(c.type === "set" && c.prop === "position" && step.taken.has("prop/"+c.id+"/parent")));
  const removable = new Set(opposite.filter((c): c is Extract<LiveChange,{type:"create"}> => c.type === "create" && !step.taken.has(key(c))).map(c => c.id));
  return [...result,...safeDeletes(doc,removable)];
}
