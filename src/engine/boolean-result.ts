import { transformPoint } from "./affine";
import type { PathCommand } from "./corners";
import { isLeaf, layerTransform, rectanglePaints, type BooleanNode, type BooleanOperation, type Document, type LayerNode, type VectorNode } from "./document";
import { booleanStep, normaliseBooleanPath, outlineBand } from "./path-boolean";
import { BooleanComplexityError, BooleanFoldBudget } from "./path-budget";
import { shapePath } from "./shape-path";
import { sideStrokeGeometry } from "./side-stroke";
import { capShape, hasVisibleStroke } from "./stroke";
import { mapVectorPath } from "./vector-region-selection";
import { freezeNetwork, networkFromPath } from "./vector-network";
import { vectorFillPath } from "./vector-path";
import { drawnVectorNetwork } from "./vector-rounded";
import { hasRegionPaints, vectorPaintRegions } from "./vector-presentation";
import { vectorStrokePlan } from "./vector-stroke";

type Path = readonly PathCommand[];
type Prefix = { operand: Path; op: BooleanOperation; result: Path };
const snapshots = new WeakMap<Document, Map<string, VectorNode | Error>>();
const prefixes = new Map<string, Prefix[]>();

// Keep a refusal while its immutable operand subtree is unchanged. A reference to a retired
// document must not retain its vectors, undo history or unrelated pages.
type Refusal = { snapshot: WeakRef<Document>; error: BooleanComplexityError };
const refused = new WeakMap<BooleanNode, Map<number, Refusal>>();

function sameSubtree(previous: Document, doc: Document, node: LayerNode, depth: number): boolean {
  if (previous.nodes[node.id] !== node) return false;
  if (isLeaf(node) || node.visible === false || depth >= 64) return true;
  return node.children.every(id => {
    const child = doc.nodes[id];
    return child && child.kind !== "page" && sameSubtree(previous, doc, child, depth + 1);
  });
}

function samePath(a: Path, b: Path) {
  return a === b || a.length === b.length && a.every((cmd,i) => cmd.length === b[i].length && cmd.every((v,j) => v === b[i][j]));
}
function asVector(node: LayerNode, path: Path): VectorNode {
  const net = networkFromPath(path);
  return Object.freeze({ ...node, kind: "vector", network: freezeNetwork({ ...net, regions: net.regions.map(r => ({ ...r, winding: "evenOdd" })) }) });
}

function strokeOutline(node: LayerNode, vector: VectorNode): Path {
  const sides = sideStrokeGeometry(node);
  if (sides) return sides.hole.length ? booleanStep(normaliseBooleanPath(sides.outer,true),normaliseBooleanPath(sides.hole,true),"subtract") : normaliseBooleanPath(sides.outer,true);
  const plan = vectorStrokePlan(vector);
  let area: Path = plan.outline ?? [];
  if (!plan.outline) {
    const bands: PathCommand[] = [];
    for (const band of plan.bands) {
      const cap = (index: number) => { const c = capShape(band.caps[index]); return c === "none" ? "butt" : c; };
      const bandPath = band.outline ?? outlineBand(band.path, plan.width, band.join, plan.miter, [cap(0),cap(1)], band.dash);
      for (const cmd of bandPath) bands.push(cmd);
    }
    area = normaliseBooleanPath(bands);
  }
  if (plan.align !== "center") area = booleanStep(area, normaliseBooleanPath(plan.clip,plan.rule === "evenodd"), plan.align === "inside" ? "intersect" : "subtract");
  return plan.arrows.length ? booleanStep(area,plan.arrows,"union") : area;
}

