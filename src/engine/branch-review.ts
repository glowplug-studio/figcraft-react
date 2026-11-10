import { boundsOf } from "./viewport";
import { rectanglePaints, type Document, type DocumentNode } from "./document";
import { sameComponentValue as equal } from "./component-groups";
import { childrenOf, layerFields, type BranchDelta } from "./branch-diff";
import type { BranchConflict, BranchPlan } from "./branch-merge";
import type { FileBranch } from "./file-format";
import { subtreeIds } from "./hierarchy";
import { inspectedId } from "./parameters";
import { toCssHex, withAlpha } from "./colour";
import { stringify } from "lossless-json";

const words = (key: string) => key.replace(/([a-z])([A-Z])/g, "$1 $2").replaceAll("_", " ").toLowerCase();
const title = (value: string) => value[0]?.toUpperCase() + value.slice(1);
const display = (value: unknown): string => value == null ? "none" : typeof value === "boolean" ? value ? "on" : "off"
  : typeof value === "string" ? value : typeof value === "number" ? String(Number(value.toFixed(3)))
  : Array.isArray(value) ? value.map(display).join(", ") : stringify(value) ?? "none";
const typeName = (node: DocumentNode) => node.kind === "booleanOp" ? "BOOLEAN_OPERATION" : words(node.kind).replaceAll(" ", "_").toUpperCase();
const nameOf = (value: unknown) => value && typeof value === "object" && "name" in value ? String(value.name) : "";

interface Property { section: string; property: string; before: string; after: string; text: string }
interface Layer { id: string | number; name: string; type: string; change: "added" | "removed" | "changed"; depth: number; layers: number; properties?: Property[] }

function fillLabel(doc: Document, node: DocumentNode, style?: string | null) {
  const paints = node.kind === "page" ? node.fills ?? [] : rectanglePaints(node);
  const token = style && doc.styles?.find(s => s.id === style)?.name;
  return paints.filter(p => p.visible !== false).map((paint, index) => {
    let label: string;
    if (paint.type === "solid") label = toCssHex(withAlpha(paint.color, paint.color.a * paint.opacity));
    else if (paint.type === "gradient") label = paint.stops.map(stop => toCssHex(stop.color) + " " + Math.round(stop.position * 100) + "%").join(", ");
    else label = Math.round(paint.opacity * 100) + "%";
    return index === 0 && token ? label + " (" + token + ")" : label;
  });
}

const siblingRanks = new WeakMap<readonly string[], WeakMap<readonly string[], Map<string, number>>>();
function orderAmongRetained(list: readonly string[], other: readonly string[]) {
  let byOther = siblingRanks.get(list);
  if (!byOther) { byOther = new WeakMap(); siblingRanks.set(list, byOther); }
  let ranks = byOther.get(other);
  if (!ranks) {
    ranks = new Map();
    const retained = new Set(other);
    for (let i = list.length - 1; i >= 0; i--) if (retained.has(list[i])) ranks.set(list[i], ranks.size + 1);
    byOther.set(other, ranks);
  }
  return ranks;
}

function properties(before: Document, after: Document, id: string, only?: string, resolveStylesIn?: Document) {
  const b = before.nodes[id], a = after.nodes[id], out: Property[] = [];
  if (!b || !a) return out;
  const add = (key: string, section: string, property: string, previous: unknown, next: unknown) => {
    if (only && key !== only) return;
    const x = display(previous), y = display(next);
    if (x !== y) out.push({ section, property, before: x, after: y, text: property + " " + x + " → " + y });
  };
  if (b.parent !== a.parent) add("parent", "Layer", "parent", b.parent && before.nodes[b.parent]?.name, a.parent && after.nodes[a.parent]?.name);
  else if (a.parent && (only === "parent" || !only) && before.nodes[a.parent] !== after.nodes[a.parent]) {
    const left = childrenOf(before, a.parent), right = childrenOf(after, a.parent);
    add("parent", "Layer", "order", orderAmongRetained(left, right).get(id), orderAmongRetained(right, left).get(id));
  }
  if (b === a) return out;
  add("name", "Layer", "name", b.name, a.name);
  const x = layerFields(b), y = layerFields(a);
  add("visible", "Layer", "visibility", x.visible === false ? "hidden" : "visible", y.visible === false ? "hidden" : "visible");
  add("blend", "Layer", "blend", x.blend, y.blend);
  add("clip", "Layer", "clip content", x.clip, y.clip);
  if (b.kind === "text" && a.kind === "text") add("kind", "Layer", "text", b.text.characters, a.text.characters);
  add("kind", "Layer", "type", typeName(b), typeName(a));
  if (b.kind === "page" && a.kind === "page") {
    const old = boundsOf(before, b.children), next = boundsOf(after, a.children);
    add("transform", "Layout", "top", old?.y, next?.y); add("transform", "Layout", "left", old?.x, next?.x);
  } else if (b.kind !== "page" && a.kind !== "page") {
    add("width", "Layout", "width", b.width, a.width); add("height", "Layout", "height", b.height, a.height);
    add("transform", "Layout", "top", b.y, a.y); add("transform", "Layout", "left", b.x, a.x);
    add("opacity", "Layout", "opacity", Math.round((b.opacity ?? 1) * 100) + "%", Math.round((a.opacity ?? 1) * 100) + "%");
  }
  if (!only || only === "styles" || only === "fills") {
    const old = fillLabel(before, b, b.styles?.fill), next = fillLabel(resolveStylesIn ?? after, a, a.styles?.fill);
    for (let i = 0; i < Math.max(old.length, next.length); i++) {
      add(only ?? "fills", "Fills", i ? "fill " + (i + 1) : "fill", old[i], next[i]);
    }
  }
  const described = new Set(["name","visible","blend","clip","transform","width","height","opacity","fills","styles"]);
  for (const key of new Set([...Object.keys(x), ...Object.keys(y)])) {
    if (described.has(key) || equal(x[key], y[key])) continue;
    if (key === "kind" && (a.kind !== b.kind || a.kind === "text" && b.kind === "text" && a.text.characters !== b.text.characters)) continue;
    add(key, "Layer", words(key), x[key], y[key]);
  }
  return out;
}

