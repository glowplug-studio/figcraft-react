/// <reference path="./paper-core.d.ts" />
import paper from "paper/dist/paper-core.js";
import type { PathCommand } from "./corners";
type Path = readonly PathCommand[];
type PaperPath = InstanceType<typeof paper.Path>;
type PaperItem = InstanceType<typeof paper.PathItem>;

export function emptyCompound() {
  // Paper's geometry needs a project even in Node. Reuse an active host project when present.
  // Every constructed item and boolean result is detached, including in the browser.
  try { return new paper.CompoundPath({ insert: false }); }
  catch (error) {
    if (!(error instanceof Error) || !error.message.includes("without a project")) throw error;
    const scope = new paper.PaperScope();
    scope.setup(new scope.Size(1, 1));
    return new scope.CompoundPath({ insert: false });
  }
}

export function operand(contours: readonly Path[], evenOdd: boolean, closeOpen = true) {
  const shape = emptyCompound();
  shape.fillRule = evenOdd ? "evenodd" : "nonzero";
  for (const commands of contours) {
    let current: PaperPath | undefined;
    for (const cmd of commands) {
      if (cmd[0] === "M") {
        if (current && closeOpen) current.closePath();
        current = new paper.Path({ insert: false });
        shape.addChild(current);
        current.moveTo([cmd[1], cmd[2]]);
      } else if (current) {
        if (cmd[0] === "L") current.lineTo([cmd[1], cmd[2]]);
        else if (cmd[0] === "C") current.cubicCurveTo([cmd[1],cmd[2]], [cmd[3],cmd[4]], [cmd[5],cmd[6]]);
        else current.closePath();
      }
    }
    if (current && closeOpen && !current.closed) current.closePath();
  }
  return shape;
}

export function commands(item: PaperItem): PathCommand[] {
  const output: PathCommand[] = [];
  const children = item instanceof paper.CompoundPath ? item.children : [item];
  for (const path of children) {
    if (!(path instanceof paper.Path) || path.segments.length < 1) continue;
    const segments = path.segments;
    output.push(["M", segments[0].point.x, segments[0].point.y]);
    for (let i = 0; i < segments.length; i++) {
      const a = segments[i], b = segments[(i+1) % segments.length];
      if (!a.handleOut.isZero() || !b.handleIn.isZero()) {
        output.push(["C", a.point.x+a.handleOut.x, a.point.y+a.handleOut.y, b.point.x+b.handleIn.x, b.point.y+b.handleIn.y, b.point.x, b.point.y]);
      } else if (i + 1 < segments.length) output.push(["L", b.point.x, b.point.y]);
    }
    output.push(["Z"]);
  }
  return output;
}
