import { inverse, multiply, type Affine } from "./affine";
import type { Point } from "./geometry";
import { requiredTargets } from "./arrange";
import { adoptClipboardComponents } from "./clipboard-components";
import { insertInstance } from "./component-instances";
import { isFrameLike, isLeaf, rectanglePaints, withLayerTransform, type Document } from "./document";
import { ancestors, HierarchyDraft, rootIds, subtreeIds, worldTransform, zSorted } from "./hierarchy";
import { countLibraryInstances } from "./library-store";
import { inspectedId, parseNodeId, parseNumber } from "./parameters";
import { remapLayerReferences } from "./pattern-sources";
import { validateChangedGeometry } from "./rotation";
import { boundsOf, viewOrigin, type Viewport } from "./viewport";

export const layerClipboardSpecs = {
  "edit.copy": { label: "Copy", undo: false }, "edit.cut": { label: "Cut", undo: true },
  "edit.paste": { label: "Paste", undo: true }, "edit.pasteOver": { label: "Paste over selection", undo: true },
  "edit.pasteReplace": { label: "Paste to replace", undo: true },
} as const;
export type PasteCommand = "edit.paste" | "edit.pasteOver" | "edit.pasteReplace";

export function captureLayers(source: Document, selection: readonly string[], params: Record<string, unknown>, identity: symbol, cut: boolean) {
  const ids = requiredTargets(source, selection, params).filter(id => source.nodes[id].kind !== "page");
  if (!ids.length) throw new Error("Pages can't be copied; use page.duplicate");
  const roots = zSorted(source, rootIds(source, ids));
  const components = new Set(roots.filter(id => !cut && (source.nodes[id].kind === "component" || source.nodes[id].kind === "componentSet")));
  const images: Record<string, NonNullable<Document["images"]>[string]> = Object.create(null);
  for (const root of roots) for (const id of subtreeIds(source, root)) {
    const n = source.nodes[id];
    if (n.kind === "page") continue;
    for (const paint of [...rectanglePaints(n), ...n.strokes ?? []]) if (paint.type === "image" && source.images?.[paint.image]) {
      images[paint.image] = source.images[paint.image];
    }
  }
  return { identity, source, roots, components, images, bounds: boundsOf(source, roots) };
}
export type CopiedLayers = ReturnType<typeof captureLayers> & { mirror?: string };

function placement(document: Document, selection: readonly string[], clip: CopiedLayers, local: boolean,
  view: Viewport, params: Record<string, unknown>) {
  const node = selection.length === 1 ? document.nodes[selection[0]] : undefined;
  const nest = isFrameLike(node) && node.kind !== "instance" && !(local && [node.id, ...ancestors(document, node.id)].some(id => clip.components.has(id)));
  const target = parseNodeId(params.parent) ?? (nest ? node.id : undefined), parent = target ?? document.currentPage;
  if (params.x != null && params.y != null) return { parent, at: { x: parseNumber(params.x), y: parseNumber(params.y) } };
  const b = clip.bounds;
  if (!b) return { parent };
  if (target) {
    const frame = boundsOf(document, [target]);
    if (frame && (b.x < frame.x || b.y < frame.y || b.x + b.width > frame.x + frame.width || b.y + b.height > frame.y + frame.height)) {
      return { parent, at: { x: frame.x + (frame.width - b.width) / 2, y: frame.y + (frame.height - b.height) / 2 } };
    }
  } else {
    const origin = viewOrigin(view);
    if (b.x + b.width <= origin.x || b.y + b.height <= origin.y || b.x >= origin.x + view.vw / view.zoom || b.y >= origin.y + view.vh / view.zoom
      || !b.width || !b.height) return { parent, at: { x: view.cx - b.width / 2, y: view.cy - b.height / 2 } };
  }
  return { parent };
}

