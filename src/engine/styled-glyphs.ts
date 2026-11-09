import { textBidi } from "./text-bidi";
import type { TextData } from "./text-data";
import { letterSpacingPx, type TextStyle } from "./text-style";
import type { FontLibrary } from "./font-library";
import type { ShapingFace, ShapingScalar } from "./shaping-face";
import { TextGraphemes } from "./text-graphemes";
import { textSpans } from "./text-ranges";
import { applyTextCase } from "./text-case";

export interface StyledGlyph {
  readonly face: ShapingFace;
  readonly style: TextStyle;
  readonly coordinates: Readonly<Record<string,number>>;
  readonly id: number;
  readonly start: number;
  readonly end: number;
  readonly level: number;
  readonly size: number;
  readonly advance: number;
  readonly spacing: number;
  readonly offsetX: number;
  readonly offsetY: number;
}

function lowerSigma(chars: readonly string[], at: number) {
  const before = chars.slice(Math.max(0,at-32),at).join("");
  const after = chars.slice(at+1,at+33).join("");
  return (before+"Σ"+after).toLowerCase()[before.toLowerCase().length];
}

function onGrid(units: number,upem: number) {
  return Math.sign(units)*Math.round(Math.abs(units)*1024/upem)/1024;
}

interface FaceSegment {face:ShapingFace; start:number; end:number; level:number}

function* styledSegment(chars: readonly string[], seg: FaceSegment, style: TextStyle,
  features: Readonly<Record<string,boolean>>): Generator<StyledGlyph> {
  const {face,start,end,level} = seg;
  const size = Number.isFinite(style.fontSize) ? Math.max(0.5,Math.min(5000,style.fontSize)) : 12;
  if (chars[start] === "\n" || chars[start] === "\u2028") {
    yield {face,style,coordinates:{},id:0,start,end,level,size,advance:0,spacing:0,offsetX:0,offsetY:0};
    return;
  }
  const coordinates = face.axisValues(style);
  const smallCaps = style.case === "smallCaps", nativeCaps = smallCaps && face.features.includes("smcp");
  const mapped: ShapingScalar[] = [];
  const script = features.sups ? "sups" : features.subs ? "subs" : undefined;
  const plain = script ? new Map<number,number>() : undefined;
  const small = smallCaps && !nativeCaps ? new Set<number>() : undefined;
  for (let source=start; source<end; source++) {
    const c = chars[source];
    let form: string;
    if (small && /\p{Lowercase}/u.test(c)) {
      small.add(source);
      form = c.toUpperCase();
    } else if (style.case === "lower" && c === "Σ") form = lowerSigma(chars,source);
    else form = applyTextCase(style.case,c,chars[source-2],chars[source-1]);
    plain?.set(source,form.codePointAt(0)!);
    for (const scalar of form) mapped.push({codePoint:scalar.codePointAt(0)!,source});
  }
  const flags = nativeCaps ? {...features,smcp:true} : features;
  const shape = (flags: Readonly<Record<string,boolean>>) => face.shape(mapped,level%2 === 1,flags,coordinates);
  let raw = shape(flags), scriptScale = 1, scriptShift = 0;
  if (script) {
    const native = face.features.includes(script);
    if (!native || raw.some(g => /[\p{Alphabetic}\p{Number}]/u.test(chars[g.cluster]) && face.glyphFor(plain!.get(g.cluster)!) === g.id)) {
      if (native) {
        const { [script]:removed, ...normal } = flags;
        raw = shape(normal);
      }
      [scriptScale,scriptShift] = script === "sups" ? face.superscript : face.subscript;
    }
  }

  const k = size/face.upem;
  const letterSpacing = letterSpacingPx(style,size);
  // Logical HarfBuzz clusters are monotone. Expanded scalars can yield several glyphs at the same source position.
  for (let i=0; i<raw.length;) {
    const source = raw[i].cluster;
    let next = i+1;
    while (next < raw.length && raw[next].cluster === source) next++;
    const clusterEnd = raw[next]?.cluster ?? end;
    const scale = (small?.has(source) ? 0.72 : 1)*scriptScale;
    for (; i<next; i++) {
      const g = raw[i], spacing = i===next-1 ? letterSpacing*(clusterEnd-source) : 0;
      const em = onGrid(g.nominalAdvance,face.upem)+onGrid(g.advance-g.nominalAdvance,face.upem);
      yield {face,style,coordinates,id:g.id,start:source,end:clusterEnd,level,size:size*scale,advance:em*size*scale+spacing,
        spacing,offsetX:g.offsetX*k*scale,offsetY:g.offsetY*k*scale+scriptShift*k};
    }
  }
}

/** Logical glyph items before line layout. Resolve paragraph direction automatically unless the caller supplies scalar-indexed levels. */
export function* styledGlyphs(text: TextData, fonts: FontLibrary, levels: ArrayLike<number> | undefined = textBidi(text.characters,text.paragraphs)?.levels) {
  const chars = Array.from(text.characters), boundaries = new TextGraphemes(text.characters);
  for (const {start,end,style} of textSpans(text)) {
    const segments = fonts.segments(chars,boundaries,start,end,style.fontFamily,style.fontStyle,levels);
    for (const segment of segments) yield* styledSegment(chars,segment,style,text.features);
  }
}
