import {isLosslessNumber} from "lossless-json";
import type {Document,DocumentNode} from "./document";
import {ancestors,subtreeIds} from "./hierarchy";
import {parseNodeId} from "./parameters";
import type {PublishedLibrary} from "./published-library";

export function componentRoot(doc:Document,id:string) {
  if (!doc.nodes[id]) return;
  return [id,...ancestors(doc,id)].reverse().find(key=>doc.nodes[key].kind==="component" || doc.nodes[key].kind==="componentSet");
}
export function publishedComponent(lib:PublishedLibrary,value:unknown) {
  const id=parseNodeId(value),root=id && componentRoot(lib.document,id);
  if (root && lib.manifest.components.some(c=>c.id===root && c.published)) return id!;
  const asset=lib.manifest.components.find(c=>c.published && c.name===value);
  if (!asset) throw Error('"'+lib.manifest.name+'" publishes no component '+JSON.stringify(value));
  return asset.id;
}
export function collectNodeAssets(n:DocumentNode,styles:Set<string>,bound:Set<string>,collections:Set<string>) {
  for (const id of Object.values(n.styles ?? {})) if (id) styles.add(id);
  if (n.kind==="text") {
    if (n.text.style.styleId) styles.add(n.text.style.styleId);
    for (const run of n.text.runs) if (run.style.styleId) styles.add(run.style.styleId);
  }
  for (const id of Object.values(n.boundVariables ?? {})) bound.add(id);
  for (const id of Object.keys(n.variableModes ?? {})) collections.add(id);
}
function componentDependencies(doc:Document,ids:readonly string[]) {
  const needed=new Set<string>();
  for (const id of ids) {
    const n=doc.nodes[id];
    if (n.kind==="component") for (const prop of Object.values(n.props)) {
      if (prop.type==="instanceSwap") needed.add(prop.default);
      if (prop.type==="instanceSwap" || prop.type==="slot") for (const other of prop.preferred) needed.add(other);
    }
    if (n.kind==="instance") {
      needed.add(n.component);
      const main=doc.nodes[n.component];
      if (main?.kind==="component") for (const [key,prop] of Object.entries(main.props)) if (prop.type==="instanceSwap") {
        const v=n.props[key],target=parseNodeId(isLosslessNumber(v) ? v.value : v);
        if (target) needed.add(target);
      }
    }
  }
  return [...needed].sort((a,b)=>a.length-b.length || (a<b ? -1 : a>b ? 1 : 0));
}
export function libraryComponentUnits(doc:Document,roots:readonly string[]) {
  const stack=[...roots].reverse(),units=new Map<string,readonly string[]>();
  while (stack.length && units.size<100_000) {
    const root=stack.pop()!;
    if (units.has(root)) continue;
    const ids=subtreeIds(doc,root);
    units.set(root,ids);
    for (const id of componentDependencies(doc,ids)) {
      const dependency=componentRoot(doc,id);
      if (dependency && !units.has(dependency)) stack.push(dependency);
    }
  }
  return units;
}
