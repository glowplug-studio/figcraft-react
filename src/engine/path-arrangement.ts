import paper from "paper/dist/paper-core.js";
import type { PathCommand } from "./corners";
import { commands, operand } from "./paper-path";
import { normaliseBooleanPath } from "./path-boolean";
import { checkBooleanStep } from "./path-budget";

type Path = readonly PathCommand[];
type Item = InstanceType<typeof paper.PathItem>;
type Contour = InstanceType<typeof paper.Path>;

export interface ArrangementInput {
  readonly path: Path;
  readonly evenOdd: boolean;
}

export interface ArrangementFace {
  readonly path: Path;
  readonly cover: readonly number[];
  readonly area: number;
}

interface Cell {
  shape: Item;
  cover: readonly number[];
}

export const maxArrangementInputs = 256;
const maxFaces = 4096;
const detached = { insert: false };

function contours(shape: Item): Contour[] {
  if (shape instanceof paper.Path) return [shape];
  return shape.children.filter((child): child is Contour => child instanceof paper.Path);
}

function hasArea(shape: Item): boolean {
  return contours(shape).some(contour => contour.area !== 0);
}

/** A compound can contain islands within holes and disconnected areas of the same coverage. */
function* connectedFaces({ shape, cover }: Cell): Generator<ArrangementFace> {
  const rings = contours(shape.reorient(true, true)).filter(ring => ring.area !== 0);
  const exteriors = rings.filter(ring => ring.clockwise)
    .sort((a, b) => a.area - b.area)
    .map(ring => ({ ring, path: commands(ring), area: ring.area }));
  for (const hole of rings.filter(ring => !ring.clockwise)) {
    const parent = exteriors.find(({ ring }) =>
      ring.bounds.contains(hole.bounds) && ring.contains(hole.interiorPoint));
    if (!parent) throw new Error("Shape builder could not locate the exterior of a hole");
    for (const cmd of commands(hole)) parent.path.push(cmd);
    parent.area += hole.area;
  }
  for (const { path, area } of exteriors) yield { path, area, cover };
}

function compareCoverage(a: Cell, b: Cell) {
  const length = Math.min(a.cover.length, b.cover.length);
  for (let i = 0; i < length; i++) {
    if (a.cover[i] !== b.cover[i]) return a.cover[i] - b.cover[i];
  }
  return a.cover.length - b.cover.length;
}

/** Insert each input into the partition of earlier inputs. Existing cells are pairwise disjoint. */
export function arrangementFaces(inputs: readonly ArrangementInput[]): ArrangementFace[] {
  if (inputs.length > maxArrangementInputs) throw new Error("Shape builder accepts at most 256 inputs");
  checkBooleanStep(inputs.map(input => input.path));
  const paths = inputs.map(({ path, evenOdd }) => normaliseBooleanPath(path, evenOdd));
  checkBooleanStep(paths);
  let cells: Cell[] = [];
  for (const [index, path] of paths.entries()) {
    if (!path.length) continue;
    const input = operand([path], false);
    let remainder: Item = input;
    const next: Cell[] = [];
    for (const cell of cells) {
      if (!cell.shape.bounds.intersects(input.bounds)) {
        next.push(cell);
        continue;
      }
      const shared = cell.shape.intersect(input, detached);
      if (!hasArea(shared)) {
        next.push(cell);
        continue;
      }
      const outside = cell.shape.subtract(input, detached);
      if (hasArea(outside)) next.push({ shape: outside, cover: cell.cover });
      next.push({ shape: shared, cover: [...cell.cover, index] });
      if (hasArea(remainder)) remainder = remainder.subtract(cell.shape, detached);
    }
    if (hasArea(remainder)) next.push({ shape: remainder, cover: [index] });
    cells = next;
  }
  const result: ArrangementFace[] = [];
  for (const cell of cells.sort(compareCoverage)) {
    for (const face of connectedFaces(cell)) {
      result.push(face);
      if (result.length === maxFaces) return result;
    }
  }
  return result;
}

export function unionFaces(paths: readonly Path[]): PathCommand[] {
  return normaliseBooleanPath(paths.flatMap(path => path));
}
