import { bytesToHex } from "@noble/hashes/utils.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { object, entries, children, clamp, type JsonObject } from "../rest/values";
import { nativeFloat } from "../../text-breaks";
import { parseHexColour } from "../../colour-css";
import type { DocumentGuide } from "../../document";
import type { PenpotNumbers } from "./archive";

export const records = (value: unknown) => children(value).map(object);
export const clipped = (value: string, limit: number) => Array.from(value).slice(0, limit).join("");
export const hex = (value: unknown) => typeof value === "string" ? parseHexColour(value) : undefined;

function numeric(value: unknown) {
  if (typeof value === "number") return value;
  if (typeof value === "string" && /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value)) return Number(value);
}

export function numberField(source: JsonObject, key: string, fallback: number, min = -1e6, max = 1e6) {
  const n = numeric(source[key]);
  return n !== undefined && Number.isFinite(n) ? clamp(n, min, max) : fallback;
}

export function guides(value: unknown): DocumentGuide[] {
  const items = Array.isArray(value) ? value : entries(value).map(([, v]) => v);
  const guides = [];
  for (const item of items.slice(0, 500).map(object)) {
    const axis = item.axis ?? item.orientation, vertical = axis === "x" || axis === "vertical";
    const offset = numeric(Object.hasOwn(item, "position") ? item.position : item.offset);
    if ((vertical || axis === "y" || axis === "horizontal") && offset !== undefined && Number.isFinite(offset) && Math.abs(offset) <= 1e6)
      guides.push({vertical, offset});
  }
  return guides;
}

/** serde_json::Value sorts object keys by scalar order and retains integer, float and u64 representations. */
export function sourceJson(value: unknown, numbers?: PenpotNumbers, parent?: object, key = "", integers?: ReadonlySet<string>): string {
  if (typeof value === "number") {
    if (integers?.has(key)) return String(value);
    const token = parent && numbers?.token(parent, key, value);
    if (token && /^-?\d{1,20}$/.test(token) && token !== "-0") {
      const n = BigInt(token);
      if (n >= -0x8000000000000000n && n <= 0xffffffffffffffffn) return token;
    }
    return nativeFloat(value);
  }
  if (Array.isArray(value)) return "[" + value.map((v, i) => sourceJson(v, numbers, value, String(i), integers)).join(",") + "]";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  return "{" + entries(value).map(([k,v]) => JSON.stringify(k) + ":" + sourceJson(v, numbers, value, k, integers)).join(",") + "}";
}

const utf8 = new TextEncoder();
export function keepSource(metadata: Record<string, string>, key: string, value: unknown, numbers: PenpotNumbers, limit = 16384, parent?: object, field?: string) {
  if (value === undefined) return;
  const encoded = sourceJson(value, numbers, parent, field);
  if (encoded.length <= limit && utf8.encode(encoded).length <= limit) metadata[key] = encoded;
}

export function fingerprint(value: unknown, integers?: ReadonlySet<string>) {
  return bytesToHex(sha256(utf8.encode(sourceJson(value, undefined, undefined, "", integers)))).slice(0, 32);
}
