import { isLosslessNumber } from "lossless-json";
import type { Document } from "./document";
import type { ImageResource } from "./image-resource";

export const versionLimit = 100;
export const versionByteLimit = 1024 ** 3;
export const versionIndexLimit = 16 * 1024 ** 2;
export type VersionImages = Readonly<Record<string, ImageResource>>;
export interface FileVersion {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly time: string;
  readonly auto: boolean;
  readonly snapshot: { json: Blob; images: VersionImages } | { document: Document; nextId: string };
}

export function validVersionId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(value);
}

export function clippedText(value: unknown, limit: number) {
  if (typeof value !== "string") return "";
  let result = "", length = 0;
  for (const character of value) {
    if (length++ === limit) break;
    result += character;
  }
  return result;
}

export function readVersionTime(value: unknown) {
  const text = isLosslessNumber(value) ? value.value : typeof value === "number" ? String(value) : "";
  return /^\d{1,20}$/.test(text) && BigInt(text) <= 18446744073709551615n ? text : "0";
}