function transformed(node: LayerNode, path: Path): Path {
  const matrix = layerTransform(node);
  return mapVectorPath(path, p => transformPoint(matrix,p));
}
function operandPath(doc: Document, node: LayerNode, depth: number): Path | undefined {
  if (depth > 64 || node.visible === false) return;
  if ((node.kind === "frame" || node.kind === "group") && node.children.length) {
    const combined: PathCommand[] = [];
    if (node.kind === "frame") {
      const path = shapePath(node);
      const frame = rectanglePaints(node).some(p=>p.visible) ? path : hasVisibleStroke(node) ? strokeOutline(node,asVector(node,path)) : [];
      for (const c of frame) combined.push(c);
    }
    for (const id of node.children) {
      const child = doc.nodes[id]; if (!child || child.kind === "page") continue;
      const path = operandPath(doc,child,depth+1);
      if (path) for (const c of transformed(child,path)) combined.push(c);
    }
    return combined;
  }
  if (node.kind === "group") return;
  const vector = node.kind === "booleanOp" ? booleanResult(doc,node,depth) : node.kind === "vector" ? node : undefined;
  if (node.kind === "booleanOp" && !vector) return;
  if (!rectanglePaints(node).some(p=>p.visible) && hasVisibleStroke(node)) return strokeOutline(node,vector ?? asVector(node,shapePath(node)));
  if (vector) {
    if (hasRegionPaints(vector)) {
      const areas: PathCommand[] = [];
      for (const area of vectorPaintRegions(vector)) if (area.paints.some(p=>p.visible)) {
        for (const c of normaliseBooleanPath(area.path,area.rule === "evenodd")) areas.push(c);
      }
      return normaliseBooleanPath(areas);
    }
    return vectorFillPath(drawnVectorNetwork(vector));
  }
  return shapePath(node);
}

/** The last prefixes for a group can survive an immutable snapshot, including a captured drag. */
function resultPath(doc: Document, node: BooleanNode, depth: number): Path {
  const old = prefixes.get(node.id) ?? [], next: Prefix[] = [], budget = new BooleanFoldBudget();
  let current: Path = [], matching = true, operandCount = 0, retained = 0;
  for (const id of node.children) {
    const child = doc.nodes[id];
    if (!child || child.kind === "page") continue;
    const local = operandPath(doc,child,depth+1); if (!local) continue;
    const path = transformed(child,local), op = child.boolOp ?? node.op, index = operandCount++, prior = old[index];
    matching = matching && !!prior && (!index || prior.op === op) && samePath(prior.operand,path);
    if (matching) current = prior.result;
    else if (index) { budget.spend(current,path); current = booleanStep(current,path,op); }
    else current = path;
    retained += path.length + current.length;
    if (retained <= 30_000) next.push({ operand: path, op, result: current });
    else next.length = 0;
  }
  prefixes.delete(node.id);
  // Bound retained geometry across documents and edits, including large intermediate unions.
  if (retained <= 30_000) {
    if (prefixes.size >= 64) prefixes.delete(prefixes.keys().next().value!);
    prefixes.set(node.id,next);
  }
  return operandCount === 1 ? normaliseBooleanPath(current) : current;
}

export function booleanResult(doc: Document, node: BooleanNode, depth = 0, required = false): VectorNode | undefined {
  let cache = snapshots.get(doc);
  if (!cache) { cache = new Map(); snapshots.set(doc,cache); }
  // Depth is significant inside nested subtrees. Root results also serve rendering and hit tests.
  const key = depth + ":" + node.id;
  let value = cache.get(key);
  if (!value) {
    const refusal = refused.get(node)?.get(depth);
    const previous = refusal?.snapshot.deref();
    if (previous && refusal && sameSubtree(previous, doc, node, depth)) {
      value = refusal.error;
      refusal.snapshot = new WeakRef(doc);
    } else {
      try { value = asVector(node, resultPath(doc, node, depth)); }
      catch (error) {
        value = error instanceof Error ? error : new Error("Invalid boolean geometry");
        if (error instanceof BooleanComplexityError) {
          const byDepth = refused.get(node) ?? new Map<number, Refusal>();
          byDepth.set(depth, { snapshot: new WeakRef(doc), error });
          refused.set(node, byDepth);
        }
      }
    }
    cache.set(key,value);
  }
  if (value instanceof Error) { if (required) throw value; return; }
  return value;
}
