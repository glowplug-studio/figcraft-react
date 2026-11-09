import { identity, multiply, type Affine } from "./affine";
import { mapVectorPath, type PathCommand } from "./corners";
import type { FlowGlyph } from "./text-flow";

/** Convert native font curves to the editor's cubic paths and remove redundant closing lines. */
export function fontOutlinePath(commands: readonly {type:string; values:readonly number[]}[]): readonly PathCommand[] {
  const result: PathCommand[] = [];
  let x = 0, y = 0, startX = 0, startY = 0;
  for (const {type,values} of commands) {
    if (type === "Z") {
      if (result.at(-1)?.[0] === "L" && x === startX && y === startY) result.pop();
      result.push(["Z"]);
      x = startX;
      y = startY;
      continue;
    }
    const endX = values[values.length-2], endY = -values[values.length-1];
    if (type === "M") {
      startX = endX;
      startY = endY;
      result.push(["M",endX,endY]);
    } else if (type === "L") {
      if (x !== endX || y !== endY) result.push(["L",endX,endY]);
    } else if (type === "Q") {
      const cx = values[0], cy = -values[1];
      result.push(["C",x + (cx-x)*2/3,y + (cy-y)*2/3,
        endX + (cx-endX)*2/3,endY + (cy-endY)*2/3,endX,endY]);
    } else if (type === "C") {
      result.push(["C",values[0],-values[1],values[2],-values[3],endX,endY]);
    }
    x = endX;
    y = endY;
  }
  for (const command of result) Object.freeze(command);
  return Object.freeze(result);
}

/** Place the glyph or one of its colour layers in text-layout coordinates. */
export function glyphPath(glyph: Pick<FlowGlyph,"face" | "id" | "coordinates" | "x" | "y" | "size" | "warp">, layerId = glyph.id): readonly PathCommand[] {
  const scale = glyph.size / glyph.face.upem;
  const position: Affine = [scale,0,0,scale,glyph.x,glyph.y];
  const [a,b,c,d,e,f] = multiply(glyph.warp ?? identity,position);
  return mapVectorPath(glyph.face.outline(layerId,glyph.coordinates),
    ({x,y}) => ({x:a*x+c*y+e,y:b*x+d*y+f}));
}
