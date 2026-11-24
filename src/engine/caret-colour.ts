import { pageColour, rectanglePaints, type Document, type LayerNode, type NodeId } from "./document";
import { withAlpha, type Colour } from "./colour";
import { paintColour, type Paint } from "./solid-paint";
import { textStyleAt } from "./text-ranges";
import type { TextNode } from "./document";

const topVisible = (paints: readonly Paint[]) => [...paints].reverse().find(p => p.visible !== false);

/** Native overlays.rs `caret_fill`: the opaque colour of the solid fill the next typed character gets (the character before the caret,
 * the first one's at 0; its run's fills, else the layer's). Undefined when the topmost visible paint isn't a solid. */
export function caretFill(node: TextNode, caret: number): Colour | undefined {
  const paints = textStyleAt(node.text, Math.max(0, caret - 1)).fills ?? rectanglePaints(node);
  const top = topVisible(paints);
  return top?.type === "solid" ? withAlpha(top.color, 1) : undefined;
}

const luminance = (c: Colour) => {
  const lin = (v: number) => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4;
  return .2126 * lin(c.r) + .7152 * lin(c.g) + .0722 * lin(c.b);
};
/** Native `Color::is_dark`: black on it reads worse than white. */
const isDark = (c: Colour) => {
  const l = luminance(c) + .05;
  return 1.05 / l > l / .05;
};

/** Native overlays.rs `caret_fallback` (#2190, #2163): black, or white over a dark surface. The surface is the nearest layer around the
 * text whose topmost visible fill is a solid at least half opaque as drawn (its colour's alpha times its paint's opacity times its own and
 * its containers' layer opacity), else the page; a layer whose top fill is a gradient or an image is passed over. */
export function caretFallback(document: Document, id: NodeId): "#000000" | "#ffffff" {
  const chain: (LayerNode | Document["nodes"][string])[] = [];
  for (let at = document.nodes[id]?.parent; at != null && chain.length <= 10_000; at = document.nodes[at]?.parent) {
    const node = document.nodes[at];
    if (!node) break;
    chain.push(node);
  }
  const drawn: number[] = [];
  let acc = 1;
  for (let i = chain.length - 1; i >= 0; i--) {
    const node = chain[i], opacity = node.kind === "page" ? 1 : node.opacity ?? 1;
    acc *= Number.isFinite(opacity) ? Math.min(1, Math.max(0, opacity)) : 1;
    drawn[i] = acc;
  }
  let under: Colour | undefined;
  for (const [i, node] of chain.entries()) {
    if (node.kind === "page") { under = pageColour(node); break; }
    const top = topVisible(rectanglePaints(node));
    if (top?.type === "solid" && paintColour(top).a * drawn[i] >= .5) { under = top.color; break; }
  }
  return under && isDark(under) ? "#ffffff" : "#000000";
}
