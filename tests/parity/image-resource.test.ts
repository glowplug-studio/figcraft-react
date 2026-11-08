import {readFileSync} from "node:fs";
import {crc32} from "node:zlib";
import {createHash} from "node:crypto";
import {describe,expect,it} from "vitest";
import {jpegHeader} from "../../src/engine/jpeg-header";
import {decodeImageBitmap} from "../../src/engine/image-decode";
import {imageHash,imageResource,validImageKey} from "../../src/engine/image-resource";

describe("native encoded image resources",()=>{
  it.each([["png","png"],["jpg","jpeg"],["gif","gif"],["webp","webp"],["bmp","bmp"],["tiff","tiff"]])("preserves the original %s member and its content identity",async(ext,mime)=>{
    const original=readFileSync(new URL("../fixtures/images/six-pixels."+ext,import.meta.url));
    const data=Uint8Array.from(original), resource=imageResource(data);
    expect([resource.width,resource.height,resource.bytes.type]).toEqual([3,2,"image/"+mime]);
    data.fill(0);
    expect(Buffer.from(await resource.bytes.arrayBuffer())).toEqual(original);
    expect(await imageHash(resource.bytes)).toBe(createHash("sha256").update(original).digest("hex"));
  });
  it("gives an explicit sRGB tag priority and ignores out-of-range gamma and invalid primaries",()=>{
    const base=readFileSync(new URL("../fixtures/images/six-pixels.png",import.meta.url));
    const chunk=(name:string,data:Buffer)=>{
      const size=Buffer.alloc(4), sum=Buffer.alloc(4), payload=Buffer.concat([Buffer.from(name),data]);
      size.writeUInt32BE(data.length); sum.writeUInt32BE(crc32(payload));
      return Buffer.concat([size,payload,sum]);
    };
    const gamma=(value:number)=>{const buffer=Buffer.alloc(4);buffer.writeUInt32BE(value);return chunk("gAMA",buffer);};
    const profile=(...chunks:Buffer[])=>imageResource(Uint8Array.from(Buffer.concat([base.subarray(0,33),...chunks,base.subarray(33)]))).profileName;
    expect(profile(gamma(100000),chunk("sRGB",Buffer.of(0)))).toBe("sRGB");
    expect(profile(gamma(45455),chunk("cHRM",Buffer.alloc(32)))).toBe("sRGB");
    for(const value of [0,9999,1000001]) expect(profile(gamma(value))).toBeUndefined();
  });

  it("ignores a PNG gamma chunk with a damaged checksum",()=>{
    const data=Uint8Array.from(readFileSync(new URL("../fixtures/images/gamma-linear.png",import.meta.url)));
    const marker=Buffer.from(data).indexOf("gAMA");
    expect(marker).toBeGreaterThan(0); data[marker+8]^=255;
    expect(imageResource(data).profileName).toBeUndefined();
  });

  it("preserves a refused progressive JPEG member and its dimensions without decoding its pixels",async()=>{
    const source=readFileSync(new URL("../fixtures/images/progressive.jpg",import.meta.url));
    const frame=source.indexOf(Buffer.from([0xff,0xc2]));
    expect(frame).toBeGreaterThan(0);
    expect(jpegHeader(source)).toEqual({width:8,height:8,unsupportedSampling:false});
    for(const [marker,component,sampling] of [[0xc2,1,0x21],[0xc6,1,0x12],[0xca,2,0x22],[0xce,2,0x21]]) {
      const bytes=Uint8Array.from(source);
      bytes[frame+1]=marker; bytes[frame+11+component*3]=sampling;
      const resource=imageResource(bytes);
      expect(resource).toMatchObject({width:8,height:8,unsupportedJpegSampling:true});
      await expect(decodeImageBitmap(resource)).rejects.toThrow(/component sampling/);
      expect(new Uint8Array(await resource.bytes.arrayBuffer())).toEqual(bytes);
      bytes[frame+1]=0xc0;
      expect(jpegHeader(bytes)?.unsupportedSampling).toBe(false);
    }
    const padded=Uint8Array.from([0xff,0xd8,0xff,0x01,0xff,0xd0,0xff,...source.subarray(2)]);
    expect(jpegHeader(padded)).toEqual(jpegHeader(source));
    expect(jpegHeader(source.subarray(0,frame+6))).toBeUndefined();
    expect(jpegHeader(Uint8Array.of(255,216,255,218))).toBeUndefined();
  });

  it("retains opaque archive bytes and handles legacy BMP core dimensions",async()=>{
    const unknown=Uint8Array.of(3,7,9), damaged=imageResource(unknown);
    expect(damaged).toMatchObject({width:0,height:0});
    expect(new Uint8Array(await damaged.bytes.arrayBuffer())).toEqual(unknown);
    const core=new Uint8Array(26);core.set([66,77]);core[14]=12;core[18]=5;core[20]=9;
    expect(imageResource(core)).toMatchObject({width:5,height:9});
  });
  it("accepts exactly the native archive key alphabet and length",()=>{
    for (const key of ["a","ABC-018_test","rest-image-missing","0".repeat(128),"__proto__"]) expect(validImageKey(key)).toBe(true);
    for (const key of ["","a".repeat(129),"a/b","../x","a.b","a\\b","x\n","猫","a\u0000"]) expect(validImageKey(key)).toBe(false);
  });
});
