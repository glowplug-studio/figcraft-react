import type { PathCommand } from "./corners";
import { cubicBounds } from "./cubic";
import type { Point, Rectangle } from "./geometry";

export const maxPathSegments = 250_000;
export const maxPossibleCrossings = 2_000_000;
export const maxFoldSegments = 4_000_000;
const maxCoordinate = 1.5e9;
export class BooleanComplexityError extends Error {}
const tooComplex = () => new BooleanComplexityError(`The shapes are too complex to combine (over ${maxPathSegments} segments or ${maxPossibleCrossings} possible crossings)`);

type Path = readonly PathCommand[];
type Segment = { from: Point; to: Point; command?: Extract<PathCommand, readonly ["C", ...number[]]> };

function* segments(path: Path, closeOpen: boolean): Generator<Segment> {
  let pen: Point | undefined, first: Point | undefined;
  for (const cmd of path) {
    for (let i = 1; i < cmd.length; i++) {
      const value = cmd[i] as number;
      if (!Number.isFinite(value) || Math.abs(value) > maxCoordinate) throw new Error("Path contains invalid coordinates");
    }
    if (cmd[0] === "M") {
      if (closeOpen && pen && first && (pen.x !== first.x || pen.y !== first.y)) yield { from: pen, to: first };
      pen = first = { x: cmd[1], y: cmd[2] };
    } else if (cmd[0] === "Z") {
      if (pen && first && (pen.x !== first.x || pen.y !== first.y)) yield { from: pen, to: first };
      pen = first;
    } else {
      if (!pen) throw new Error("Path contains a segment without a starting point");
      const to = cmd[0] === "C" ? { x: cmd[5], y: cmd[6] } : { x: cmd[1], y: cmd[2] };
      yield { from: pen, to, command: cmd[0] === "C" ? cmd : undefined };
      pen = to;
    }
  }
  if (closeOpen && pen && first && (pen.x !== first.x || pen.y !== first.y)) yield { from: pen, to: first };
}

function bounds({ from, to, command }: Segment): Rectangle {
  if (command) return cubicBounds([from, { x: command[1], y: command[2] }, { x: command[3], y: command[4] }, to]);
  return { x: Math.min(from.x,to.x), y: Math.min(from.y,to.y), width: Math.abs(from.x-to.x), height: Math.abs(from.y-to.y) };
}

/** Prefix counts of active interval endpoints by coordinate rank. */
class RankCounts {
  readonly counts: Int32Array;
  constructor(ranks: number) { this.counts = new Int32Array(ranks + 1); }
  add(rank: number, delta: number) {
    for (let i = rank + 1; i < this.counts.length; i += i & -i) this.counts[i] += delta;
  }
  before(rank: number) {
    let count = 0;
    for (let i = rank; i; i -= i & -i) count += this.counts[i];
    return count;
  }
}

function overlappingPairs(boxes: readonly Rectangle[]) {
  const ys = new Set<number>();
  const events: { x: number; delta: number; box: Rectangle }[] = [];
  for (const box of boxes) {
    ys.add(box.y); ys.add(box.y + box.height);
    events.push({ x: box.x, delta: 1, box }, { x: box.x + box.width, delta: -1, box });
  }
  const ranks = new Map([...ys].sort((a,b) => a-b).map((y,i) => [y,i]));
  const tops = new RankCounts(ranks.size), bottoms = new RankCounts(ranks.size);
  // Starts precede ends at equal x, including vertical segments and touching boxes.
  events.sort((a,b) => a.x-b.x || b.delta-a.delta);
  let pairs = 0;
  for (const { box, delta } of events) {
    const top = ranks.get(box.y)!, bottom = ranks.get(box.y + box.height)!;
    if (delta === 1) {
      pairs += tops.before(bottom + 1) - bottoms.before(top);
      if (pairs > maxPossibleCrossings) return pairs;
    }
    tops.add(top, delta); bottoms.add(bottom, delta);
  }
  return pairs;
}

export function pathComplexity(paths: readonly Path[], closeOpen = false) {
  const boxes: Rectangle[] = [];
  for (const path of paths) for (const s of segments(path, closeOpen)) {
    if (boxes.length === maxPathSegments) return undefined;
    boxes.push(bounds(s));
  }
  return { segments: boxes.length, crossings: overlappingPairs(boxes) };
}

export function checkBooleanStep(paths: readonly Path[]) {
  const cost = pathComplexity(paths, true);
  if (!cost || cost.crossings > maxPossibleCrossings) throw tooComplex();
}

/** A long fold can exceed the total budget even when each individual step is cheap. */
export class BooleanFoldBudget {
  #spent = 0;
  spend(below: Path, operand: Path) {
    if (this.#spent > maxFoldSegments) throw tooComplex();
    for (const path of [below, operand]) {
      for (const _segment of segments(path, false)) if (++this.#spent > maxFoldSegments) throw tooComplex();
    }
  }
}