function describeSide(base: Document, delta: BranchDelta) {
  const doc = delta.document, layers: Layer[] = [];
  let truncated = false;
  const append = (node: DocumentNode, depth: number, change: Layer["change"], n: number, changes?: Property[]) => {
    if (layers.length >= 2000) { truncated = true; return; }
    layers.push({ id: inspectedId(node.id), name: node.name, type: typeName(node), change, depth, layers: n, ...(changes?.length && { properties: changes }) });
  };
  const visit = (id: string, depth: number) => {
    if (truncated || depth > 256) return;
    const a = doc.nodes[id], b = base.nodes[id];
    if (!a) { append(b, depth, "removed", subtreeIds(base, id).length); return; }
    if (!b) { append(a, depth, "added", subtreeIds(doc, id).length); return; }
    const changes = properties(base, doc, id);
    if (changes.length) append(a, depth, "changed", 1, changes);
    const next = childrenOf(doc, id), old = childrenOf(base, id);
    for (let i = next.length - 1; i >= 0; i--) visit(next[i], depth + 1);
    for (let i = old.length - 1; i >= 0; i--) if (!doc.nodes[old[i]]) visit(old[i], depth + 1);
  };
  for (const page of doc.pages) visit(page, 0);
  for (const page of base.pages) if (!doc.nodes[page]) visit(page, 0);
  const document = [];
  for (const [key, edit] of delta.files) {
    const [kind, prop] = key.split("/");
    if (kind === "image") continue;
    const label = kind === "collection" ? "Variable collection" : title(kind);
    document.push({ what: kind === "doc" ? title(words(prop)) : label + " “" + nameOf(edit.value ?? edit.before) + "”",
      change: kind === "doc" ? "changed" : edit.operation });
  }
  return { layers, document, truncated };
}

function describeConflict(plan: BranchPlan, conflict: BranchConflict) {
  const { key, property, field, id, deletedBy } = conflict;
  if (!id) {
    const [kind, prop] = key.split("/");
    return { key, name: kind === "doc" ? "File" : nameOf(conflict.branch ?? conflict.main),
      property: kind === "doc" ? words(prop) : kind === "collection" ? "variable collection" : kind,
      branch: kind === "doc" ? "changed" : plan.branch.files.get(key)!.operation,
      main: kind === "doc" ? "changed" : plan.main.files.get(key)!.operation };
  }
  const branchDoc = plan.branch.document, mainDoc = plan.main.document;
  const common = { key, id: inspectedId(id), name: (mainDoc.nodes[id] ?? branchDoc.nodes[id] ?? plan.base.nodes[id]).name };
  if (deletedBy) return { ...common, property: "layer", deletedBy, branch: String(conflict.branch), main: String(conflict.main) };
  if (field) return { ...common, property: (property === "layout" ? "auto layout" : words(property)) + " " + words(field),
    branch: display(conflict.branch), main: display(conflict.main) };
  const differences = properties(mainDoc, branchDoc, id, property, mainDoc);
  const describe = (side: "before" | "after") => differences.map(p => p.property + " " + p[side]).join(", ") || "changed";
  return { ...common, property: property === "parent" ? "place in layers" : words(property), branch: describe("after"), main: describe("before") };
}

export function branchReview(record: FileBranch, plan: BranchPlan) {
  return { id: record.id, name: record.name, state: record.state, branch: describeSide(plan.base, plan.branch),
    main: describeSide(plan.base, plan.main), conflicts: plan.conflicts.map(c => describeConflict(plan, c)) };
}
