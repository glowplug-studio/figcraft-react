import * as hb from "#figcraft-harfbuzz";
import { FontColourTables } from "./font-colour";
import { fontTables, fontVariations, normaliseFontStyle, type FontAxis, type FontInstance } from "./font-tables";
import { styleWeight, type TextStyle } from "./text-style";
import { fontOutlinePath } from "./text-glyph-path";
import type { CurveElement } from "./curve-flatten";
import type { PathCommand } from "./corners";
import { validOpenTypeTag } from "./text-case";

export interface ShapingScalar { readonly codePoint: number; readonly source: number }
export interface ShapedGlyph {
  readonly id: number;
  readonly cluster: number;
  readonly advance: number;
  readonly nominalAdvance: number;
  readonly offsetX: number;
  readonly offsetY: number;
}
const MAX_FONT_BYTES = 256 * 1024 * 1024;
const MAX_COLLECTION_FACES = 64;

function faceCount(bytes: Uint8Array) {
  if (bytes.length < 12 || bytes.length > MAX_FONT_BYTES) return 0;
  const view = new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  const version = view.getUint32(0);
  if (version === 0x74746366) { // ttcf
    const count = view.getUint32(8);
    return count <= (bytes.length-12)/4 ? Math.min(count,MAX_COLLECTION_FACES) : 0;
  }
  // TrueType, OpenType CFF, and older Mac sfnt signatures.
  return [0x00010000,0x4f54544f,0x74727565,0x74797031].includes(version) ? 1 : 0;
}

function faceName(face: hb.Face, id: number): string {
  const english = face.getName(id,"en").trim();
  if (english) return english;
  const first = face.listNames().find(name => name.nameId === id);
  return first ? face.getName(id,first.language).trim() : "";
}

export class ShapingFace {
  readonly family: string;
  readonly style: string;
  readonly postscript: string;
  readonly upem: number;
  readonly ascent: number;
  readonly capHeight: number;
  readonly underlinePosition: number;
  readonly underlineThickness: number;
  readonly strikePosition: number;
  readonly descent: number;
  readonly lineGap: number;
  readonly axes: Readonly<Record<string,FontAxis>>;
  readonly superscript: readonly [number,number];
  readonly subscript: readonly [number,number];
  readonly instances: readonly FontInstance[];
  readonly italic: boolean;
  readonly hasColour: boolean;
  readonly hasBitmaps:boolean;
  readonly weight: number;
  readonly features: readonly string[];
  readonly #colour?:FontColourTables;
  readonly #glyphCount: number;
  readonly #outlines = new Map<string,readonly CurveElement[]>();
  #outlineCommands = 0;
  readonly #font: hb.Font;
  readonly #buffer = new hb.Buffer();

