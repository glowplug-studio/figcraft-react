import { describe, expect, it } from "vitest";
import { applyTextCase, validOpenTypeTag } from "../../src/engine/text-case";
import { defaultTextStyle, letterSpacingPx, lineHeightPx, readTextStyle, setFontStyle, textItalic, textWeight, wireTextStyle } from "../../src/engine/text-style";

describe("native character styles",()=>{
  it("round-trips old and decorated styles, including inherited fills and empty overrides",()=>{
    const defaults = readTextStyle({});
    expect(defaults).toEqual(defaultTextStyle);
    expect(wireTextStyle(defaults)).toEqual({font_family:"Inter",font_style:"Regular",font_size:12,line_height:{unit:"auto"},
      letter_spacing:{unit:"percent",value:0},decoration:"none",case:"original",fills:null,link:null});
    const native = {...wireTextStyle(defaults),font_family:"Noto Sans Georgian",font_size:18,decoration:"underline",
      decoration_look:{style:"wavy",offset:{unit:"pixels",value:-2},thickness:{unit:"percent",value:12},color:null,skip_ink:true},
      fills:[],link:"https://example.test/",variations:{wdth:95,wght:620},style_id:"styleA"};
    expect(wireTextStyle(readTextStyle(native))).toEqual(native);
    expect(Object.isFrozen(readTextStyle(native).variations)).toBe(true);
    for (const v of [{font_size:"18"}, {line_height:{unit:"em",value:2}},{case:"UPPER"}, {font_family:"\ud800"}])
      expect(()=>readTextStyle(v)).toThrow();
  });
  it("resolves native face weights, axes, line height and negative tracking",()=>{
    expect(textWeight(readTextStyle({font_style:"Semi Bold Italic"}))).toBe(600);
    expect(textWeight(readTextStyle({font_style:"872 Italic"}))).toBe(872);
    const style=readTextStyle({font_size:20,font_style:"Light",variations:{wght:560.7,slnt:-7,wdth:83},
      line_height:{unit:"percent",value:125},letter_spacing:{unit:"percent",value:-5}});
    expect(textWeight(style)).toBe(561); expect(textItalic(style)).toBe(true);
    expect(lineHeightPx(style,1.1)).toBe(25); expect(letterSpacingPx(style)).toBe(-1);
    expect(lineHeightPx(defaultTextStyle,1.25)).toBe(15);
    const switched=setFontStyle(style,"Extra Bold"); expect(switched.variations).toEqual({wdth:83});
    expect(textWeight(switched)).toBe(800); expect(textItalic(switched)).toBe(false);
    expect(textItalic(readTextStyle({variations:{ital:.5}}))).toBe(true);
  });
  it("uses native title-case scalar context across apostrophes, combining marks and styled runs",()=>{
    expect(applyTextCase("title","hello wORLD don't 3d x-ray")).toBe("Hello WORLD Don't 3d X-Ray");
    expect(applyTextCase("title","say ’hello’ cafe\u0301's")).toBe("Say ’Hello’ Cafe\u0301's");
    expect(applyTextCase("title","a \u0301b")).toBe("A \u0301B");
    expect(applyTextCase("title","t","n","’")).toBe("t");
    expect(applyTextCase("title","t"," ","’")).toBe("T");
    expect(applyTextCase("upper","ß")).toBe("SS"); expect(applyTextCase("smallCaps","ß")).toBe("ß");
    expect(validOpenTypeTag("ss01")).toBe(true); expect(validOpenTypeTag("a b ")).toBe(true);
    for (const s of ["lig","ligatures","lié ","liga\n"]) expect(validOpenTypeTag(s)).toBe(false);
  });
});
