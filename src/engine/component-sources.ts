import type {Document,DocumentNode,InstanceNode,NodeId} from "./document";

/** Scope checks made against one unchanged document while rebasing an instance. */
export class ComponentSources {
  readonly #chains=new Map<NodeId,NodeId[]|null>();
  readonly #parents=new Map<string,boolean|null>();
  constructor(readonly document:Document) {}
  chain(source:NodeId) {
    if (this.#chains.has(source)) return this.#chains.get(source);
    const chain:NodeId[]=[],seen=new Set<NodeId>();
    let id:NodeId|undefined=source;
    while (id && chain.length<16 && !seen.has(id)) {
      const node:DocumentNode|undefined=this.document.nodes[id];
      if (!node) break;
      seen.add(id);chain.push(id);id=node.source;
    }
    const result=id ? null : chain;
    if (this.#chains.size<8192) this.#chains.set(source,result);
    return result;
  }
  inMain(source:NodeId,main:NodeId) {
    const key=source+"/"+main;
    if (this.#parents.has(key)) return this.#parents.get(key);
    const seen=new Set<NodeId>();
    let id:NodeId|null=source,found=false;
    while (id && seen.size<512 && !seen.has(id)) {
      const node:DocumentNode|undefined=this.document.nodes[id];
      if (!node) break;
      seen.add(id);found ||= id===main;id=node.parent;
    }
    const result=id ? null : found;
    if (this.#parents.size<8192) this.#parents.set(key,result);
    return result;
  }
  member(source:NodeId|undefined,main:NodeId,target:NodeId) {
    if (!source) return;
    const chain=this.chain(source);
    if (!chain || chain.includes(target)) return;
    let member:NodeId|undefined;
    for (const id of chain) {
      const inside=this.inMain(id,main);
      if (inside==null) return;
      if (!member && inside && id!==main) member=id;
    }
    return member;
  }
  owners(id:NodeId) {
    const owners:InstanceNode[]=[],seen=new Set([id]);
    let current=this.document.nodes[id]?.parent;
    while (current && seen.size<=512 && !seen.has(current)) {
      const node=this.document.nodes[current];
      if (!node) return [];
      if (node.overrides?.includes("slot")) return owners;
      seen.add(current);
      if (node.kind==="instance") owners.push(node);
      current=node.parent;
    }
    return current ? [] : owners;
  }
  contextual(source:NodeId,owners:InstanceNode[]) {return owners.some(o=>o.component!==source && this.inMain(source,o.component));}
  valid(source:NodeId|undefined,target:NodeId,owners:InstanceNode[]) {
    const nearest=owners[0];
    if (!source || !nearest || !this.member(source,nearest.component,target)) return;
    if (this.inMain(source,nearest.component)) return source;
    const slot=nearest.source && this.document.nodes[nearest.source];
    if (slot && slot.kind==="instance" && slot.component===nearest.component && this.owners(source)[0]?.id===slot.id) return source;
  }
  placed(instance:InstanceNode,owners:InstanceNode[]) {
    const id=this.valid(instance.source,instance.id,owners),node=id && this.document.nodes[id];
    if (id && node && (node.kind==="instance" || node.kind==="frame") && this.contextual(id,owners)) return id;
  }
  beneathSwap(owners:InstanceNode[],stop:NodeId) {
    for (const [index,owner] of owners.entries()) {
      if (owner.id===stop) break;
      const source=this.placed(owner,owners.slice(index+1)),node=source && this.document.nodes[source];
      if (node && (node.kind==="frame" || node.kind==="instance" && node.component!==owner.component)) return true;
    }
    return false;
  }
}
