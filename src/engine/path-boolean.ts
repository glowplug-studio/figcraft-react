/// <reference path="./paper-core.d.ts" />
import paper from "paper/dist/paper-core.js";
import type { PathCommand } from "./corners";
import { commands, emptyCompound, operand } from "./paper-path";
import type { Rectangle } from "./geometry";
import { BooleanFoldBudget, checkBooleanStep } from "./path-budget";
import { pathBounds } from "./vector-path";

import type { BooleanOperation } from "./document";
export type { BooleanOperation } from "./document";
type Path = readonly PathCommand[];
const method = { union: "unite", subtract: "subtract", intersect: "intersect", exclude: "exclude" } as const;

export function booleanStep(below: Path, above: Path, operation: BooleanOperation): PathCommand[] {
  checkBooleanStep([below, above]);
  const a = operand([below], false), b = operand([above], false);
  return commands(a[method[operation]](b, { insert: false }));
}

type Contour = { path: PathCommand[]; bounds: Rectangle };

/** Independent islands can be normalised separately. Keep touching or nested bounds together. */
function bands(contours: Contour[], axis: "x" | "y"): Contour[][] {
  const extent = axis === "x" ? "width" : "height";
  contours.sort((a,b) => a.bounds[axis]-b.bounds[axis]);
  const groups: Contour[][] = [];
  let right = -Infinity;
  for (const contour of contours) {
    const start = contour.bounds[axis], end = start + contour.bounds[extent];
    if (start > right) { groups.push([]); right = end; }
    else right = Math.max(end,right);
    groups[groups.length-1].push(contour);
  }
  return groups;
}

export function normaliseBooleanPath(path: Path, evenOdd = false): PathCommand[] {
  checkBooleanStep([path]);
  const subpaths: PathCommand[][] = [];
  for (const cmd of path) {
    if (cmd[0] === "M") subpaths.push([]);
    subpaths.at(-1)?.push(cmd);
  }
  const contours: Contour[] = [];
  for (const subpath of subpaths) {
    const box = pathBounds(subpath);
    if (box) contours.push({ path: subpath, bounds: box });
  }
  const result: PathCommand[] = [], empty = emptyCompound();
  for (const xs of bands(contours,"x")) for (const group of bands(xs,"y")) {
    const combined = operand(group.map(c => c.path), evenOdd).unite(empty, { insert: false });
    for (const cmd of commands(combined)) result.push(cmd);
  }
  return result;
}

export function foldBooleanPaths(operands: readonly { path: Path; operation: BooleanOperation }[]): Path {
  if (!operands.length) return [];
  if (operands.length === 1) return normaliseBooleanPath(operands[0].path);
  const budget = new BooleanFoldBudget();
  let result = operands[0].path;
  for (const next of operands.slice(1)) {
    budget.spend(result, next.path);
    result = booleanStep(result, next.path, next.operation);
  }
  return result;
}

type Cap = "butt" | "square" | "round";

/** Convert one path run to fill geometry, including independently shaped ends on every dash. */
export function outlineBand(path: Path, width: number, join: string, miterLimit: number, caps: readonly [Cap, Cap], dash: { pattern: number[]; offset: number } | null): PathCommand[] {
  checkBooleanStep([path]);
  const source = operand([path], false, false);
  const runs = dash ? source.dash({ dashArray: dash.pattern, dashOffset: dash.offset, insert: false }).children : source.children;
  const result: PathCommand[] = [];
  for (const run of runs) {
    if (!(run instanceof paper.Path) || run.length === 0) continue;
    const same = caps[0] === caps[1];
    let area = run.outline({ width, join, cap: same ? caps[0] : "butt", miterLimit, insert: false });
    if (!same && !run.closed) {
      for (const end of [0, 1] as const) {
        if (caps[end] === "butt") continue;
        const at = end ? run.length : 0, point = run.getPointAt(at), tangent = run.getTangentAt(at);
        if (!point || !tangent) continue;
        const radius = width / 2, normal = new paper.Point(-tangent.y * radius, tangent.x * radius), tip = point.add(tangent.multiply(end ? radius : -radius));
        const extra = caps[end] === "round" ? new paper.Path.Circle({ center: point, radius, insert: false })
          : new paper.Path({ segments: [point.add(normal), tip.add(normal), tip.subtract(normal), point.subtract(normal)], closed: true, insert: false });
        area = area.unite(extra, { insert: false });
      }
    }
    for (const cmd of commands(area)) result.push(cmd);
  }
  return result;
}
