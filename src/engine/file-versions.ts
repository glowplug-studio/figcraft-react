import { inspectedId, parseIndex, parseString } from "./parameters";
import { isLosslessNumber } from "lossless-json";
import { sameContent, type Document } from "./document";
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

export function versionDetails(version: FileVersion, index: number) {
  return { id: version.id, index, name: version.name, description: version.description,
    time: inspectedId(version.time), ...(version.auto && { auto: true }) };
}

export class VersionHistory {
  records: readonly FileVersion[];
  #checkpoint?: Document;
  constructor(records: readonly FileVersion[] = []) { this.records = records; }

  index(params: Record<string, unknown>) {
    const id = parseString(params.id);
    const index = id !== undefined ? this.records.findIndex(record => record.id === id) : parseIndex(params.index);
    if (index < 0 || index >= this.records.length) throw new Error("No such version");
    return index;
  }

  changed(document: Document) {
    return !this.#checkpoint || document.currentPage !== this.#checkpoint.currentPage || !sameContent(document, this.#checkpoint);
  }

  mark(document: Document) { this.#checkpoint = document; }

  add(document: Document, nextId: string, params: Record<string, unknown>, auto: boolean) {
    const records = [...this.records];
    if (!auto && records.length >= versionLimit) throw new Error("The version history is full (100 versions): delete old versions first");
    if (auto && (records.length >= versionLimit || records.filter(v => v.auto).length >= 20)) {
      const oldest = records.findIndex(v => v.auto);
      if (oldest < 0) return;
      records.splice(oldest, 1);
    }
    const now = Date.now();
    let stamp = now;
    while (records.some(v => v.id === stamp.toString(16))) stamp++;
    const name = auto ? "Autosave" : parseString(params.name)?.trim() || "Version " + (records.length + 1);
    const version: FileVersion = Object.freeze({ id: stamp.toString(16), name: clippedText(name, 200),
      description: clippedText(parseString(params.description)?.trim(), 2000), time: String(Math.floor(now / 1000)),
      auto, snapshot: { document, nextId } });
    const result = versionDetails(version, records.length);
    records.push(version);
    this.records = Object.freeze(records);
    this.mark(document);
    return result;
  }

  rename(params: Record<string, unknown>) {
    const name = parseString(params.name)?.trim();
    if (!name) throw new Error("Version name cannot be empty");
    const index = this.index(params), previous = this.records[index], description = parseString(params.description);
    const version = Object.freeze({ ...previous, name: clippedText(name, 200), auto: false,
      description: description === undefined ? previous.description : clippedText(description.trim(), 2000) });
    this.records = Object.freeze(this.records.map((v, i) => i === index ? version : v));
    return versionDetails(version, index);
  }

  remove(params: Record<string, unknown>) {
    const index = this.index(params);
    this.records = Object.freeze(this.records.filter((_, i) => i !== index));
    return { ok: true };
  }
}
