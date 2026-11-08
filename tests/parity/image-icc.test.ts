import {readFileSync} from "node:fs";
import {deflateSync,crc32} from "node:zlib";
import {it,expect,describe,vi} from "vitest";
import {readImageResource} from "../../src/engine/image-resource";
import {embeddedIcc,MAX_ICC_BYTES} from "../../src/engine/icc-container";
import {iccDescription} from "../../src/engine/image-profile";

const bytes=(name:string)=>Uint8Array.from(readFileSync(new URL("../fixtures/images/"+name,import.meta.url)));
function taggedPng(profile:Uint8Array) {
  const base=bytes("six-pixels.png"), compressed=deflateSync(profile), body=Buffer.concat([Buffer.from("iCCPProfile\0\0"),compressed]);
  const size=Buffer.alloc(4), crc=Buffer.alloc(4);size.writeUInt32BE(body.length-4);crc.writeUInt32BE(crc32(body));
  return Uint8Array.from(Buffer.concat([base.subarray(0,33),size,body,crc,base.subarray(33)]));
}
describe("native embedded image profiles",()=>{
  it.each(["png","jpg","webp","tiff"])("reads and validates the same localised profile from %s",async ext=>{
    const source=bytes("icc-adobe."+ext), resource=await readImageResource(source);
    expect(resource.profileName).toBe("Adobe RGB (1998)");
    expect(resource.icc?.grey).toBe(false);
    const reference=await embeddedIcc(bytes("icc-adobe.png"),"image/png");
    expect(new Uint8Array(await resource.icc!.bytes.arrayBuffer())).toEqual(reference!.profile);
    expect(new Uint8Array(await resource.bytes.arrayBuffer())).toEqual(source);
  });
  it("accepts linear grey only for grey input and retains the profile name on RGB",async()=>{
    const src=bytes("icc-grey.png"), grey=await readImageResource(src);
    expect(grey).toMatchObject({profileName:"Linear grey",icc:{grey:true}});
    const same=await readImageResource(taggedPng(new Uint8Array(await grey.icc!.bytes.arrayBuffer())));
    expect(same.profileName).toBe("Linear grey");expect(same.icc).toBeUndefined();
  });
  it("keeps invalid, unsupported, oversized and missing JPEG segments out of colour conversion",async()=>{
    const jpeg=bytes("icc-adobe.jpg");jpeg[17]=1;
    expect((await readImageResource(jpeg)).profileName).toBeUndefined();
    const reference=(await embeddedIcc(bytes("icc-adobe.png"),"image/png"))!.profile;
    const cmyk=reference.slice();cmyk.set(Buffer.from("CMYK"),16);
    const invalid=reference.slice(); new DataView(invalid.buffer).setUint32(128,0xffffffff);
    const tooLarge=new Uint8Array(MAX_ICC_BYTES+1);tooLarge.set(reference);
    for(const data of [invalid,cmyk,tooLarge]) {
      const image=await readImageResource(taggedPng(data));
      expect(image.profileName).toBeUndefined();expect(image.width).toBe(3);
    }
  });
  it("chooses the first available translation and strips control characters",async()=>{
    const profile=(await embeddedIcc(bytes("icc-adobe.png"),"image/png"))!.profile;
    const view=new DataView(profile.buffer), tag=view.getUint32(136);
    view.setUint16(tag+28,0x6672);
    expect(iccDescription(profile)?.name).toBe("Testprofil");
    const offset=view.getUint32(tag+24); view.setUint16(tag+offset,7);
    expect(iccDescription(profile)?.name).toBe("estprofil");
  });
});

it("converts a native Lab lookup-table profile and a linear grey profile with alpha",async()=>{
  const {openIccTransform}=await import("../../src/engine/icc-transform");
  for(const [name,grey,input,reference] of [
    ["icc-lut",false,[128,64,16,255,200,80,60,128],[119,119,119,255,194,194,194,128]],
    ["icc-grey",true,[128,128,128,255,128,128,128,128],[188,188,188,255,188,188,188,128]]
  ] as const) {
    const src=bytes(name+".png"), image=await readImageResource(src);
    expect(image.profileName).toBe(grey?"Linear grey":"Grey LUT");
    const icc=await embeddedIcc(src,"image/png"), transform=await openIccTransform(icc!.profile,grey);
    expect(transform).toBeDefined();
    try {
      const pixels=Uint8ClampedArray.from(input);transform!.convert(pixels);
      for(const [i,x] of pixels.entries()) expect(Math.abs(x-reference[i])).toBeLessThanOrEqual(i%4===3?0:2);
    } finally {transform?.close();}
  }
});


it("retains the encoded member on save if the colour runtime cannot start", async () => {
  const { decodeFigcraft, encodeFigcraft } = await import("../../src/engine/file-format");
  const { unzipSync, zipSync } = await import("fflate");
  const cms = await import("../../src/engine/icc-transform");
  const unavailable = vi.spyOn(cms, "openIccTransform").mockRejectedValueOnce(Error("runtime unavailable"));
  try {
    const source = bytes("icc-adobe.png");
    const document = readFileSync(new URL("../fixtures/native-rectangle.json", import.meta.url));
    const opened = await decodeFigcraft(zipSync({ "document.json": document, "images/tagged": source }));
    expect(opened.issues).toEqual(["image tagged opened without colour conversion. Its original bytes are preserved."]);
    const saved = unzipSync(await encodeFigcraft(opened.document));
    expect(saved["images/tagged"]).toEqual(source);
  } finally {
    unavailable.mockRestore();
  }
});
