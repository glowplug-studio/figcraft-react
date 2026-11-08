import { describe, expect, it } from "vitest";
import { unzipSync, strFromU8 } from "fflate";
import { colour, fromRgba8, toRgba8 } from "../../src/engine/colour";
import { convertColour, convertColourPixels, outsideSrgb, parseColourProfile } from "../../src/engine/colour-spaces";
import { decodeFigcraft, encodeFigcraft } from "../../src/engine/file-format";
import { EditorEngine } from "../../src/engine/editor";
import { displayP3Icc } from "../../src/engine/working-icc";
import { iccDescription } from "../../src/engine/image-profile";
import { openIccTransform } from "../../src/engine/icc-transform";
import { base64Bytes } from "../../src/engine/recovery";
import { newDocument, rectanglePaints } from "../../src/engine/document";
import { setDocumentProfile } from "../../src/engine/document-profile";
import { solidPaint, readPaint } from "../../src/engine/solid-paint";
import { pathNetwork } from "../../src/engine/svg-path";

describe("document working space", () => {
  it("converts D65 primaries and preserves alpha and identity", () => {
    for (const name of ["P3", "display-p3", "Display P3", "display_P3"]) expect(parseColourProfile(name)).toBe("displayP3");
    expect(parseColourProfile("Adobe RGB")).toBeUndefined();
    const red = colour(1, 0, 0, .5), p3 = convertColour(red, "srgb", "displayP3");
    expect(p3.r).toBeCloseTo(.9175, 3); expect(p3.g).toBeCloseTo(.2003, 3); expect(p3.b).toBeCloseTo(.1386, 3);
    expect(p3.a).toBe(.5); expect(convertColour(red, "srgb", "srgb")).toBe(red);
    const samples = Uint8ClampedArray.of(234, 51, 35, 255, 0, 255, 0, 128, 12, 34, 56, 0);
    convertColourPixels(samples, "displayP3", "srgb");
    expect(Array.from(samples)).toEqual([255, 0, 0, 255, 0, 255, 0, 128, 12, 34, 56, 0]);
  });

  it("marks only out-of-gamut composite pixels beyond the native two-step tolerance", () => {
    expect(outsideSrgb(colour(0, 1, 0), "displayP3")).toBe(true);
    expect(outsideSrgb(convertColour(colour(1, 0, 0), "srgb", "displayP3"), "displayP3")).toBe(false);
    const samples = Uint8ClampedArray.of(0,255,0,128, 0,255,0,0, 128,128,128,255, 0,255,0,255);
    convertColourPixels(samples, "displayP3", "srgb", {width:4,y:1});
    expect([...samples]).toEqual([128,128,128,255, 0,255,0,0, 128,128,128,255, 0,255,0,255]);
    const engine = new EditorEngine(), before = engine.getSnapshot();
    expect(engine.execute("view.proofSrgb")).toEqual({on:true});
    expect(engine.execute("view.proofSrgb",{on:false})).toEqual({on:false});
    expect(engine.getSnapshot()).toBe(before);
  });

  it("targets Display P3 directly without clipping wide source channels through sRGB", async () => {
    const profile = displayP3Icc();
    expect(iccDescription(profile)).toEqual({name: "Display P3", grey: false});
    const p3 = await openIccTransform(profile, false, "displayP3");
    const srgb = await openIccTransform(profile, false);
    try {
      const original = Uint8ClampedArray.of(32, 240, 98, 128);
      const a = original.slice(), b = original.slice();
      p3!.convert(a); srgb!.convert(b);
      expect(a).toEqual(original);
      expect(b[0]).toBe(0); expect(b[1]).toBeGreaterThan(240); expect(b[3]).toBe(128);
    } finally { p3?.close(); srgb?.close(); }
  });

  it("converts palette, page, prototype, vector fill, stroke stops and face overrides; preserves native members", async () => {
    const base = newDocument(), red = fromRgba8(255, 0, 0), solid = solidPaint(red);
    const gradient = readPaint({type:"gradient", kind:"linear", stops:[{position:0,color:red},{position:1,color:red}]}, true);
    const network = pathNetwork("M0 0L30 0L30 20Z").network;
    const page = {...base.nodes["1"], kind:"page" as const, parent:null, background:"#ff0000", prototypeBackground:red, children:["2"]};
    const vector = {kind:"vector" as const, id:"2", name:"Face", parent:"1", x:0, y:0, width:30, height:20,
      network:{...network, regions:[{loops:[[0,1,2]], winding:"nonZero" as const, fills:[solid]}]}, fill:"#ff0000", strokes:[gradient]};
    const document = {...base, nodes:{"1":page,"2":vector}, documentColours:[red]};
    const converted = setDocumentProfile(document, "displayP3", true);
    const p3 = convertColour(red, "srgb", "displayP3"), v = converted.nodes["2"], pg = converted.nodes["1"];
    expect(converted.documentColours).toEqual([p3]);
    expect(pg).toMatchObject({backgroundColor:p3, prototypeBackground:p3});
    if (v.kind !== "vector") throw Error("Vector missing");
    expect(rectanglePaints(v)[0]).toMatchObject({color:p3});
    expect(v.strokes?.[0]).toMatchObject({stops:[{color:p3},{color:p3}]});
    expect(v.network.regions[0].fills?.[0]).toMatchObject({color:p3});
    const bytes = await encodeFigcraft(converted);
    const reopened = (await decodeFigcraft(bytes)).document;
    expect(reopened.colourProfile).toBe("displayP3");
    expect(reopened.documentColours).toEqual([p3]);
    expect(reopened.nodes["1"]).toMatchObject({prototypeBackground:p3});
    expect(converted.nodes["2"]).not.toBe(document.nodes["2"]);
    expect(setDocumentProfile(document, "displayP3", false).nodes).toBe(document.nodes);
  });

  it("opens the dialog, converts or assigns in one undo, records dirty state and reopens native files", async () => {
    const engine = new EditorEngine();
    engine.execute("shape.rectangle");
    const before = engine.getSnapshot().document;
    const archive = await engine.executeAsync("file.saveAs",{data:true});
    engine.execute("file.markSaved", {revision:archive.revision});
    const depth = engine.getUndoDepth();
    expect(engine.execute("file.colorProfile", {})).toEqual({profile:"srgb",changed:false});
    expect(engine.getSnapshot().profileDialog).toBe(true);
    expect(engine.getUndoDepth()).toBe(depth);
    expect(await engine.executeAsync("file.colorProfile",{profile:"Display_P3"})).toEqual({profile:"displayP3",changed:true});
    expect(engine.getSnapshot()).toMatchObject({dirty:true,profileDialog:false});
    expect(engine.execute("file.colorProfile",{profile:"p3"}).changed).toBe(false);
    expect(engine.getUndoDepth()).toBe(depth+1);
    engine.execute("edit.undo"); expect(engine.getSnapshot().document).toBe(before);
    expect(engine.getSnapshot().dirty).toBe(false);
    engine.execute("file.colorProfile",{profile:"p3",convert:false});
    expect(engine.getSnapshot().document.nodes).toBe(before.nodes);
    const native = await engine.nativeSnapshot();
    expect(JSON.parse(strFromU8(unzipSync(native)["document.json"])).color_profile).toBe("displayP3");
    await engine.executeAsync("file.open",{data:base64Bytes(native)});
    expect(engine.getSnapshot().document.colourProfile).toBe("displayP3");
    expect(() => engine.execute("file.colorProfile",{profile:"CMYK"})).toThrow(/profile/);
    engine.setEditable(false); expect(() => engine.execute("file.colorProfile")).toThrow(/Sign in/);
    expect(toRgba8(convertColour(colour(0,1,0),"displayP3","srgb"))).toEqual([0,255,0,255]);
  });
});
