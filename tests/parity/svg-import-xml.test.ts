import { expect,it } from "vitest";
import { gzipSync } from "node:zlib";
import { checkSvgNesting, looksLikeSvg, svgBytes } from "../../src/engine/svg-import/xml";

it("recognises clipboard SVG after BOM, declarations, DTD subsets and comments",()=>{
  expect(looksLikeSvg('\uFEFF <?xml version="1.0"?><!DOCTYPE svg [<!-- ] --><?x [?><!ENTITY a "a>b">]><svg/>')).toBe(true);
  expect(looksLikeSvg("<!-- missing end <svg/>")).toBe(false);
  expect(looksLikeSvg("hello <svg/>")).toBe(false);
  expect(looksLikeSvg("<!-- -->".repeat(64)+"<svg/>")).toBe(false);
});

it("counts actual SVG elements without counting tags inside attributes, CDATA or comments",()=>{
  const misleading='<g a=">"><![CDATA[<g>]]><!--<g>--><path/></g>';
  expect(()=>checkSvgNesting("<g>".repeat(511)+misleading+"</g>".repeat(511))).not.toThrow();
  expect(()=>checkSvgNesting("<g>".repeat(513))).toThrow("512 deep");
});

it("bounds decompressed SVGZ output and refuses nested compression",async()=>{
  const data=new TextEncoder().encode("<svg/>");
  expect(await svgBytes(gzipSync(data))).toEqual(data);
  await expect(svgBytes(gzipSync(new Uint8Array(65537)),65536)).rejects.toThrow("expands past");
  await expect(svgBytes(gzipSync(gzipSync(data)))).rejects.toThrow("another compressed file");
  await expect(svgBytes(Uint8Array.of(31,139,128))).rejects.toThrow("malformed compressed SVG");
});

it("rejects external entity declarations while retaining matching words in ordinary SVG text",()=>{
  expect(()=>checkSvgNesting('<!DOCTYPE svg [<!ENTITY e SYSTEM "https://invalid.test/">]><svg/>')).toThrow("external entities");
  expect(()=>checkSvgNesting('<!DOCTYPE svg [<!-- <!ENTITY e SYSTEM "example"> --><!ENTITY text "SYSTEM">]><svg><![CDATA[<!ENTITY e SYSTEM "example">]]></svg>')).not.toThrow();
});
