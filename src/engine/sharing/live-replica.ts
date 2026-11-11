import { parse } from "lossless-json";
import { numericOrder, nodePropertyOrder, rawLayerFields, standardFields, type WireFields } from "../branch-diff";
import { validatePosition } from "../branch-position";
import { isDocumentNodeKind, layerTransform, type DocumentNode } from "../document";
import { readNode } from "../file-format";
import { id, idString, wireId } from "../native-values";
import { blankNode, sessionNodeFields } from "./document-session";
import type { LiveChange, LiveReplica } from "./live-changes";
import { applyLiveDocumentChange } from "./live-document";

function nodeKind(raw: string): WireFields {
  const kind = parse(raw);
  if (!kind || typeof kind !== "object" || !("type" in kind) || typeof kind.type !== "string") throw new Error("Invalid live layer kind");
  if (Object.keys(kind).some(key => standardFields.has(key))) throw new Error("Layer kind contains a separate property");
  return kind as WireFields;
}

function readLayer(key: string, parent: string | null, fields: WireFields) {
  // Sibling order is owned by the replica. It is materialised after the batch.
  const raw = rawLayerFields(fields);
  return readNode(key,{...raw,id:wireId(key),parent:parent === null ? null : wireId(parent),children:[]});
}

function setField(fields: WireFields, prop: string, value: string) {
  if (prop === "parent" || !nodePropertyOrder.includes(prop)) throw new Error("Invalid live layer property " + prop);
  fields[prop] = prop === "kind" ? nodeKind(value) : parse(value);
}

function createLayer(change: Extract<LiveChange,{type:"create"}>) {
  const kind = nodeKind(change.kind), tag = kind.type;
  if (!isDocumentNodeKind(tag)) throw new Error("Unsupported live layer kind");
  const fields = { ...blankNode(tag), kind };
  for (const [prop,value] of change.props) {
    if (prop === "kind") throw new Error("A created layer carries its kind separately");
    setField(fields,prop,value);
  }
  return readLayer(change.id,change.parent,fields);
}

