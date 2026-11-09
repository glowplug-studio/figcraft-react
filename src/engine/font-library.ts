import { compareScalarKeys } from "./text-breaks";
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

export interface LocalFontName {readonly id:number; readonly family:string; readonly style:string; readonly postscript:string}
function pendingWeight(style:string) {
  const weight=/^w([0-9])$/.exec(normaliseFontStyle(style));
  return weight ? Number(weight[1])*100 : styleWeight(style);
}
function pendingDistance(want:string,have:string) {
  if (normaliseFontStyle(want)===normaliseFontStyle(have)) return 0;
  const slants=(s:string)=>/italic|oblique/i.test(s);
  return 1+Math.abs(pendingWeight(want)-pendingWeight(have))+(slants(want)===slants(have) ? 0 : 1000);
}

/** Loaded faces and the names of browser fonts awaiting their first use. */
export class FontLibrary {
  readonly #families = new Map<string,ShapingFace[]>();
  readonly #names=new Map<string,string>();
  readonly #pending=new Map<string,LocalFontName[]>();
  readonly #offered=new Map<number,LocalFontName>();
  readonly #asked=new Set<number>();
  constructor(private readonly requestLocal?:(font:LocalFontName)=>void) {}
  readonly #familyPrefixes = new Set<string>();
  readonly #squashed = new Map<string,string>();
  readonly #fallbacks = new Map<string,readonly ShapingFace[]>();
  #emoji?: readonly ShapingFace[];

  add(face: ShapingFace) {
    const key = face.family.toLowerCase(), group = this.#families.get(key);
    if (group?.includes(face)) return;
    if (group) group.push(face);
    else this.#families.set(key,[face]);
    this.#name(key,face.family);
    this.#fallbacks.clear();
    this.#emoji=undefined;
  }

