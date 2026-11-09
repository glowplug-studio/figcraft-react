import { isLosslessNumber } from "lossless-json";
import { wireTextData, type TextData } from "./text-data";
import { normaliseRuns, scalarCount } from "./text-ranges";
import type { TextStyle } from "./text-style";

function layoutStyle(style: TextStyle): TextStyle {
  if (!style.fills && style.link === undefined && style.styleId === undefined &&
      style.decoration === "none" && !style.decorationLook) return style;
  return Object.freeze({...style, fills:undefined, link:undefined, styleId:undefined,
    decoration:"none", decorationLook:undefined});
}

// serde_json 1.0.154 uses zmij for f64. Its fixed notation covers decimal
// exponents -5 through 15 and retains a decimal point on whole values.
function nativeFloat(value: number): string {
  if (Object.is(value, -0)) return "-0.0";
  if (value === 0) return "0.0";
  const magnitude = Math.abs(value);
  if (magnitude < 1e-5 || magnitude >= 1e16) return value.toExponential();
  return Number.isInteger(value) ? value.toFixed(1) : String(value);
}

export function compareScalarKeys(left: string, right: string): number {
  let i = 0;
  while (i < left.length && i < right.length) {
    const a = left.codePointAt(i)!, b = right.codePointAt(i)!;
    if (a !== b) return a - b;
    i += a > 0xffff ? 2 : 1;
  }
  return left.length - right.length;
}

// The wire model supplies struct order. BTreeMap orders dynamic keys by UTF-8,
// including integer-like keys which JS objects enumerate in numeric order.
function layoutJson(value: unknown, field = "", parent = ""): string {
  if (isLosslessNumber(value)) return value.value;
  if (typeof value === "number") {
    return parent === "runs" || parent === "paragraphs" ? String(value) : nativeFloat(value);
  }
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(entry => layoutJson(entry, field)).join(",") + "]";
  const entries = Object.entries(value);
  if (field === "variations" || field === "features") entries.sort(([a],[b]) => compareScalarKeys(a,b));
  return "{" + entries.map(([key,member]) => JSON.stringify(key) + ":" + layoutJson(member,key,field)).join(",") + "}";
}

const keys = new WeakMap<TextData,string>();
const utf8 = new TextEncoder();

export function textLayoutKey(text: TextData): string {
  const previous = keys.get(text);
  if (previous !== undefined) return previous;
  const style = layoutStyle(text.style);
  const runs = text.runs.length ? normaliseRuns(text.runs.map(r => ({...r, style:layoutStyle(r.style)})),
    style, scalarCount(text.characters)) : text.runs;
  const layout = wireTextData({...text, style, runs, alignV:"top", paragraphSpacing:0,
    listSpacing:0, leadingTrim:"none", maxLines:0, savedBreaks:undefined});
  // 64-bit FNV-1a, using the two 32-bit words of the prime 0x100000001b3.
  let high = 0xcbf29ce4, low = 0x84222325;
  for (const byte of utf8.encode(layoutJson(layout))) {
    const bits = (low ^ byte) >>> 0;
    const product = bits * 435;
    high = (Math.imul(high,435) + (bits << 8) + Math.floor(product / 0x100000000)) >>> 0;
    low = product >>> 0;
  }
  const key = ((BigInt(high) << 32n) | BigInt(low)).toString();
  if (Object.isFrozen(text)) keys.set(text,key);
  return key;
}

export function saveTextBreaks(text: TextData, starts: readonly number[], width: number): TextData {
  const forText = textLayoutKey(text);
  const savedBreaks = Object.freeze({starts:Object.freeze([...starts]),width,forText});
  const next = Object.freeze({...text,savedBreaks});
  keys.set(next,forText);
  return next;
}

export function savedBreaksFor(text: TextData, width: number): readonly number[] | undefined {
  const saved = text.savedBreaks;
  if (!saved || !(Math.abs(saved.width - width) <= 1e-6 * Math.max(1,Math.abs(width)))) return;
  if (saved.starts.length) {
    const count = scalarCount(text.characters);
    let previous = 0;
    for (const start of saved.starts) {
      if (!Number.isSafeInteger(start) || start <= previous || start >= count) return;
      previous = start;
    }
  }
  return saved.forText === textLayoutKey(text) ? saved.starts : undefined;
}
