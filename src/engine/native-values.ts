import { isLosslessNumber, LosslessNumber } from "lossless-json";
import type { Paint } from "./solid-paint";

export const U64_MAX = 18_446_744_073_709_551_615n;

export function fail(message: string): never { throw new Error(`Cannot open Figcraft file: ${message}`); }
export function number(value: unknown, path: string): number {
  const result = isLosslessNumber(value) ? Number(value.value) : value;
  if (typeof result !== "number" || !Number.isFinite(result)) fail(`${path} must be finite`);
  return result;
}
export function idString(value: string, path: string): string {
  if (!/^(0|[1-9][0-9]*)$/.test(value) || value.length > 20 || BigInt(value) > U64_MAX) fail(`${path} must be an unsigned 64-bit integer`);
  return value;
}
export function id(value: unknown, path: string): string {
  if (!isLosslessNumber(value)) fail(`${path} must be a numeric node ID`);
  return idString(value.value, path);
}
export function wireId(value: string): LosslessNumber { return new LosslessNumber(idString(value, "node ID")); }

/** Convert only appearance numbers; node IDs remain lossless tokens elsewhere. */
export function appearanceValue(value: unknown): unknown {
  if (isLosslessNumber(value)) return number(value, "appearance number");
  if (Array.isArray(value)) return value.map(appearanceValue);
  if (value && typeof value === "object") {
    const pattern = "type" in value && value.type === "pattern";
    return Object.fromEntries(Object.entries(value).map(([key, entry]) =>
      [key, pattern && key === "source" ? id(entry, "pattern source") : appearanceValue(entry)]));
  }
  return value;
}

export function wirePaints(paints: readonly Paint[]) {
  return paints.some(p => p.type === "pattern")
    ? paints.map(p => p.type === "pattern" ? { ...p, source: wireId(p.source) } : p)
    : paints;
}
