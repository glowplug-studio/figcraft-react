import { treeDiff, initialPositions, numericOrder, type WireFields } from "../branch-diff";
import { sameComponentValue } from "../component-groups";
import type { Document, DocumentNode } from "../document";
import { wireComment } from "../comments";
import { wireId } from "../native-values";
import { wireLibraryLinks } from "../published-library";
import { base64Bytes } from "../recovery";
import { wireSharedStyle } from "../shared-styles";
import { compareScalarKeys } from "../text-breaks";
import { blankNode, createNode, imageValue, sessionNodeFields } from "./document-session";
import { sessionJson, sessionKind, sessionProperty, sessionStyle } from "./session-json";
import type { InitialChange } from "./session-postcard";

export type LiveChange = InitialChange
  | { type: "set"; id: string; prop: string; value: string }
  | { type: "delete"; id: string }
  | { type: "remove"; entry: string; key: string };

export interface LiveReplica {
  readonly document: Document;
  readonly positions: ReadonlyMap<string, string>;
}

export function liveReplica(document: Document): LiveReplica {
  return { document, positions: initialPositions(document) };
}

const omitted: WireFields = {
  layout: null, childLayout: { sizing_h: "fixed", sizing_v: "fixed", absolute: false, min_w: null, max_w: null,
    min_h: null, max_h: null, grid_column: null, grid_row: null, grid_column_span: 0, grid_row_span: 0 },
  isMask: false, maskType: "alpha", overflow: "none", scrollPosition: "scrolls", boolOp: null, source: null,
  devStatus: "none", devChanged: false, devNote: "", annotations: [], codeLinks: [], devResources: [], measurements: [], board: null,
};

function jsonField(node: DocumentNode, fields: WireFields, prop: string) {
  if (prop === "kind") return sessionKind(fields.kind);
  const value = fields[prop] ?? omitted[prop] ?? blankNode(node.kind)[prop] ?? null;
  return sessionProperty(prop, value);
}

function listDelta<T extends { id: string }>(out: LiveChange[], family: string, plural: string,
  before: readonly T[] = [], after: readonly T[] = [], render: (item: T) => string) {
  if (before === after || sameComponentValue(before, after)) return;
  const old = new Map(before.map(item => [item.id, item])), next = new Set(after.map(item => item.id));
  if (old.size !== before.length || next.size !== after.length) {
    out.push({type:"setDoc", prop:plural, value:"[" + after.map(render).join(",") + "]"});
    return;
  }
  for (const item of after) if (!sameComponentValue(old.get(item.id), item)) {
    out.push({type:"put", entry:family, key:item.id, value:render(item)});
  }
  for (const item of before) if (!next.has(item.id)) out.push({type:"remove", entry:family, key:item.id});
  const natural = [...before.filter(item => next.has(item.id)), ...after.filter(item => !old.has(item.id))];
  if (!natural.every((item,i) => item.id === after[i].id)) {
    out.push({type:"setDoc", prop:family + "Order", value:sessionJson(after.map(item => family === "comment" ? wireId(item.id) : item.id))});
  }
}

async function documentChanges(before: Document, after: Document, out: LiveChange[]) {
  const set = (prop: string, a: unknown, b: unknown) => {
    if (!sameComponentValue(a,b)) out.push({type:"setDoc", prop, value:sessionJson(b)});
  };
  set("name",before.name,after.name);
  if (before.currentPage !== after.currentPage) out.push({type:"setDoc", prop:"currentPage", value:after.currentPage});
  set("documentColors",before.documentColours ?? [],after.documentColours ?? []);
  set("colorProfile",before.colourProfile ?? "srgb",after.colourProfile ?? "srgb");
  set("imagePresets",before.imagePresets ?? [],after.imagePresets ?? []);
  if (before.libraryLinks !== after.libraryLinks || before.libraryRecords !== after.libraryRecords || before.libraryStore !== after.libraryStore) {
    const libraries = (d: Document) => wireLibraryLinks(d.libraryLinks ?? [], d.libraryRecords, d.libraryStore);
    set("libraries",libraries(before),libraries(after));
  }
  listDelta(out,"style","styles",before.styles,after.styles,s => sessionStyle(wireSharedStyle(s)));
  listDelta(out,"comment","comments",before.comments,after.comments,c => sessionJson(wireComment(c)));
  listDelta(out,"collection","collections",before.variables?.collections,after.variables?.collections,sessionJson);
  listDelta(out,"variable","variables",before.variables?.variables,after.variables?.variables,sessionJson);
  if (before.images === after.images) return;
  for (const key of Object.keys(after.images ?? {}).sort(compareScalarKeys)) {
    const image = after.images![key], old = before.images?.[key];
    if (old === image || old && old.digest && old.digest === image.digest && old.width === image.width && old.height === image.height) continue;
    const bytes = new Uint8Array(await image.bytes.arrayBuffer());
    out.push({type:"put", entry:"image", key, value:imageValue(base64Bytes(bytes),image.height,image.width)});
  }
  for (const key of Object.keys(before.images ?? {}).sort(compareScalarKeys)) {
    if (!after.images?.[key]) out.push({type:"remove", entry:"image", key});
  }
}

export async function diffLive(from: LiveReplica, to: Document): Promise<{changes: LiveChange[]; replica: LiveReplica}> {
  if (from.document.nodes === to.nodes && from.document.pages === to.pages) {
    const changes: LiveChange[] = [];
    await documentChanges(from.document,to,changes);
    return {changes,replica:{document:to,positions:from.positions}};
  }
  const delta = treeDiff(from.document, to, from.positions);
  const changes: LiveChange[] = [];
  const added: string[] = [], deleted: string[] = [];
  const moves = delta.changes.filter(change => change.type === "move").sort((a,b) => numericOrder(a.id,b.id));
  let lastId: string | undefined, previous: WireFields = {}, next: WireFields = {};
  for (const edit of delta.changes) {
    if (edit.type === "add") added.push(edit.id);
    if (edit.type === "delete") deleted.push(edit.id);
    if (edit.type !== "set") continue;
    if (lastId !== edit.id) {
      lastId = edit.id;
      previous = sessionNodeFields(from.document.nodes[edit.id]);
      next = sessionNodeFields(to.nodes[edit.id]);
    }
    const value = jsonField(to.nodes[edit.id], next, edit.property);
    if (value !== jsonField(from.document.nodes[edit.id], previous, edit.property)) {
      changes.push({type:"set", id:edit.id, prop:edit.property, value});
    }
  }
  const depths = new Map<string,number>();
  const depth = (id: string) => {
    const path: string[] = [];
    let cursor: string | null = id;
    while (cursor !== null && !depths.has(cursor)) { path.push(cursor); cursor = to.nodes[cursor].parent; }
    let level = cursor === null ? -1 : depths.get(cursor)!;
    for (const child of path.reverse()) depths.set(child, ++level);
    return depths.get(id)!;
  };
  for (const id of added.sort((a,b) => depth(a)-depth(b) || numericOrder(a,b))) {
    changes.push(createNode(to.nodes[id],delta.positions.get(id) ?? "a0"));
  }
  for (const move of moves) {
    if (move.parentChanged) changes.push({type:"set", id:move.id, prop:"parent", value:move.parent ?? "null"});
    changes.push({type:"set", id:move.id, prop:"position", value:sessionJson(move.position)});
  }
  for (const id of deleted.sort(numericOrder)) changes.push({type:"delete", id});
  await documentChanges(from.document,to,changes);
  return {changes, replica:{document:to, positions:delta.positions}};
}
