import type { NodeId } from "./document";

/** Source: engine/automation/params.rs and doc::NodeId::from_str. */
export function parseNodeId(value: unknown): NodeId | undefined {
  if (typeof value === "number") return Number.isSafeInteger(value) && value >= 0 ? String(value) : undefined;
  if (typeof value !== "string") return undefined;
  const suffix = value.trim().split(":").at(-1)!;
  if (!/^\d+$/.test(suffix)) return undefined;
  const id = BigInt(suffix);
  return id <= 18446744073709551615n ? String(id) : undefined;
}
export function parseString(value: unknown): string | undefined {
  if (typeof value === "string" || typeof value === "boolean") return String(value);
  return typeof value === "number" && Number.isFinite(value) ? String(value) : undefined;
}
export function parseNumber(value: unknown, key = "value"): number {
  let result: number;
  if (typeof value === "number") result = value;
  else if (typeof value === "boolean") result = value ? 1 : 0;
  else if (typeof value === "string") {
    const text = value.trim().replace(/(?:px)+$/, "").replace(/%+$/, "").trim();
    if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(text)) throw new Error(`${key} must be a number`);
    result = Number(text);
  } else throw new Error(`${key} must be a number`);
  if (!Number.isFinite(result)) throw new Error(`${key} must be a finite number`);
  return result;
}

/** Native lenient bool_of; whitespace is deliberately not trimmed. */
export function parseBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value !== 0;
  if (typeof value !== "string") return undefined;
  const text = value.toLowerCase();
  if (["true", "yes", "on", "1"].includes(text)) return true;
  if (["false", "no", "off", "0"].includes(text)) return false;
  return undefined;
}
