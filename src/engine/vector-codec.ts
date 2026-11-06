import type { Affine } from "./affine";
import { readSolidPaints } from "./solid-paint";
import { strokeCaps } from "./stroke";
import { freezeNetwork, type RegionPaintSpace, type VectorNetwork } from "./vector-network";

function object(v: unknown): Record<string, unknown> { if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error("Vector metadata must be an object"); return v as Record<string, unknown>; }
function array(v: unknown): readonly unknown[] { if (!Array.isArray(v)) throw new Error("Vector metadata must be an array"); return v; }
function number(v: unknown): number { if (typeof v !== "number" || !Number.isFinite(v)) throw new Error("Vector coordinates must be finite numbers"); return v; }
function index(v: unknown): number { const n = number(v); if (!Number.isSafeInteger(n) || n < 0) throw new Error("Vector indices must be nonnegative safe integers"); return n; }
function option<T extends string>(v: unknown, values: readonly T[]): T | undefined { if (v == null) return undefined; if (typeof v !== "string" || !values.includes(v as T)) throw new Error("Invalid vector point style"); return v as T; }
function handle(v: unknown): readonly [number, number] { if (v === undefined) return [0, 0]; const a = array(v); if (a.length !== 2) throw new Error("Vector handles need two numbers"); return [number(a[0]), number(a[1])]; }
function frame(v: unknown): RegionPaintSpace | undefined {
  if (v == null) return undefined; const raw = object(v), matrix = array(raw.transform).map(number); if (matrix.length !== 6) throw new Error("Region paint transform needs six numbers");
  return { width: number(raw.width), height: number(raw.height), transform: matrix as unknown as Affine };
}
/** Native files retain damaged references; only the REST importer invokes network sanitisation. */
export function readVectorNetwork(value: unknown): VectorNetwork {
  const raw = object(value);
  return freezeNetwork({ vertices: array(raw.vertices).map(v => {
    const r = object(v), mirror = option(r.mirror, ["none", "angle", "angleAndLength"] as const), cap = option(r.cap, strokeCaps), join = option(r.join, ["miter", "bevel", "round"] as const);
    return { x: number(r.x), y: number(r.y), radius: r.radius === undefined ? 0 : number(r.radius), ...(mirror === undefined ? {} : { mirror }), ...(cap === undefined ? {} : { cap }), ...(join === undefined ? {} : { join }) };
  }), segments: array(raw.segments).map(v => { const r = object(v); return { a: index(r.a), b: index(r.b), ta: handle(r.ta), tb: handle(r.tb) }; }),
  regions: array(raw.regions === undefined ? [] : raw.regions).map(v => {
    const r = object(v), winding = r.winding === undefined ? "nonZero" : r.winding;
    if (winding !== "nonZero" && winding !== "evenOdd") throw new Error("Invalid vector winding rule");
    const paintSpace = frame(r.paint_space);
    return { loops: array(r.loops).map(l => array(l).map(index)), winding, ...(r.fills == null ? {} : { fills: readSolidPaints(r.fills) }), ...(paintSpace ? { paintSpace } : {}) };
  }) });
}
export function wireVectorNetwork(net: VectorNetwork): Record<string, unknown> {
  return { vertices: net.vertices, segments: net.segments, regions: net.regions.map(({ paintSpace, ...r }) => ({ ...r, ...(paintSpace ? { paint_space: paintSpace } : {}) })) };
}
