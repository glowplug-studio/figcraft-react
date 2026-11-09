import * as hb from "#figcraft-harfbuzz";
import type { AxisInfo } from "harfbuzzjs";
import { validOpenTypeTag } from "./text-case";

export interface ShapingScalar { readonly codePoint: number; readonly source: number }
export interface ShapedGlyph {
  readonly id: number;
  readonly cluster: number;
  readonly advance: number;
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
  readonly descent: number;
  readonly lineGap: number;
  readonly axes: Readonly<Record<string,Readonly<AxisInfo>>>;
  readonly features: readonly string[];
  readonly #font: hb.Font;
  readonly #buffer = new hb.Buffer();

  private constructor(face: hb.Face, family: string, style: string) {
    this.family = family;
    this.style = style;
    this.postscript = faceName(face,6);
    this.upem = face.upem;
    this.axes = Object.freeze(Object.fromEntries(Object.entries(face.getAxisInfos())
      .map(([tag,axis]) => [tag,Object.freeze(axis)])));
    this.features = Object.freeze([...new Set(face.getTableFeatureTags("GSUB"))].sort());
    this.#font = new hb.Font(face);
    const metrics = this.#font.hExtents();
    this.ascent = metrics.ascender;
    this.descent = -metrics.descender;
    this.lineGap = metrics.lineGap;
  }

  static read(bytes: Uint8Array): readonly ShapingFace[] {
    const count = faceCount(bytes);
    if (!count) return [];
    const blob = new hb.Blob(bytes);
    const faces: ShapingFace[] = [];
    for (let index = 0; index < count; index++) {
      const face = new hb.Face(blob,index);
      const family = faceName(face,16) || faceName(face,1);
      if (!family || !face.referenceTable("head") || !face.referenceTable("maxp")) continue;
      const style = faceName(face,17) || faceName(face,2) || "Regular";
      faces.push(new ShapingFace(face,family,style));
    }
    return Object.freeze(faces);
  }

  glyphFor(codePoint: number) { return this.#font.nominalGlyph(codePoint) ?? 0; }

  /** Raw HarfBuzz positions in font units, in logical order as in native shape_segment. */
  shape(scalars: readonly ShapingScalar[], rtl: boolean, features: Readonly<Record<string,boolean>>,
    axes: Readonly<Record<string,number>>): readonly ShapedGlyph[] {
    const variations = Object.values(this.axes).map(axis => {
      const value = axes[axis.tag];
      return new hb.Variation(axis.tag,Number.isFinite(value)
        ? Math.min(axis.max,Math.max(axis.min,value)) : axis.default);
    });
    if (variations.length) this.#font.setVariations(variations);
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
      offsetX:glyph.xOffset ?? 0, offsetY:glyph.yOffset ?? 0,
    }));
    return rtl ? glyphs.reverse() : glyphs;
  }
}
