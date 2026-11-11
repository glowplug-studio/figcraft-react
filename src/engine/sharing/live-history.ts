import type { Document } from "../document";
import { diffLive, liveTargetValue, type LiveChange, type LiveReplica } from "./live-changes";

export interface LiveStep {
  forward: LiveChange[];
  backward: LiveChange[];
  taken: Set<string>;
  confirmed: boolean;
  settledForward: boolean;
  inFlight?: {writes:Set<string>; displaced:Set<string>};
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
        (c.type === "put" || c.type === "remove") && whole.has(c.entry)) {
      if(step.inFlight?.writes.has(name))step.inFlight.displaced.add(name);
      else step.taken.add(name);
    }
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
  return {forward:changes,backward,taken:new Set(),confirmed:false,settledForward:true};
}

/** An accepted travel learns the values it actually overwrote if another author got there first. */
export async function refreshLiveTravel(step:LiveStep,forward:boolean,before:LiveReplica,after:LiveReplica,changes:LiveChange[]) {
  const writes=new Set(changes.map(key));
  async function refresh(side:LiveChange[],state:LiveReplica) {
    return Promise.all(side.map(async change=>{
      if(change.type==="create" || change.type==="delete" || !writes.has(key(change)) || step.taken.has(key(change)))return change;
      const value=await liveTargetValue(state,change);
      if(change.type==="put" || change.type==="remove"){
        const {entry,key}=change;
        return value===undefined?{type:"remove" as const,entry,key}:{type:"put" as const,entry,key,value};
      }
      return value===undefined?change:{...change,value};
    }));
  }
  step.forward=await refresh(step.forward,forward?after:before);
  step.backward=await refresh(step.backward,forward?before:after);
}

export function sendLiveTravel(step:LiveStep,changes:LiveChange[]) {
  step.confirmed=false;
  step.inFlight={writes:new Set(changes.filter(c=>c.type!=="create" && c.type!=="delete").map(key)),displaced:new Set()};
}

export function loseLiveTravel(step:LiveStep) {
  for(const target of step.inFlight?.displaced??[])step.taken.add(target);
  step.inFlight=undefined;
  step.confirmed=true;
}

export function settleLiveStep(step:LiveStep,forward:boolean) {
  step.inFlight=undefined;
  step.confirmed=true;
  step.settledForward=forward;
}

export async function verifyLiveSteps(steps:Iterable<LiveStep>,state:LiveReplica) {
  const values=new Map<string,string|undefined>();
  for(const step of steps){
    if(!step.confirmed)continue;
    for(const change of step.settledForward?step.forward:step.backward){
      if(change.type==="create" || change.type==="delete")continue;
      const target=key(change);
      if(step.taken.has(target))continue;
      if(!values.has(target))values.set(target,await liveTargetValue(state,change));
      const expected=change.type==="remove"?undefined:change.value;
      if(values.get(target)!==expected)step.taken.add(target);
    }
  }
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
