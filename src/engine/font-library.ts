import type { ShapingFace } from "./shaping-face";
import { normaliseFontStyle } from "./font-tables";
import { fontSegments } from "./font-segments";
import type { TextGraphemes } from "./text-graphemes";
import { styleWeight } from "./text-style";

const defaultFamilies = ["Inter","Helvetica Neue","Helvetica","Arial","Segoe UI","Roboto","DejaVu Sans","Liberation Sans","Noto Sans"];
const fallbackFamilies = ["Inter","Helvetica Neue","Arial","Segoe UI","DejaVu Sans","Noto Sans","BIZ UDPGothic",
  "Hiragino Sans","PingFang SC","Hiragino Sans GB","Heiti SC","Noto Sans CJK SC","Microsoft YaHei","Apple SD Gothic Neo",
  "Malgun Gothic","Noto Sans CJK KR","Noto Sans KR","Noto Sans Arabic","Noto Sans Thai","Noto Sans Thai UI","Leelawadee UI",
  "Thonburi","Tahoma","Noto Sans Hebrew","Noto Sans Devanagari","Noto Sans Georgian","Apple Symbols","Segoe UI Symbol",
  "Noto Sans Symbols","Noto Sans Symbols 2","Noto Sans Symbols2","Noto Sans Math"];
const emojiFamilies = ["Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji"];
const systemAliases = new Set(["sf pro","sf pro text","sf pro display","sf ui text","sf ui display","sf ns","sf ns text",
  "sf ns display","san francisco","system-ui","-apple-system","blinkmacsystemfont","applesystemuifont"]);
const squash = (name: string) => name.replace(/[\p{White_Space}_-]/gu,"");
const styleWords = new Set(("thin hairline extralight ultralight light book regular normal roman medium semibold demibold bold "+
  "extrabold ultrabold black heavy italic oblique semi demi extra ultra").split(" "));
const weightsOnly = (words: readonly string[]) => words.length > 0 && words.every(word =>
  styleWords.has(word.toLowerCase()) || (/^\+?\d+$/.test(word) && Number(word)>=1 && Number(word)<=1000));
const hasStyle = (face: ShapingFace, normal: string) => normaliseFontStyle(face.style) === normal ||
  face.instances.some(i=>normaliseFontStyle(i.name) === normal);

/** The loaded portion of the native font database. Each editor can register its own fonts. */
export class FontLibrary {
  readonly #families = new Map<string,ShapingFace[]>();
  readonly #familyPrefixes = new Set<string>();
  readonly #squashed = new Map<string,string>();
  readonly #fallbacks = new Map<string,readonly ShapingFace[]>();
  #emoji?: readonly ShapingFace[];

  add(face: ShapingFace) {
    const key = face.family.toLowerCase(), group = this.#families.get(key);
    if (group?.includes(face)) return;
    if (group) group.push(face);
    else {
      this.#families.set(key,[face]);
      for (let i=key.indexOf(" "); i>=0; i=key.indexOf(" ",i+1)) this.#familyPrefixes.add(key.slice(0,i));
    }
    const compact = squash(key);
    if (!this.#squashed.has(compact)) this.#squashed.set(compact,key);
    this.#fallbacks.clear();
    this.#emoji = undefined;
  }

  #key(family: string) {
    const key = family.trim().toLowerCase();
    if (this.#families.has(key)) return key;
    const alias = key.replace(/^\.+/,"");
    if (systemAliases.has(alias) && this.#families.has("system font")) return "system font";
    if ((alias === "sf compact text" || alias === "sf compact display") && this.#families.has("sf compact")) return "sf compact";
    return this.#squashed.get(squash(key)) ?? key;
  }

  #resolve(family: string,style: string): readonly [string,string] {
    const key = this.#key(family), normal = normaliseFontStyle(style);
    const faces = this.#families.get(key);
    if (faces && (!this.#familyPrefixes.has(key) || faces.some(face=>hasStyle(face,normal)))) return [key,style];
    const words = style.trim().split(/\s+/).filter(w=>w && !/^(italic|oblique)$/i.test(w));
    if (weightsOnly(words) && normaliseFontStyle(words.join("")) !== "regular") {
      const whole = this.#key(key+" "+style), upright = this.#key(key+" "+words.join(" "));
      if (this.#families.has(whole)) return [whole,"Regular"];
      if (this.#families.has(upright)) return [upright,/italic/i.test(style) ? "Italic" : "Regular"];
    }
    if (!faces) {
      const parts = family.trim().split(/\s+/);
      for (let split=parts.length-1; split>0; split--) {
        const base = this.#key(parts.slice(0,split).join(" ")), rest = parts.slice(split);
        if (this.#families.has(base) && weightsOnly(rest)) {
          return [base,rest.join(" ")+(["","regular","normal"].includes(normal) ? "" : " "+style)];
        }
      }
    }
    return [key,style];
  }

  find(family: string,style: string) {
    const [key,requested] = this.#resolve(family,style), faces = this.#families.get(key);
    if (!faces) return undefined;
    const normal = normaliseFontStyle(requested);
    const exact = faces.find(face=>normaliseFontStyle(face.style) === normal) ?? faces.find(face=>hasStyle(face,normal));
    if (exact) return exact;
    const weight = styleWeight(requested), italic = /italic/i.test(requested);
    let nearest: ShapingFace | undefined, best = Infinity;
    for (const face of faces) {
      const axis = face.axes.wght, canSlant = !!face.axes.ital || face.axes.slnt?.min < 0;
      const supported = axis ? Math.round(Math.max(axis.min,Math.min(axis.max,weight))) : face.weight;
      const cost = Math.abs(weight-supported) + (face.italic === italic ? 0 : italic && canSlant ? 500 : 1000);
      if (cost < best) { nearest = face; best = cost; }
    }
    return nearest;
  }

  defaultFace() {
    for (const family of defaultFamilies) {
      const found = this.find(family,"Regular");
      if (found) return found;
    }
    return this.#families.values().next().value?.[0];
  }

  #ordered(families: readonly string[],style: string) {
    return families.flatMap(family=>this.find(family,style) ?? []);
  }

  *segments(chars: readonly string[], bounds: TextGraphemes, start: number, end: number,
    family: string, style: string, levels?: ArrayLike<number>) {
    const primary = this.find(family,style) ?? this.defaultFace();
    if (!primary || start<0 || end>chars.length || bounds.length!==chars.length ||
      !Number.isInteger(start) || !Number.isInteger(end)) return;
    let fallbacks = this.#fallbacks.get(style);
    if (!fallbacks) {
      fallbacks = this.#ordered(fallbackFamilies,style);
      if (this.#fallbacks.size >= 64) this.#fallbacks.clear();
      this.#fallbacks.set(style,fallbacks);
    }
    this.#emoji ??= this.#ordered(emojiFamilies,"Regular");
    yield* fontSegments(chars,bounds,start,end,primary,this.#emoji,fallbacks,levels);
  }
}
