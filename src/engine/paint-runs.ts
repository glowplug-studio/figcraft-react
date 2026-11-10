import type { Document } from "./document";

// Reverse the order of mask runs while preserving paint order inside each run.
const reverseRunIndices = new WeakMap<Document, WeakMap<readonly string[], readonly number[]>>();
export function reversedRuns(document: Document, children: readonly string[]) {
  let frames = reverseRunIndices.get(document);
  if (!frames) reverseRunIndices.set(document, frames = new WeakMap());
  const cached = frames.get(children);
  if (cached) return cached;
  const starts: number[] = [];
  for (let i = 0; i < children.length;) {
    starts.push(i);
    const node = document.nodes[children[i++]];
    if (node?.isMask && (node.kind === "page" || node.visible !== false))
      while (i < children.length && !document.nodes[children[i]]?.isMask) i++;
  }
  frames.set(children, starts.reverse());
  return starts;
}
