import type { NodeId } from "./document";
import { parseNodeId } from "./parameters";

type Pair = readonly [number, number];
export type PatternTile = "grid" | "horizontalHex" | "verticalHex";
export type PatternAlign = "start" | "center" | "end";
export interface Pattern {
  readonly source: NodeId;
  readonly tile: PatternTile;
  readonly scale: number;
  readonly spacing: Pair;
  readonly align: PatternAlign;
}

export function readPattern(value: Record<string,unknown>): Pattern {
  const source = parseNodeId(value.source);
  if (source === undefined) throw new Error("A pattern needs a valid source layer ID");
  const {tile = "grid", scale = 1, spacing = [0,0], align = "start"} = value;
  if (tile !== "grid" && tile !== "horizontalHex" && tile !== "verticalHex") throw new Error("Invalid pattern tile type");
  if (align !== "start" && align !== "center" && align !== "end") throw new Error("Invalid pattern alignment");
  if (typeof scale !== "number" || !Number.isFinite(scale)) throw new Error("Pattern scale must be finite");
  if (!Array.isArray(spacing) || spacing.length !== 2 || !spacing.every(Number.isFinite)) throw new Error("Pattern spacing needs two finite numbers");
  return Object.freeze({source, tile, scale, spacing:Object.freeze([spacing[0],spacing[1]] as const), align});
}

export interface PatternCell {
  readonly size: Pair;
  readonly origin: Pair;
  readonly tiles: readonly Pair[];
  readonly scale: number;
}

export function patternCell(pattern: Pattern, sourceWidth: number, sourceHeight: number, width: number, height: number): PatternCell | undefined {
  const scale = Number.isFinite(pattern.scale) ? Math.max(.01, Math.min(100,pattern.scale)) : 1;
  const tw = sourceWidth * scale, th = sourceHeight * scale;
  if (!Number.isFinite(tw) || !Number.isFinite(th) || tw <= 1e-6 || th <= 1e-6) return;
  const gap = (n: number) => Number.isFinite(n) ? Math.max(0, Math.min(10_000,n)) : 0;
  const px = tw + gap(pattern.spacing[0]), py = th + gap(pattern.spacing[1]);
  const anchor = pattern.align === "center" ? .5 : pattern.align === "end" ? 1 : 0;
  const x = (width - tw) * anchor, y = (height - th) * anchor;
  const origin: Pair = [Number.isFinite(x) ? x : 0, Number.isFinite(y) ? y : 0];
  switch (pattern.tile) {
    case "horizontalHex": return {scale, origin, size:[px,2*py], tiles:[[0,0],[px/2,py],[-px/2,py]]};
    case "verticalHex": return {scale, origin, size:[2*px,py], tiles:[[0,0],[px,py/2],[px,-py/2]]};
    case "grid": return {scale, origin, size:[px,py], tiles:[[0,0]]};
  }
}

/** Round each axis independently so that repeating the cell cannot accumulate fractional texel drift. */
export function patternResolution(cell: PatternCell, screenScale: number) {
  const [w,h] = cell.size;
  if (!(w > 0 && h > 0 && Number.isFinite(w) && Number.isFinite(h))) return;
  const scale = Number.isFinite(screenScale) && screenScale > 0 ? screenScale : 1;
  const rate = Math.min(scale,2048/Math.max(w,h));
  const side = (n: number) => Math.max(1, Math.min(2048, Math.ceil(n * rate)));
  const width = side(w), height = side(h);
  return {width, height, kx:width/w, ky:height/h};
}