  private constructor(face: hb.Face, family: string, style: string, tables: ReadonlyMap<string,DataView>, blob:hb.Blob, byteOffset:number) {
    this.family = family;
    this.style = style;
    this.postscript = faceName(face,6);
    this.upem = face.upem;
    const maxp = tables.get("maxp")!;
    this.#glyphCount = maxp.byteLength >= 6 ? maxp.getUint16(4) : 0;
    const variation = fontVariations(tables.get("fvar"), id => faceName(face,id));
    this.axes = variation.axes;
    this.instances = variation.instances;
    const os2 = tables.get("OS/2"), head = tables.get("head");
    const scriptMetric = (offset: number) => os2 && os2.byteLength >= offset+2 ? os2.getInt16(offset) : 0;
    const scriptSize = (units: number) => units>0 ? units/this.upem : 0.65;
    this.superscript = [scriptSize(scriptMetric(20)),scriptMetric(24) || this.upem*0.35];
    this.subscript = [scriptSize(scriptMetric(12)),-(scriptMetric(16) || this.upem*0.14)];
    const selection = os2 && os2.byteLength >= 64 ? os2.getUint16(62) : 0;
    const italicFlag = os2 && os2.byteLength >= 64 ? (selection & 0x201) !== 0
      : !!head && head.byteLength >= 46 && (head.getUint16(44) & 2) !== 0;
    this.italic = italicFlag || style.toLowerCase().includes("italic");
    this.weight = (os2 && os2.byteLength >= 6 && os2.getUint16(4)) || styleWeight(style);
    this.hasBitmaps=["sbix","CBDT","EBDT"].some(tag=>tables.has(tag));
    this.hasColour=this.hasBitmaps || tables.has("COLR");
    if (this.hasColour) {
      const ranges=new Map(Array.from(tables,([tag,view])=>[tag,[view.byteOffset-byteOffset,view.byteLength] as const]));
      this.#colour=new FontColourTables(tag=>{
        const range=ranges.get(tag);
        return range && hb.fontTableView(blob,range[0],range[1]);
      });
    }
    this.features = Object.freeze([...new Set(face.getTableFeatureTags("GSUB"))].sort());
    this.#font = new hb.Font(face);
    const metrics = this.#font.hExtents();
    this.ascent = metrics.ascender;
    const post=tables.get("post");
    this.underlinePosition=post && post.byteLength>=12 ? post.getInt16(8) : -this.upem*0.1;
    this.underlineThickness=Math.max(this.upem*0.02,post && post.byteLength>=12 ? post.getInt16(10) : this.upem*0.06);
    this.strikePosition=os2 && os2.byteLength>=30 ? os2.getInt16(28) : this.ascent*0.3;
    const cap = os2 && os2.byteLength>=90 && os2.getUint16(0)>=2 ? os2.getInt16(88) : 0;
    this.capHeight = cap>0 ? cap : this.ascent*0.72;
    this.descent = -metrics.descender;
    this.lineGap = metrics.lineGap;
  }

  static read(bytes: Uint8Array): readonly ShapingFace[] {
    const count = faceCount(bytes);
    if (!count) return [];
    const blob = new hb.Blob(bytes);
    const faces: ShapingFace[] = [];
    for (let index = 0; index < count; index++) {
      const tables = fontTables(bytes,index);
      if (!tables.has("head") || !tables.has("maxp")) continue;
      const face = new hb.Face(blob,index);
      const family = faceName(face,16) || faceName(face,1);
      if (!family) continue;
      const style = faceName(face,17) || faceName(face,2) || "Regular";
      faces.push(new ShapingFace(face,family,style,tables,blob,bytes.byteOffset));
    }
    return Object.freeze(faces);
  }

  axisValues(style: Pick<TextStyle,"fontStyle" | "fontSize" | "variations">): Readonly<Record<string,number>> {
    const name = normaliseFontStyle(style.fontStyle);
    const instance = this.instances.find(i => normaliseFontStyle(i.name) === name);
    const ownStyle = normaliseFontStyle(this.style) === name;
    const italic = style.fontStyle.toLowerCase().includes("italic") && !this.italic;
    return Object.fromEntries(Object.values(this.axes).map(axis => {
      let value = axis.default;
      if (Object.hasOwn(style.variations,axis.tag)) value = style.variations[axis.tag];
      else if (instance) value = instance.coordinates[axis.tag];
      else if (axis.tag === "wght" && !ownStyle) value = styleWeight(style.fontStyle);
      else if (axis.tag === "ital" && italic) value = 1;
      else if (axis.tag === "slnt" && italic) value = axis.min;
      else if (axis.tag === "opsz") value = style.fontSize;
      return [axis.tag,Number.isFinite(value) ? Math.max(axis.min,Math.min(axis.max,value)) : axis.default];
    }));
  }

  colourLayers(id:number) { return this.#colour?.layers(id); }

  colourBitmap(id:number,size:number) {
    if (!this.hasBitmaps || !Number.isInteger(id) || id<0 || id>=this.#glyphCount) return undefined;
    return this.#colour?.bitmap(id,this.upem,size,()=>this.outline(id,{},true),hb.decodeFontPng);
  }

  glyphFor(codePoint: number) { return this.#font.nominalGlyph(codePoint) ?? 0; }

  #applyAxes(axes: Readonly<Record<string,number>>) {
    const variations = Object.values(this.axes).map(axis => {
      const value = axes[axis.tag];
      return new hb.Variation(axis.tag,Number.isFinite(value)
        ? Math.min(axis.max,Math.max(axis.min,value)) : axis.default);
    });
    if (variations.length) this.#font.setVariations(variations);
  }

  /** Unhinted outlines in font units, with the same downward Y axis as the canvas. */
  outline(id:number, axes?:Readonly<Record<string,number>>):readonly PathCommand[];
  outline(id:number, axes:Readonly<Record<string,number>>, preserveQuadratics:true):readonly CurveElement[];
  outline(id:number, axes:Readonly<Record<string,number>>={}, preserveQuadratics=false):readonly CurveElement[] {
    if (!Number.isInteger(id) || id < 0 || id >= this.#glyphCount) return [];
    const values = Object.values(this.axes).map(axis => Number.isFinite(axes[axis.tag])
      ? Math.max(axis.min, Math.min(axis.max, axes[axis.tag])) : axis.default);
    const key = (preserveQuadratics ? "Q" : "C") + id + ":" + values.join(",");
    const cached = this.#outlines.get(key);
    if (cached) return cached;
    this.#applyAxes(axes);
    const raw = hb.unhintedOutline(this.#font, id);
    const path = preserveQuadratics ? fontOutlinePath(raw,true) : fontOutlinePath(raw);
    // Axes can be continuously dragged. Bound both the map and retained path geometry.
    if (this.#outlines.size >= 20_000 || this.#outlineCommands + path.length > 128_000) {
      this.#outlines.clear();
      this.#outlineCommands = 0;
    }
    if (path.length <= 128_000) {
      this.#outlines.set(key, path);
      this.#outlineCommands += path.length;
    }
    return path;
  }

  nominalRun(text:string, axes:Readonly<Record<string,number>>, size:number) {
    this.#applyAxes(axes);
    const k=size/this.upem;
    return Array.from(text,c=>{
      const id=this.glyphFor(c.codePointAt(0)!);
      return {id,advance:this.#font.glyphHAdvance(id)*k};
    });
  }

  /** Raw HarfBuzz positions in font units, in logical order as in native shape_segment. */
  shape(scalars: readonly ShapingScalar[], rtl: boolean, features: Readonly<Record<string,boolean>>,
    axes: Readonly<Record<string,number>>): readonly ShapedGlyph[] {
    this.#applyAxes(axes);
    const buffer = this.#buffer;
    buffer.reset();
    for (const scalar of scalars) buffer.add(scalar.codePoint,scalar.source);
    buffer.setDirection(rtl ? hb.Direction.RTL : hb.Direction.LTR);
    buffer.guessSegmentProperties();
    const flags = Object.entries(features).filter(([tag]) => validOpenTypeTag(tag))
      .map(([tag,enabled]) => new hb.Feature(tag,enabled ? 1 : 0));
    hb.shape(this.#font,buffer,flags);
    const glyphs = buffer.getGlyphInfosAndPositions().map(glyph => ({
      id:glyph.codepoint, cluster:glyph.cluster, advance:glyph.xAdvance ?? 0,
      nominalAdvance:this.#font.glyphHAdvance(glyph.codepoint),
      offsetX:glyph.xOffset ?? 0, offsetY:glyph.yOffset ?? 0,
    }));
    return rtl ? glyphs.reverse() : glyphs;
  }
}
