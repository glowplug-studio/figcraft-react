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
/** Automation serialises small native ids as numbers and retains every digit of larger u64s. */
export function inspectedId(id: NodeId): number | string {
  const numeric = Number(id);
  return Number.isSafeInteger(numeric) ? numeric : id;
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

/** Native req_index accepts numeric command values below the exclusive one-billion limit. */
export function parseIndex(value: unknown, key = "index"): number {
  const index = parseNumber(value, key);
  if (!Number.isInteger(index) || index < 0 || index >= 1e9) throw new Error(`${key} out of range`);
  return index;
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

/** Native enum_of normalises command strings; file enums stay exact. */
export function propertyEnum<T extends string>(value: unknown, allowed: readonly T[], command = true): T {
  if (typeof value !== "string") throw new Error("An enum must be a string");
  let normalised = value;
  if (command) {
    const noLowercase = !/\p{Ll}/u.test(value);
    let upper = false;
    normalised = [...value.trim()].map((ch, i) => {
      if (ch === "_" || ch === "-" || ch === " ") { upper = true; return ""; }
      if (i === 0) return ch.toLowerCase();
      if (upper) { upper = false; return ch.toUpperCase(); }
      return noLowercase ? ch.toLowerCase() : ch;
    }).join("");
  }
  const found = allowed.find(item => item === normalised);
  if (found === undefined) throw new Error(`Unsupported enum value: ${value}`);
  return found;
}
