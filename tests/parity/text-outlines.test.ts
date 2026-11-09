import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";
import { ShapingFace } from "../../src/engine/shaping-face";
import { glyphPath } from "../../src/engine/text-glyph-path";
import reference from "../fixtures/text-outlines.json" with {type:"json"};

const fonts = new Map<string,readonly ShapingFace[]>();
for (const {file} of reference) {
  if (fonts.has(file)) continue;
  const root = file.endsWith(".ttc") ? "../fixtures/" : "../../fonts/";
  fonts.set(file,ShapingFace.read(await readFile(new URL(root+file,import.meta.url))));
}

// A degree-elevated quadratic has controls (P+2Q)/3 and (R+2Q)/3.
function cubicPath(native: readonly (readonly (string | number)[])[]) {
  const path: (readonly (string | number)[])[] = [];
  let x = 0, y = 0, startX = 0, startY = 0;
  for (const [kind,...coords] of native) {
    const [a,b,c,d] = coords as number[];
    if (kind === "M") { startX=a; startY=b; }
    if (kind === "L" && a===x && b===y) continue;
    if (kind === "Z" && path.at(-1)?.[0]==="L" && x===startX && y===startY) path.pop();
    path.push(kind==="Q" ? ["C",(x+2*a)/3,(y+2*b)/3,(c+2*a)/3,(d+2*b)/3,c,d] : [kind,...coords]);
    x = kind==="Z" ? startX : Number(coords.at(-2));
    y = kind==="Z" ? startY : Number(coords.at(-1));
  }
  return path;
}

it.each(reference)("places native $file face $index glyph $id under a shear", ({file,index,id,path,axes}) => {
  const face = fonts.get(file)![index];
  const coordinates = axes as Record<string,number>;
  const glyph = {face,id,x:10,y:92,size:53,coordinates,warp:[1,-0.2,0.4,1,6,12] as const};
  const actual = glyphPath(glyph);
  const expected = cubicPath(path);
  expect(actual.map(row=>row[0])).toEqual(expected.map(row=>row[0]));
  for (const [i,row] of expected.entries()) {
    for (let j=1;j<row.length;j+=2) {
      const x = 10+Number(row[j])*53/face.upem, y = 92+Number(row[j+1])*53/face.upem;
      expect(actual[i][j]).toBeCloseTo(x+0.4*y+6,7);
      expect(actual[i][j+1]).toBeCloseTo(y-0.2*x+12,7);
    }
  }
  expect(face.outline(id,coordinates)).toBe(face.outline(id,{...coordinates}));
  expect(glyphPath(glyph,0xffffffff)).toEqual([]);
});

it("keeps cached outlines immutable and independent of a later font-axis change", () => {
  const face = fonts.get("outline-cff.ttc")![1];
  const regular = face.outline(2,{wght:400});
  expect(Object.isFrozen(regular) && regular.every(Object.isFrozen)).toBe(true);
  expect(face.outline(2,{wght:900})).not.toEqual(regular);
  expect(face.outline(2)).toBe(regular);
});
