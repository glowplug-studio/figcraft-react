import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { zlibSync } from "fflate";
import { decodeTiff } from "../../src/engine/tiff-image";
import { tiffJpegSource } from "../../src/engine/tiff-jpeg";
import { tiffDirectory, tiffDimensions } from "../../src/engine/tiff-directory";
import { decodeTiffSegment } from "../../src/engine/tiff-segment";
import { imageResource } from "../../src/engine/image-resource";

const read = (name: string) => Uint8Array.from(readFileSync(new URL("../fixtures/images/"+name+".tiff", import.meta.url)));
const red=[255,0,0,255], green=[0,255,0,255], blue=[0,0,255,255];

describe("bounded native TIFF pixel decoding", () => {
  // Independent LibTIFF tiffcp encodings of the same row-major raster.
  it.each(["six-pixels", "strips-deflate-be", "tile-packbits-big", "planes-lzw"])("decodes %s into the same six pixels", async name => {
    const bytes = read(name);
    expect(tiffDimensions(bytes)).toEqual({ width:3, height:2 });
    expect(imageResource(bytes)).toMatchObject({ width:3, height:2, bytes:{type:"image/tiff"} });
    const { width, height, rgba } = await decodeTiff(bytes);
    expect([width,height]).toEqual([3,2]);
    expect([...rgba]).toEqual([red,green,blue,blue,green,red].flat());
  });

  it("decodes Group 4 pass, vertical, horizontal and long make-up runs against the bilevel source", async () => {
    const {width,height,rgba} = await decodeTiff(read("fax4"));
    expect([width,height]).toEqual([2049,10]);
    const expected=new Uint8ClampedArray(width*height*4).fill(255);
    for(let y=1; y<height-1; y++) for(let x=0; x<width; x++) {
      if (y===1 || (x+3*y)%37<15 && (x<65 || x>1965)) expected.fill(0,(y*width+x)*4,(y*width+x)*4+3);
    }
    expect(Buffer.from(rgba).equals(Buffer.from(expected))).toBe(true);
  });

  it("crosses all LZW code widths and dictionary resets in one independently compressed strip", async () => {
    const { width, height, rgba } = await decodeTiff(read("noise-lzw"));
    const expected = new Uint8ClampedArray(96*64*4);
    let state=47;
    for (let i=0; i<expected.length; i+=4) {
      for (let c=0; c<3; c++) {
        state=(Math.imul(state,1664525)+1013904223)>>>0; expected[i+c]=state>>>24;
      }
      expected[i+3]=255;
    }
    expect([width,height]).toEqual([96,64]);
    expect(Buffer.from(rgba).equals(Buffer.from(expected))).toBe(true);
  });

  it("reassembles shared JPEG tables and checks geometry before invoking a browser decoder", async () => {
    const bytes = read("strips-jpeg");
    const { value, byteField } = tiffDirectory(bytes);
    const start = value(273), strip = bytes.subarray(start, start + value(279));
    const tables = byteField(347)!;
    const jpeg = tiffJpegSource(strip, tables, 3, 2, 3);
    const full = new Uint8Array(await jpeg.arrayBuffer());
    expect(imageResource(full)).toMatchObject({width:3, height:2, bytes:{type:"image/jpeg"}});
    expect(tiffJpegSource(full, undefined, 3, 2, 3).size).toBe(jpeg.size);
    expect(() => tiffJpegSource(strip, tables, 65535, 2, 3)).toThrow(/disagree/);
    expect(() => tiffJpegSource(strip, tables.subarray(0, 8), 3, 2, 3)).toThrow();
    expect(() => tiffJpegSource(strip.subarray(0, -2), tables, 3, 2, 3)).toThrow();
  });

  it("rejects oversized output, invalid strip references and truncated data before publishing pixels", async () => {
    const bytes = read("six-pixels"), data = new DataView(bytes.buffer);
    const first=data.getUint32(4,true), count=data.getUint16(first,true);
    const tagAt=(tag:number) => {
      for(let i=0;i<count;i++){const at=first+2+i*12; if(data.getUint16(at,true)===tag) return at;}
      throw new Error("Fixture tag missing");
    };
    const width=tagAt(256), height=tagAt(257), offset=tagAt(273);
    data.setUint16(width+8,65535,true); data.setUint16(height+8,65535,true); data.setUint32(tagAt(278)+8,65535,true);
    await expect(decodeTiff(bytes)).rejects.toThrow(/limit/);
    data.setUint16(width+8,3,true); data.setUint16(height+8,2,true); data.setUint32(offset+8,bytes.length-4,true);
    await expect(decodeTiff(bytes)).rejects.toThrow(/segment exceeds/);
    await expect(decodeTiff(read("six-pixels").subarray(0,37))).rejects.toThrow();
  });

  it("bounds actual decompression against the required strip extent", async () => {
    await expect(decodeTiffSegment(zlibSync(new Uint8Array(2**20)),8,10)).rejects.toThrow();
    await expect(decodeTiffSegment(Uint8Array.of(129,40),32773,2)).rejects.toThrow();
    await expect(decodeTiffSegment(Uint8Array.of(0,128),32773,2)).rejects.toThrow();
    await expect(decodeTiffSegment(Uint8Array.of(128,0),5,1)).rejects.toThrow();
    await expect(decodeTiffSegment(Uint8Array.of(9),1,2)).rejects.toThrow();
  });
});
