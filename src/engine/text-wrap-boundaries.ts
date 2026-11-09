import { extendsLetter } from "./text-graphemes";

const opening = new Set("([{‘“〈《「『【〔〖〘〚〝（［｛｢｟");
const closing = new Set(")]},.:;!?’”‥…‼⁇⁈⁉、。々〉》」』】〕〗〙〛〜〞〟〻ぁぃぅぇぉっゃゅょゎゕゖゝゞ゠ァィゥェォッャュョヮヵヶ・ーヽヾ！），．：；？］｝｡｣､･ｰ｠゛゜〱〲〳〴〵");
const smallKana = /^[\u31f0-\u31ff\uff67-\uff6f\uff9e\uff9f]$/u;
const spaces = /^[ \t\u3000\u2002-\u2006\u2008-\u200b]$/u;
const ideographs = /^[\u2e80-\u2fff\u3003-\u33ff\u3400-\u4dbf\u4e00-\u9fff\ua960-\ua97f\uac00-\ud7af\uf900-\ufaff\ufe30-\ufe4f\uff00-\uffef\u{20000}-\u{3ffff}]$/u;
const leadingVowel = /^[\u0e40-\u0e44\u0ec0-\u0ec4]$/u;

export function isWrapSpace(char: string) { return spaces.test(char); }

function wrapClass(char: string) {
  if (opening.has(char)) return "open";
  if (closing.has(char) || smallKana.test(char)) return "close";
  if (spaces.test(char)) return "space";
  if (char === "\u2007") return "glue";
  if (/^[-/‐–—]$/u.test(char)) return "hyphen";
  return ideographs.test(char) ? "ideograph" : "other";
}
type WrapClass = ReturnType<typeof wrapClass>;
function permits(left: WrapClass, right: WrapClass) {
  if (right === "space" || right === "close" || right === "glue" || left === "open" || left === "glue") return false;
  return left === "space" || left === "hyphen" || left === "ideograph" || right === "ideograph";
}

export function breakBetween(before: string, after: string) {
  return permits(wrapClass(before),wrapClass(after));
}
export function justifyBetween(before: string, after: string) {
  const left = wrapClass(before), right = wrapClass(after);
  return (left === "ideograph" || right === "ideograph") && left !== "space" && permits(left,right);
}
export function safeEmergencyBreak(before: string, after: string) {
  return !leadingVowel.test(before) && (after === "\u200d" || !extendsLetter(after));
}
