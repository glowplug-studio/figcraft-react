import { isLosslessNumber } from "lossless-json";
import { newDocument, isLeaf, type Document, type DocumentNode, type LayerNode, type PageNode } from "./document";
import { componentRoot, libraryComponentUnits } from "./library-component-source";
import { importLibraryComponents, localiseComponent } from "./library-components";
import { libraryComponent, type ImportedComponent } from "./library-store";
import { subtreeIds } from "./hierarchy";
import { parseNodeId } from "./parameters";
import { U64_MAX, wireId } from "./native-values";
import { remapLayerReferences } from "./pattern-sources";

const numeric = (a: string, b: string) => a.length - b.length || (a < b ? -1 : a > b ? 1 : 0);

export function adoptClipboardComponents(document: Document, source: Document, copied: ReadonlyMap<string, string>, nextId: bigint) {
  const roots = new Set<string>();
  for (const id of copied.keys()) {
    const node = source.nodes[id];
    if (node?.kind !== "instance") continue;
    const main = source.nodes[node.component], root = componentRoot(source, node.component);
    if (root) roots.add(root);
    if (main?.kind === "component") for (const [key, definition] of Object.entries(main.props)) if (definition.type === "instanceSwap") {
      const value = node.props[key], choice = parseNodeId(isLosslessNumber(value) ? value.value : value);
      const root = choice && componentRoot(source, choice);
      if (root) roots.add(root);
    }
  }
  const own = document.published?.manifest.id, maps = new Map<string, string>();
  const local = new Map(document.libraryStore?.components.map(r => [r.library + "/" + r.key, r]));
  const fresh: ImportedComponent[] = [], needed = new Set<string>();
  const ordered = [...roots].sort(numeric);
  for (const root of libraryComponentUnits(source, ordered.filter(id => !!libraryComponent(source, id))).keys()) {
    const original = libraryComponent(source, root);
    if (!original) continue;
    if (original.library === own) {
      for (const [authorId, sourceId] of Object.entries(original.ids)) if (document.nodes[authorId]) maps.set(sourceId, authorId);
    } else needed.add(original.root);
  }
  const links = [...document.libraryLinks ?? []];
  for (const id of needed) {
    const original = libraryComponent(source, id)!;
    if (links.some(link => link.id === original.library)) continue;
    const link = source.libraryLinks?.find(l => l.id === original.library);
    if (link) links.push(link);
  }
  if (links.length !== (document.libraryLinks?.length ?? 0)) document = { ...document, libraryLinks: Object.freeze(links) };
  const allocate = () => {
    while (document.nodes[String(nextId)]) nextId++;
    if (nextId > U64_MAX) throw new Error("Document identifiers are exhausted");
    return String(nextId++);
  };
  for (const record of source.libraryStore?.components ?? []) if (needed.has(record.root)) {
    const exists = local.get(record.library + "/" + record.key);
    if (exists && document.nodes[exists.root]) {
      for (const [key, id] of Object.entries(record.ids)) if (exists.ids[key]) maps.set(id, exists.ids[key]);
    } else fresh.push(record);
  }
  for (const record of fresh) for (const id of subtreeIds(source, record.root)) maps.set(id, allocate());
  if (fresh.length) {
    const store = document.libraryStore ?? { components: [], inserted: [], detached: [] };
    const root = document.libraryStore?.root ?? allocate();
    const nodes: Record<string, DocumentNode> = { ...document.nodes }, components = [...store.components];
    const page = nodes[root] as PageNode | undefined;
    const added: string[] = [];
    for (const record of fresh) {
      const target = maps.get(record.root)!;
      added.push(target);
      const ids = Object.fromEntries(Object.entries(record.ids).filter(([, id]) => maps.has(id)).map(([key, id]) => [key, maps.get(id)!]));
      components.push({ ...record, root: target, ids });
      for (const id of subtreeIds(source, record.root)) {
        const original = source.nodes[id];
        if (original.kind === "page") throw new Error("A component cannot contain a page");
        const { source: previous, thumbnailFlag: _flag, ...node } = localiseComponent(source, original, maps);
        const pasted: LayerNode = { ...node, id: maps.get(id)!, parent: id === record.root ? root : maps.get(original.parent)!,
          ...(!isLeaf(original) && { children: original.children.map(child => maps.get(child)!) }),
          ...(previous && maps.has(previous) && { source: maps.get(previous) }) };
        nodes[pasted.id] = remapLayerReferences(pasted, key => maps.get(key));
      }
    }
    nodes[root] = { ...(page ?? newDocument().nodes["1"] as PageNode), id: root, name: page?.name ?? "Library components",
      children: Object.freeze([...page?.children ?? [], ...added]) };
    document = { ...document, nodes: Object.freeze(nodes), libraryStore: { ...store, root, components } };
  }
  const published = source.published;
  if (published && published.manifest.id !== own) {
    const authored = ordered.filter(id => !libraryComponent(source, id) && published.document.nodes[id] && published.manifest.components.some(c => c.id === id));
    if (authored.length) {
      const imported = importLibraryComponents(document, published, authored, nextId);
      document = imported.document; nextId = imported.nextId;
      for (const [key, value] of imported.ids) maps.set(key, value);
    }
  }
  const behind = new Map<string, string>();
  function follow(id: string) {
    let local = copied.get(id) ?? maps.get(id) ?? behind.get(id);
    if (!local) { local = allocate(); behind.set(id, local); }
    return local;
  }
  const nodes = { ...document.nodes };
  for (const [oldId, newId] of [...copied].sort(([a], [b]) => numeric(a, b))) {
    const original = source.nodes[oldId], node = nodes[newId];
    if (!node || original.kind === "page" || node.kind === "page") continue;
    let remapped = node;
    if (original.source) remapped = { ...remapped, source: follow(original.source) };
    if (node.kind === "instance" && original.kind === "instance") {
      const main = source.nodes[original.component], props = { ...node.props };
      if (main?.kind === "component") for (const [key, def] of Object.entries(main.props)) if (def.type === "instanceSwap" && key in props) {
        const choice = original.props[key], id = parseNodeId(isLosslessNumber(choice) ? choice.value : choice);
        const target = id && (copied.get(id) ?? maps.get(id));
        if (target) props[key] = wireId(target); else delete props[key];
      }
      remapped = { ...node, ...(original.source && { source: follow(original.source) }), component: follow(original.component), props };
    }
    nodes[newId] = Object.freeze(remapped);
  }
  return { document: Object.freeze({ ...document, nodes: Object.freeze(nodes) }), nextId };
}