  #name(key:string,name:string) {
    if (this.#names.has(key)) return;
    this.#names.set(key,name);
    for (let i=key.indexOf(" "); i>=0; i=key.indexOf(" ",i+1)) this.#familyPrefixes.add(key.slice(0,i));
    const compact = squash(key);
    if (!this.#squashed.has(compact)) this.#squashed.set(compact,key);
  }

  offerLocal(entries:readonly LocalFontName[]) {
    const added:string[]=[];
    for (const entry of entries) {
      const family=entry.family.trim(), key=family.toLowerCase();
      if (!family || this.#offered.has(entry.id)) continue;
      if (this.#families.get(key)?.some(face=>hasStyle(face,normaliseFontStyle(entry.style)))) continue;
      if (!this.#names.has(key)) added.push(family);
      this.#name(key,family);
      const pending=this.#pending.get(key);
      if (pending) pending.push(entry);
      else this.#pending.set(key,[entry]);
      this.#offered.set(entry.id,entry);
    }
    this.#fallbacks.clear();
    this.#emoji=undefined;
    return added.sort((a,b)=>compareScalarKeys(a.toLowerCase(),b.toLowerCase()));
  }

  finishLocal(id:number,face?:ShapingFace) {
    const entry=this.#offered.get(id);
    if (!entry) return;
    const key=entry.family.trim().toLowerCase();
    this.#offered.delete(id);
    this.#asked.delete(id);
    const remaining=this.#pending.get(key)!.filter(f=>f.id!==id);
    if (remaining.length) this.#pending.set(key,remaining);
    else this.#pending.delete(key);
    if (face) this.add(face);
    if (!this.#families.has(key) && !remaining.length) {
      this.#names.delete(key);
      const compact=squash(key);
      if (this.#squashed.get(compact)===key) {
        this.#squashed.delete(compact);
        for (const other of this.#names.keys()) if (squash(other)===compact) { this.#squashed.set(compact,other); break; }
      }
    }
    this.#fallbacks.clear();
    this.#emoji=undefined;
  }

  #requestNearest(key:string,style:string) {
    if (!this.requestLocal) return;
    const pending=this.#pending.get(key);
    if (!pending?.length) return;
    let nearest=0, distance=pendingDistance(style,pending[0].style);
    for (let i=1;distance>0 && i<pending.length;i++) {
      const d=pendingDistance(style,pending[i].style);
      if (d<distance) { nearest=i; distance=d; }
    }
    // Native pending reads return to the back of the family, including repeated requests.
    const [best]=pending.splice(nearest,1);
    pending.push(best);
    if (this.#asked.has(best.id)) return;
    this.#asked.add(best.id);
    this.requestLocal(best);
  }

  #key(family: string) {
    const key = family.trim().toLowerCase();
    if (this.#names.has(key)) return key;
    const alias = key.replace(/^\.+/,"");
    if (systemAliases.has(alias) && this.#names.has("system font")) return "system font";
    if ((alias === "sf compact text" || alias === "sf compact display") && this.#names.has("sf compact")) return "sf compact";
    return this.#squashed.get(squash(key)) ?? key;
  }

  #resolve(family: string,style: string): readonly [string,string] {
    const key = this.#key(family), normal = normaliseFontStyle(style);
    const faces = this.#families.get(key);
    if (this.#names.has(key) && (!this.#familyPrefixes.has(key) || faces?.some(face=>hasStyle(face,normal)) || this.#pending.get(key)?.some(f=>normaliseFontStyle(f.style)===normal))) return [key,style];
    const words = style.trim().split(/\s+/).filter(w=>w && !/^(italic|oblique)$/i.test(w));
    if (weightsOnly(words) && normaliseFontStyle(words.join("")) !== "regular") {
      const whole = this.#key(key+" "+style), upright = this.#key(key+" "+words.join(" "));
      if (this.#names.has(whole)) return [whole,"Regular"];
      if (this.#names.has(upright)) return [upright,/italic/i.test(style) ? "Italic" : "Regular"];
    }
    if (!this.#names.has(key)) {
      const parts = family.trim().split(/\s+/);
      for (let split=parts.length-1; split>0; split--) {
        const base = this.#key(parts.slice(0,split).join(" ")), rest = parts.slice(split);
        if (this.#names.has(base) && weightsOnly(rest)) {
          return [base,rest.join(" ")+(["","regular","normal"].includes(normal) ? "" : " "+style)];
        }
      }
    }
    return [key,style];
  }

  hasFamily(family:string):boolean {
    const [resolved]=this.#resolve(family,"Regular");
    if (this.#names.has(resolved)) return true;
    const prefix=this.#key(family)+" ";
    return this.#familyPrefixes.has(prefix.trimEnd()) && [...this.#names.keys()].some(key=>
      key.startsWith(prefix) && weightsOnly(key.slice(prefix.length).split(/\s+/)));
  }

  families(): string[] {
    return [...this.#names.keys()].sort(compareScalarKeys).map(key=>this.#names.get(key)!);
  }

  styles(family: string): string[] {
    return this.styleWeights(family).map(style => style.name);
  }

  styleWeights(family: string): {name:string; weight:number}[] {
    const key = this.#key(family);
    const entries: {weight:number; italic:boolean; index:number; name:string}[] = [];
    for (const local of this.#pending.get(key) ?? []) {
      entries.push({weight:Math.min(1000,Math.max(1,pendingWeight(local.style))),italic:/italic/i.test(local.style),index:0,name:local.style});
    }
    for (const face of this.#families.get(key) ?? []) {
      if (!face.instances.length) entries.push({weight:face.weight, italic:face.italic, index:0, name:face.style});
      face.instances.forEach(({name, coordinates}, index) => {
        const weight = Math.round(Math.max(1, Math.min(1000, coordinates.wght ?? face.weight)));
        entries.push({weight, italic:face.italic || /italic|oblique/i.test(name), index, name});
      });
    }
    if (this.#familyPrefixes.has(key)) {
      for (const [other, display] of this.#names) {
        if (!other.startsWith(key + " ")) continue;
        const suffix = display.slice(key.length + 1).trim();
        if (!weightsOnly(suffix.split(/\s+/))) continue;
        const italic = /italic|oblique/i.test(suffix);
        const styles=[
          ...(this.#families.get(other) ?? []).map(f=>({weight:f.weight,slanted:f.italic})),
          ...(this.#pending.get(other) ?? []).map(f=>({weight:pendingWeight(suffix),slanted:/italic/i.test(f.style)})),
        ];
        for (const {weight,slanted} of styles) entries.push({weight,italic:slanted || italic,index:0,
          name:slanted && !italic ? suffix + " Italic" : suffix});
      }
    }
    entries.sort((a,b) => a.weight-b.weight || Number(a.italic)-Number(b.italic) || a.index-b.index ||
      (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    const seen = new Set<string>();
    return entries.flatMap(({name,weight}) => {
      const normal = normaliseFontStyle(name);
      if (seen.has(normal)) return [];
      seen.add(normal);
      return [{name,weight}];
    });
  }

  find(family: string,style: string, fallbackOnly=false) {
    const [key,requested] = this.#resolve(family,style), faces = this.#families.get(key);
    if (!faces) { this.#requestNearest(key,requested); return undefined; }
    const normal = normaliseFontStyle(requested);
    const exact = faces.find(face=>normaliseFontStyle(face.style) === normal) ?? faces.find(face=>hasStyle(face,normal));
    if (exact) return exact;
    if (!fallbackOnly) this.#requestNearest(key,requested);
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

  styleWarning(family: string, style: string) {
    const names = this.styles(family), normal = normaliseFontStyle(style);
    if (!names.length || names.some(name => normaliseFontStyle(name) === normal)) return;
    const face = this.find(family, style), weight = styleWeight(style);
    if (!face || face.family.toLowerCase() !== family.toLowerCase()) return;
    const axis = face.axes.wght;
    const resolved = axis ? Math.round(Math.max(axis.min, Math.min(axis.max, weight))) : face.weight;
    if (face.instances.some(i => normaliseFontStyle(i.name) === normal) ||
      resolved === weight && face.italic === /italic/i.test(style)) return;
    return family + " has no `" + style + "` style: it draws in " + face.style + ", the nearest (it has: " + names.join(", ") + ")";
  }

  defaultFace() {
    for (const family of defaultFamilies) {
      const found = this.find(family,"Regular");
      if (found) return found;
    }
    return this.#families.values().next().value?.[0];
  }

  #ordered(families: readonly string[],style: string) {
    return families.flatMap(family=>this.find(family,style,true) ?? []);
  }

  fallbacks(style: string): readonly ShapingFace[] {
    let fallbacks = this.#fallbacks.get(style);
    if (!fallbacks) {
      fallbacks = this.#ordered(fallbackFamilies,style);
      if (this.#fallbacks.size >= 64) this.#fallbacks.clear();
      this.#fallbacks.set(style,fallbacks);
    }
    return fallbacks;
  }

  emojiFallbacks(): readonly ShapingFace[] {
    return this.#emoji ??= this.#ordered(emojiFamilies,"Regular");
  }

  *segments(chars: readonly string[], bounds: TextGraphemes, start: number, end: number,
    family: string, style: string, levels?: ArrayLike<number>) {
    const primary = this.find(family,style) ?? this.defaultFace();
    if (!primary || start<0 || end>chars.length || bounds.length!==chars.length ||
      !Number.isInteger(start) || !Number.isInteger(end)) return;
    const fallbacks=this.fallbacks(style);
    const emoji=this.emojiFallbacks();
    yield* fontSegments(chars,bounds,start,end,primary,emoji,fallbacks,levels);
  }
}
