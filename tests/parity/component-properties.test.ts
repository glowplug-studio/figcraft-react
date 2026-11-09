import { parse, stringify } from "lossless-json";
import { describe, expect, it } from "vitest";
import { orderedComponentPropertyNames, readComponentProperties, wireComponentProperties } from "../../src/engine/component-properties";

describe("native component property definitions", () => {
  it("round-trips lossless IDs, defaults, reserved names and variant options", () => {
    const input = '{"__proto__":{"type":"instanceSwap","default":18446744073709551615},"constructor":{"type":"slot"},"Label":{"type":"text","default":""},"Hidden":{"type":"boolean","default":false},"Choice":{"type":"variant","default":"Missing","options":["A","A"]}}';
    const props = readComponentProperties(parse(input));
    expect(Object.hasOwn(props, "__proto__")).toBe(true);
    expect(props["__proto__"]).toEqual({type:"instanceSwap", default:"18446744073709551615", preferred:[]});
    expect(Object.keys(props)).toHaveLength(5);
    expect(parse(stringify(wireComponentProperties(props))!)).toEqual(parse(input.replace('"type":"slot"', '"type":"slot","preferred":[]')));
  });

  it("keeps the first listed name and sorts unlisted names by Rust scalar order", () => {
    const names = ["10", "2", "constructor", "__proto__", "", "𐀀", "\ue000"];
    const props = readComponentProperties(Object.fromEntries(names.map(key => [key, {type:"boolean",default:false}])));
    expect(orderedComponentPropertyNames(props, ["2","missing","2","__proto__","toString"]))
      .toEqual(["2","__proto__","","10","constructor","\ue000","𐀀"]);
  });

  it("retains the order of preferred IDs and ignores unknown declaration fields as serde does", () => {
    const props = readComponentProperties(parse('{"Example":{"type":"instanceSwap","default":0,"preferred":[12,9,12],"unknown":true}}'));
    expect(stringify(wireComponentProperties(props))).toBe('{"Example":{"type":"instanceSwap","default":0,"preferred":[12,9,12]}}');
  });

  it.each(['null', '[]', '{"p":null}', '{"p":{"type":"slot","preferred":null}}',
    '{"p":{"type":"instanceSwap","default":18446744073709551616}}', '{"p":{"type":"instanceSwap","default":"1"}}',
    '{"p":{"type":"variant","options":[1],"default":"A"}}','{"p":{"type":"text"}}',
    '{"p":{"type":"boolean","default":1}}', '{"p":{"type":"unknown"}}'])("rejects malformed declarations %s", raw => {
    expect(() => readComponentProperties(parse(raw))).toThrow("Cannot open Figcraft file");
  });
});

describe("native descendant component links", () => {
  it("retains exact source IDs, exposure, property references and Rust set order through a saved drawing", async () => {
    const { decodeFigcraft, encodeFigcraft } = await import("../../src/engine/file-format");
    const { readFileSync } = await import("node:fs");
    const { strFromU8, unzipSync } = await import("fflate");
    const fixture = readFileSync(new URL("../fixtures/native-rectangle.json", import.meta.url), "utf8");
    const raw = fixture.replace('"type": "rectangle"', '"type":"rectangle","source":18446744073709551615,"exposed":true,"prop_refs":{"__proto__":"Visible"},"overrides":["width","fills","width"]');
    const decoded = await decodeFigcraft(new Blob([raw]));
    expect(decoded.document.nodes["2"]).toMatchObject({source:"18446744073709551615", exposed:true, overrides:["fills","width"]});
    expect(decoded.document.nodes["2"].propRefs?.["__proto__"]).toBe("Visible");
    const archive = await encodeFigcraft(decoded.document);
    expect(strFromU8(unzipSync(archive)["document.json"])).toContain('"source":18446744073709551615');
    expect(await decodeFigcraft(archive)).toEqual(decoded);
  });
});