/** Apply on an isolated draft. Strict errors leave the caller's entire replica untouched. */
export async function applyLive(from: LiveReplica, changes: readonly LiveChange[], mode: "strict" | "lenient" = "strict") {
  const deleted = new Set<string>(), touched = new Set<string>();
  if (!changes.length) return { replica:from, skipped:0, deleted, touched };
  let doc = from.document, skipped = 0;
  const hasLayerChanges = changes.some(change => ["create","delete","set"].includes(change.type));
  const nodes: Record<string,DocumentNode> = hasLayerChanges ? Object.assign(Object.create(null),doc.nodes) : doc.nodes;
  const changedPositions = hasLayerChanges ? new Map(from.positions) : undefined;
  const positions = changedPositions ?? from.positions, families = new Map<string | null,Set<string>>();
  const children = (parent: string | null) => {
    let result = families.get(parent);
    if (!result) {
      const node = parent === null ? undefined : from.document.nodes[parent];
      result = new Set(parent === null ? [...from.document.pages,...(from.document.libraryStore?.root ? [from.document.libraryStore.root] : [])] :
        node && "children" in node ? node.children : []);
      families.set(parent,result);
    }
    return result;
  };
  const parentFor = (key: string, parent: string | null, page: boolean) => {
    if ((parent === null) !== page) throw new Error("Only pages have no parent");
    if (parent === null) return;
    if (!nodes[parent] || !("children" in nodes[parent])) throw new Error("A layer requires a container parent");
    for (let cursor: string | null = parent; cursor !== null; cursor = nodes[cursor].parent) {
      if (cursor === key) throw new Error("Cyclic layer parent");
    }
  };
  for (const change of changes) {
    try {
      if (change.type === "setDoc" || change.type === "put" || change.type === "remove") {
        doc = await applyLiveDocumentChange(doc,change);
        if (change.type === "setDoc" && change.prop === "libraries") children(null);
        continue;
      }
      if (change.type !== "create" && change.type !== "delete" && change.type !== "set") throw new Error("Invalid live operation");
      if (typeof change.id !== "string") throw new Error("Invalid live layer ID");
      const key = idString(change.id,"live layer"), prior = nodes[key];
      if (change.type === "create") {
        if (prior) throw new Error("Layer already exists: " + key);
        validatePosition(change.position);
        const node = createLayer(change);
        parentFor(key,change.parent,node.kind === "page");
        nodes[key] = node;
        children(change.parent).add(key);
        changedPositions!.set(key,change.position);
      } else if (change.type === "delete") {
        if (!prior) continue;
        if (prior.kind === "page") {
          const roots = children(null);
          const visiblePages = roots.size - Number(!!doc.libraryStore?.root && roots.has(doc.libraryStore.root));
          if (visiblePages <= 1) throw new Error("A drawing needs at least one page");
        }
        children(prior.parent).delete(key);
        const stack = [key];
        while (stack.length) {
          const next = stack.pop()!;
          for (const child of children(next)) stack.push(child);
          families.set(next,new Set());
          touched.add(next);
          deleted.add(next);
          delete nodes[next];
          changedPositions!.delete(next);
        }
      } else {
        if (!prior) throw new Error("No such layer: " + key);
        if (change.prop === "position") {
          const position = parse(change.value);
          if (typeof position !== "string") throw new Error("Invalid layer position");
          validatePosition(position);
          changedPositions!.set(key,position);
          children(prior.parent);
        } else if (change.prop === "parent") {
          const raw = parse(change.value), parent = raw === null ? null : id(raw,"live parent");
          parentFor(key,parent,prior.kind === "page");
          if (parent !== null && prior.kind !== "page" && prior.parent !== parent) {
            children(prior.parent).delete(key);
            children(parent).add(key);
            nodes[key] = Object.freeze({...prior,parent});
          }
        } else {
          const fields = sessionNodeFields(prior);
          setField(fields,change.prop,change.value);
          const node = readLayer(key,prior.parent,fields);
          if ((node.kind === "page") !== (prior.kind === "page")) throw new Error("A page cannot become a layer");
          if (mode === "lenient" && "children" in prior && !("children" in node) && children(key).size) throw new Error("This layer still has children");
          if ("children" in prior || "children" in node) children(key);
          nodes[key] = node;
        }
      }
      touched.add(key);
    } catch (error) {
      if (mode === "strict") throw error;
      skipped++;
    }
  }
  const sort = (a: string,b: string) => {
    const x = positions.get(a) ?? "a0", y = positions.get(b) ?? "a0";
    return x < y ? -1 : x > y ? 1 : numericOrder(a,b);
  };
  let pages = doc.pages;
  for (const [parent,ids] of families) {
    if (parent !== null) touched.add(parent);
    if (parent === null) {
      pages = Object.freeze([...ids].filter(key => key !== doc.libraryStore?.root && nodes[key]?.kind === "page").sort(sort));
    } else if (nodes[parent]) {
      const node = nodes[parent];
      if ("children" in node) nodes[parent] = Object.freeze({...node,children:Object.freeze([...ids].sort(sort))});
      else if (ids.size) throw new Error("This layer cannot contain children");
    }
  }
  if (!pages.length) throw new Error("A drawing needs at least one page");
  if (mode === "strict") for (const key of touched) {
    const n = nodes[key];
    if (!n) continue;
    if (n.opacity !== undefined && (n.opacity < 0 || n.opacity > 1)) throw new Error("Layer opacity is outside 0–1");
    if (n.kind === "page") continue;
    if (n.width > 1e9 || n.height > 1e9 || layerTransform(n).some(v => Math.abs(v) > 1e9)) throw new Error("Layer geometry exceeds the live coordinate limit");
  }
  const currentPage = pages.includes(doc.currentPage) ? doc.currentPage : pages[0];
  return { replica:{document:Object.freeze({...doc,nodes:Object.freeze(nodes),pages,currentPage}), positions}, skipped, deleted, touched };
}
