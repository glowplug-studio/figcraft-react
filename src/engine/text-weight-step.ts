import { normaliseFontStyle } from "./font-tables";
import { familyStyleWeights } from "./text-node-layout";
import { styledName, weightName } from "./text-properties";
import { setFontStyle, styleWeight, textItalic, textWeight, type TextStyle } from "./text-style";

const weights = new Set(("thin hairline extralight ultralight light semilight demilight regular normal roman book medium semibold " +
  "demibold bold extrabold ultrabold black extrablack ultrablack heavy italic oblique plain standard").split(" "));
const grades = new Set(["extra","ultra","semi","demi"]);
const widths = new Set(["condensed","compressed","narrow","extended","expanded","wide"]);
const slanted = (name:string) => /italic|oblique/i.test(name);
function numericWeight(word:string) {
  if (/^w[1-9]$/.test(word)) return Number(word[1])*100;
  const n = Number(word);
  if (/^\d+$/.test(word) && n >= 100 && n <= 1000) return n;
}
function describeStyle(style:string) {
  const words = style.toLowerCase().replaceAll("-"," ").trim().split(/\s+/);
  const univers = /^[1-9][3-9]$/.test(words[0]) && words.length > 1 &&
    words.slice(1).every(w => weights.has(w) || grades.has(w) || widths.has(w));
  const weightWord = (w:string) => weights.has(w) || numericWeight(w) !== undefined;
  const rest = words.filter((w,i) => !weightWord(w) && !(grades.has(w) && weightWord(words[i+1] ?? "") &&
    !["italic","oblique"].includes(words[i+1])));
  if (univers) rest[0] = "univers width " + Math.floor((Number(words[0][1])-1)/2);
  const weight = univers ? styleWeight(words.slice(1).join(" ")) : words.map(numericWeight).find(n=>n!==undefined) ?? styleWeight(style);
  return {rest:rest.join(" "), weight};
}

export function stepFontWeight(style:TextStyle, up:boolean): TextStyle {
  const styles = familyStyleWeights(style.fontFamily);
  if (!styles.length) {
    const w = Math.max(100,Math.min(900,textWeight(style)+(up ? 100 : -100)));
    return setFontStyle(style,styledName(weightName(w),textItalic(style)));
  }
  const description = describeStyle(style.fontStyle), italic = textItalic(style) || slanted(style.fontStyle);
  const candidates = styles.filter(s => slanted(s.name) === italic && describeStyle(s.name).rest === description.rest);
  const index = candidates.findIndex(s => normaliseFontStyle(s.name) === normaliseFontStyle(style.fontStyle));
  if (index >= 0 && style.variations.wght === undefined) {
    const next = candidates[index+(up ? 1 : -1)];
    return next ? setFontStyle(style,next.name) : style;
  }
  const weight = style.variations.wght === undefined ? description.weight : textWeight(style);
  if (!up) candidates.reverse();
  let best = Infinity, next: string | undefined;
  for (const candidate of candidates) {
    const delta = (candidate.weight-weight)*(up ? 1 : -1);
    if (delta > 0 && delta < best) { best = delta; next = candidate.name; }
  }
  return next === undefined ? style : setFontStyle(style,next);
}
