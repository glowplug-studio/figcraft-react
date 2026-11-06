import type { LayerNode } from "./document";
import { parseNumber } from "./parameters";
import { pixelRound } from "./geometry";
export const isShapeKey = (key: string): boolean => ["pointCount", "innerRadius", "ratio"].includes(key);
export function setShapeProperties(node: LayerNode, props: Record<string, unknown>): LayerNode {
  let updated = node;
  for (const key of Object.keys(props).filter(isShapeKey).sort()) {
    if (key === "pointCount") {
      const value = pixelRound(parseNumber(props[key], key));
      if (updated.kind !== "polygon" && updated.kind !== "star") throw new Error("pointCount applies to polygons and stars");
      const count = Math.max(3, Math.min(updated.kind === "star" ? 60 : 120, value));
      if (count !== updated.count) updated = Object.freeze({ ...updated, count });
    } else {
      if (updated.kind !== "star") throw new Error("innerRadius applies to stars");
      let ratio = .38;
      try { ratio = parseNumber(props[key]); if (ratio > 1 || typeof props[key] === "string" && (props[key] as string).trim().endsWith("%")) ratio /= 100; } catch { /* Native malformed ratio fallback. */ }
      ratio = Math.max(0, Math.min(1, ratio));
      if (ratio !== updated.innerRatio) updated = Object.freeze({ ...updated, innerRatio: ratio });
    }
  }
  return updated;
}
