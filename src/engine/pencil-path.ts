import { inverse, transformPoint, type Affine } from "./affine";
import type { Point } from "./geometry";
import { simplifyPencil } from "./pencil-fit";

/** Fit in page coordinates, then transform into the first point's parent space, as pencil_finish. */
export function pencilPath(points: readonly Point[], parentWorld: Affine): string {
  const path = simplifyPencil(points), inv = inverse(parentWorld);
  return path.map(command => {
    const values: (string | number)[] = [command[0]];
    for (let i = 1; i + 1 < command.length; i += 2) {
      const p = transformPoint(inv, { x: command[i] as number, y: command[i + 1] as number });
      if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) throw new Error("Pencil parent geometry overflowed");
      values.push(p.x, p.y);
    }
    return values.join(" ");
  }).join(" ");
}
