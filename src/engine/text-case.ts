import type { TextCase } from "./text-style";

const graphemes = new Intl.Segmenter(undefined, {granularity:"grapheme"});
const alphanumeric = /[\p{Alphabetic}\p{Number}]/u;
function combining(c: string) {
  // Native is_combining_mark tests whether this scalar extends a preceding "a".
  if (c.codePointAt(0)! < 128 || alphanumeric.test(c)) return false;
  return graphemes.segment("a" + c).containing(0)?.segment.length === 1 + c.length;
}
const apostrophe = (c: string) => c === "'" || c === "’";

/** The two preceding source scalars supply context at a styled run boundary. */
export function applyTextCase(style: TextCase, value: string, before?: string, prev?: string) {
  if (style === "upper") return value.toUpperCase();
  if (style === "lower") return value.toLowerCase();
  if (style !== "title") return value;
  let start = !prev || !(alphanumeric.test(prev) || ((apostrophe(prev) || combining(prev)) && before && alphanumeric.test(before)));
  let result = "";
  for (const c of value) {
    if (start && alphanumeric.test(c)) {
      result += c.toUpperCase();
      start = false;
    } else {
      result += c;
      if (!combining(c)) start = apostrophe(c) ? !prev || !(alphanumeric.test(prev) || combining(prev)) : !alphanumeric.test(c);
    }
    prev = c;
  }
  return result;
}
export const validOpenTypeTag = (tag: string) => tag.length === 4 && /^[\x20-\x7e]+$/.test(tag);