function pasteInto(document: Document, parent: string, at: Point | undefined, clip: CopiedLayers, local: boolean, nextId: bigint, index?: number) {
  const images = { ...clip.images, ...document.images };
  const draft = new HierarchyDraft(Object.keys(clip.images).length ? { ...document, images: Object.freeze(images) } : document);
  const mapping = new Map<string, string>(), pasted: string[] = [];
  const shift: Affine = at && clip.bounds ? [1, 0, 0, 1, at.x - clip.bounds.x, at.y - clip.bounds.y] : [1, 0, 0, 1, 0, 0];
  const parentShift = multiply(inverse(worldTransform(document, parent)), shift);
  for (const root of clip.roots) {
    const transform = multiply(parentShift, worldTransform(clip.source, root));
    const main = document.nodes[root], rootIndex = index === undefined ? undefined : index + pasted.length;
    if (local && clip.components.has(root) && main?.kind === "component") {
      const output = insertInstance(draft, main, parent, transform, nextId, rootIndex);
      pasted.push(output.id); nextId = output.nextId; continue;
    }
    const ids = subtreeIds(clip.source, root), own = new Map<string, string>();
    let previousAllocated: string | undefined;
    for (const old of ids) {
      const allocated = draft.allocateId(nextId);
      if (allocated.id === previousAllocated) throw new Error("Document identifiers are exhausted");
      previousAllocated = allocated.id;
      nextId = allocated.nextId; own.set(old, allocated.id); mapping.set(old, allocated.id);
    }
    for (const old of ids) {
      const node = clip.source.nodes[old];
      if (node.kind === "page") throw new Error("Pages cannot be pasted");
      let copy = remapLayerReferences(node, key => own.get(key));
      if (copy.kind === "instance" && own.has(copy.component)) copy = { ...copy, component: own.get(copy.component)! };
      if (old === root) copy = withLayerTransform(copy, transform);
      const id = own.get(old)!;
      draft.insert({ ...copy, id, ...(!isLeaf(copy) && { children: Object.freeze([]) }) },
        old === root ? parent : own.get(node.parent)!, old === root ? rootIndex : undefined);
    }
    pasted.push(own.get(root)!);
  }
  let output = validateChangedGeometry(draft);
  if (!local) {
    const adopted = adoptClipboardComponents(output, clip.source, mapping, nextId);
    output = adopted.document; nextId = adopted.nextId;
  }
  return { document: countLibraryInstances(output, pasted, "inserted"), ids: pasted, nextId };
}

export function pasteLayers(command: PasteCommand, doc: Document, selection: readonly string[], nextId: bigint,
  params: Record<string, unknown>, clip: CopiedLayers | undefined, identity: symbol, view: Viewport) {
  if (!clip?.roots.length) throw new Error("The clipboard is empty");
  const local = identity === clip.identity;
  let document = doc;
  const ids: string[] = [];
  if (command === "edit.pasteReplace") {
    for (const target of requiredTargets(doc, selection, params)) {
      const node = document.nodes[target];
      if (!node) continue;
      if (node.kind === "page") throw new Error("Can't replace a page");
      const siblings = document.nodes[node.parent];
      if (!("children" in siblings)) throw new Error("Invalid parent");
      const added = pasteInto(document, node.parent, boundsOf(document, [target]), clip, local, nextId, siblings.children.indexOf(target));
      const draft = new HierarchyDraft(added.document);
      draft.remove(target);
      document = validateChangedGeometry(draft); nextId = added.nextId; ids.push(...added.ids);
    }
  } else {
    const first = selection[0], target = command === "edit.pasteOver"
      ? { parent: doc.nodes[first]?.parent ?? doc.currentPage, at: first ? boundsOf(doc, [first]) : undefined }
      : placement(doc, selection, clip, local, view, params);
    const added = pasteInto(doc, target.parent, target.at, clip, local, nextId);
    document = added.document; nextId = added.nextId; ids.push(...added.ids);
  }
  return { document, nextId, selection: Object.freeze(ids), result: { ids: ids.map(inspectedId) } };
}
