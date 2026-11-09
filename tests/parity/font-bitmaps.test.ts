import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { expect,it } from "vitest";
import { ShapingFace } from "../../src/engine/shaping-face";
import { glyphColour } from "../../src/engine/text-glyph-colour";
import records from "../fixtures/text-bitmaps.json" with {type:"json"};

const load=async(file:string)=>ShapingFace.read(await readFile(new URL("../fixtures/"+file,import.meta.url)));
const [sbix]=await load("colour-reference.ttf"),[cbdt,ebdt,png]=await load("bitmap-reference.ttc");
it.each(records)("matches $face glyph $id at $size pixels per em",({face,id,size,bitmap})=>{
  const value=(face==="sbix" ? sbix : face==="cbdt" ? cbdt : face==="ebdt" ? ebdt : png).colourBitmap(id,size);
  if (!bitmap) { expect(value).toBeUndefined(); return; }
  expect(value).toBeDefined();
  const {rgba,...dimensions}=value!;
  expect({...dimensions,hash:createHash("sha256").update(rgba).digest("hex")}).toEqual(bitmap);
});
it("prioritises layers and places a bitmap in the warped glyph frame",()=>{
  const glyph={id:2,face:sbix,x:10,y:30,size:8,warp:[0,1,-1,0,70,-5] as const};
  expect(glyphColour(glyph,2)?.kind).toBe("layers");
  expect(glyphColour(glyph,NaN)).toBeUndefined();
  const ink=glyphColour({...glyph,id:5},1.5);
  expect(ink?.kind).toBe("bitmap");
  if (ink?.kind!=="bitmap") throw Error("Bitmap missing");
  const b=sbix.colourBitmap(5,12)!;
  expect(ink.bitmap).toBe(b);
  expect(ink.place).toEqual([0,2/3,-2/3,0,70-30-b.top*2/3,-5+10+b.left*2/3]);
  expect(sbix.colourBitmap(5,2048)).toBe(sbix.colourBitmap(5,512));
});
it("refuses corrupt and oversized PNG strikes without poisoning other glyphs",async ()=>{
  const original=await readFile(new URL("../fixtures/colour-reference.ttf",import.meta.url));
  const signature=Buffer.from([137,80,78,71,13,10,26,10]);
  for (const corrupt of ["width","deflate"]) {
    const bytes=Buffer.from(original);
    for (let i=bytes.indexOf(signature);i>=0;i=bytes.indexOf(signature,i+8)) {
      if (corrupt==="width") bytes.writeUInt32BE(1025,i+16);
      else bytes[bytes.indexOf("IDAT",i)+4]=0;
    }
    const [face]=ShapingFace.read(bytes);
    expect(face.colourBitmap(5,8)).toBeUndefined();
    expect(face.colourBitmap(5,8)).toBeUndefined();
    expect(face.colourLayers(2)).toHaveLength(2);
  }
});
