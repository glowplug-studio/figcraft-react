import type { NodeId } from "./document";
import type { HierarchyDraft } from "./hierarchy";
import { parseNumber } from "./parameters";
import type { VectorNetwork, VectorRegion } from "./vector-network";

function areaIndex(value: unknown, name: string): number {
  const index = parseNumber(value, name);
  if (!Number.isInteger(index) || index < 0 || index >= 1e9) throw new Error(`${name} out of range`);
  return index;
}

export function setFillRule(draft: HierarchyDraft, ids: readonly NodeId[], params: Record<string, unknown>) {
  const name = typeof params.rule === "string" ? params.rule.trim() : "";
  let rule: VectorRegion["winding"];
  if (["nonZero", "nonzero", "NONZERO"].includes(name)) rule = "nonZero";
  else if (["evenOdd", "evenodd", "EVENODD"].includes(name)) rule = "evenOdd";
  else throw new Error("rule is nonZero or evenOdd");
  const index = params.region == null ? undefined : areaIndex(params.region, "region");
  let count = 0;
  for (const id of ids) {
    const node = draft.nodes[id];
    if (node.kind !== "vector") continue;
    let changed = false;
    const regions = node.network.regions.map((region, i) => {
      if (index !== undefined && i !== index) return region;
      count++;
      if (region.winding === rule) return region;
      changed = true;
      return Object.freeze({ ...region, winding: rule });
    });
    if (changed) draft.set({ ...node, network: Object.freeze({ ...node.network, regions: Object.freeze(regions) }) });
  }
  if (!count) throw new Error("no filled area to set (select a vector)");
  return { regions: count, rule };
}

/** Only short loops depend on how an edge is stored. Long loops follow their list order. */
function reversibleSegment(net: VectorNetwork, regionIndex: number, loopIndex: number, loop: readonly number[]) {
  if (loop.length > 2) return undefined;
  const busy = new Set<number>();
  net.regions.forEach((region, r) => region.loops.forEach((other, l) => {
    if ((r !== regionIndex || l !== loopIndex) && other.length <= 2) for (const edge of other) busy.add(edge);
  }));
  const free = loop.filter(edge => !busy.has(edge));
  if (!free.length) throw new Error("the loop shares its segments with another one- or two-segment loop");
  return Math.min(...free);
}

export function reverseLoop(draft: HierarchyDraft, ids: readonly NodeId[], params: Record<string, unknown>) {
  const r = areaIndex(params.region, "region"), l = areaIndex(params.loop, "loop");
  const flips = [];
  for (const id of ids) {
    const node = draft.nodes[id];
    if (node.kind !== "vector") continue;
    const loop = node.network.regions[r]?.loops[l];
    if (loop?.length) flips.push({ id, turned: [...loop].reverse(), store: reversibleSegment(node.network, r, l, loop) });
  }
  if (!flips.length) throw new Error("no such loop (select a vector with filled areas)");
  for (const { id, turned, store } of flips) {
    const node = draft.nodes[id];
    if (node.kind !== "vector") continue;
    const net = node.network;
    let segments = net.segments;
    if (store !== undefined && segments[store]) {
      const s = segments[store], changed = [...segments];
      changed[store] = Object.freeze({ ...s, a: s.b, b: s.a, ta: s.tb, tb: s.ta });
      segments = Object.freeze(changed);
    }
    const regions = [...net.regions], region = regions[r], loops = [...region.loops];
    loops[l] = Object.freeze(turned);
    regions[r] = Object.freeze({ ...region, loops: Object.freeze(loops) });
    draft.set({ ...node, network: Object.freeze({ ...net, segments, regions: Object.freeze(regions) }) });
  }
  return { reversed: true };
}
