import { requiredTargets } from "./arrange";
import { wireBrush } from "./brush";
import { zeroCorners } from "./corners";
import { isFrameLike, layerBlend, rectanglePaints, type Document, type DocumentNode } from "./document";
import { wireEffect } from "./effects";
import { HierarchyDraft } from "./hierarchy";
import { inspectedId } from "./parameters";
import { writeProperties } from "./properties";
import { validateChangedGeometry } from "./rotation";
import type { Paint } from "./solid-paint";
import { defaultStroke } from "./stroke";
import { widthProfilePoints } from "./width-profile";

function copiedPaints(paints: readonly Paint[]) {
  return paints.map(({ colorAlpha, ...paint }) => ({
    ...paint, ...(paint.type === "pattern" && { source: inspectedId(paint.source) }),
    ...(colorAlpha !== 1 && { colorAlpha }),
  }));
}

export function copyLayerProperties(node: DocumentNode): Record<string, unknown> {
  const layer = node.kind === "page" ? undefined : node;
  const stroke = node.stroke ?? defaultStroke, corners = layer?.corners ?? zeroCorners;
  const text = node.kind === "text" ? node.text.style : undefined;
  return {
    fills: copiedPaints(layer ? rectanglePaints(layer) : node.fills ?? []), strokes: copiedPaints(node.strokes ?? []),
    strokeWeight: stroke.weight, strokeSides: stroke.sides ?? null, strokeAlign: stroke.align,
    startCap: stroke.capStart, endCap: stroke.capEnd, strokeJoin: stroke.join, miterLimit: stroke.miterLimit,
    dashCap: stroke.dashCap, dashes: stroke.dashes, widthProfile: stroke.widthProfile ? widthProfilePoints(stroke.widthProfile) : null,
    brush: stroke.brush ? wireBrush(stroke.brush) : null, effects: (node.effects ?? []).map(wireEffect),
    opacity: node.opacity ?? 1, blend: layer ? layerBlend(layer) : node.blend ?? "passThrough",
    ...(node.kind !== "vector" && { cornerRadius: corners.radii, cornerSmoothing: corners.smoothing }),
    ...(text && { fontFamily: text.fontFamily, fontStyle: text.fontStyle, fontSize: text.fontSize,
      fontVariations: text.variations, lineHeight: text.lineHeight, letterSpacing: text.letterSpacing }),
  };
}

export function pasteLayerProperties(document: Document, selection: readonly string[], params: Record<string, unknown>,
  clipboard: Readonly<Record<string, unknown>> | undefined) {
  if (!clipboard) throw new Error("No copied properties");
  const draft = new HierarchyDraft(document);
  for (const id of requiredTargets(document, selection, params)) {
    const node = draft.nodes[id], props = { ...clipboard };
    if (node.kind !== "text") {
      for (const key of ["fontFamily", "fontStyle", "fontSize", "fontVariations", "lineHeight", "letterSpacing"]) delete props[key];
    }
    if (!isFrameLike(node) && !["rectangle", "polygon", "star", "vector"].includes(node.kind)) {
      delete props.cornerRadius; delete props.cornerSmoothing;
    }
    writeProperties(draft, draft.document, selection, { id, props }, undefined, []);
  }
  draft.normaliseGroups();
  return validateChangedGeometry(draft);
}
