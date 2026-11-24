import { defaultPrototypeBackground, layerTransform, withLayerTransform, withPageColour, withRectanglePaints, type Document, type DocumentNode, type NodeId, type PageNode, type RectangleNode } from "./document";
import { multiply } from "./affine";
import type { PrototypeInteraction } from "./prototype-data";
import { firesOnKey, type KeyMods } from "./prototype-model";
import { anchoredOverlayRect, type Box } from "./prototype-overlays";
import type { PageRect, PrototypePlayer } from "./prototype-player";
import { hotspots } from "./prototype-runtime";
import { solidPaint } from "./solid-paint";
import { boundsOf } from "./viewport";
import { pageForNode, subtreeIds } from "./hierarchy";

/** Source: upstream ui-egui/src/present/{layout,draw,input}.rs: what the presenter shows and what a click or key reaches, without drawing. */
export interface PlacedOverlay { readonly id: NodeId; readonly box: Box; readonly closeOnOutside: boolean }
export interface Screen {
  /** A document whose current page holds the presented frame, then each overlay at its place over its background. */
  readonly doc: Document;
  /** The presented frame on the page (page units). */
  readonly frame: Box;
  readonly overlays: readonly PlacedOverlay[];
  /** What clicks and keys reach: the top overlay, else the frame. */
  readonly root: NodeId;
}
const rectOf = (doc: Document, id: NodeId): Box | undefined => boundsOf(doc, [id]);
const pageRect = (b: Box): PageRect => ({ x0: b.x, y0: b.y, x1: b.x + b.width, y1: b.y + b.height });

/** The presenter's screen: the player's display document reduced to the presented frame and its open overlays, placed as native places them. */
export function presentedScreen(player: PrototypePlayer): Screen | undefined {
  const display = player.display();
  if (!display || !display.nodes[player.current]) return undefined;
  const frame = rectOf(display, player.current);
  const pageId = pageForNode(display, player.current);
  if (!frame || pageId === undefined) return undefined;
  const page = display.nodes[pageId] as PageNode;
  const nodes: Record<NodeId, DocumentNode> = { ...display.nodes };
  const children: NodeId[] = [player.current];
  const placed: PlacedOverlay[] = [];
  let spare = Object.keys(display.nodes).reduce((m, id) => { try { const n = BigInt(id); return n > m ? n : m; } catch { return m; } }, 0n) + 1n;
  for (const o of player.overlays) {
    const node = display.nodes[o.id], own = node && rectOf(display, o.id);
    if (!node || !own || node.kind === "page") continue;
    const anchor = o.anchor && { x: o.anchor.x0, y: o.anchor.y0, width: o.anchor.x1 - o.anchor.x0, height: o.anchor.y1 - o.anchor.y0 };
    const box = anchoredOverlayRect(o.position, o.anchorTo, frame, [own.width, own.height], anchor, o.offset);
    if (o.background) {
      // The overlay's background covers the screen under it.
      const id = String(spare++);
      const bg = { id, kind: "rectangle", name: "Overlay background", parent: pageId, x: frame.x, y: frame.y, width: frame.width, height: frame.height, fill: "transparent" } as RectangleNode;
      nodes[id] = Object.freeze(withRectanglePaints(bg, [solidPaint(o.background)]));
      children.push(id);
    }
    const shifted = withLayerTransform(node as never, multiply([1, 0, 0, 1, box.x - own.x, box.y - own.y], layerTransform(node as never))) as DocumentNode;
    nodes[o.id] = Object.freeze({ ...shifted, parent: pageId } as DocumentNode);
    children.push(o.id);
    placed.push({ id: o.id, box, closeOnOutside: o.closeOnOutside });
  }
  const background = page.prototypeBackground ?? defaultPrototypeBackground;
  nodes[pageId] = Object.freeze(withPageColour({ ...page, children: Object.freeze(children) }, background));
  const doc = Object.freeze({ ...display, currentPage: pageId, nodes: Object.freeze(nodes) });
  return { doc, frame, overlays: placed, root: placed.at(-1)?.id ?? player.current };
}

/** The top-most hotspot of `screen.root` under a page point with an interaction `want` takes, and that interaction's index. */
export function hotspotAt(screen: Screen, p: { x: number; y: number }, want: (it: PrototypeInteraction) => boolean): { node: NodeId; index: number; rect: PageRect } | undefined {
  const hot = hotspots(screen.doc, screen.root);
  for (let i = hot.length - 1; i >= 0; i--) {
    const [node, r] = hot[i];
    if (p.x < r.x0 || p.x > r.x1 || p.y < r.y0 || p.y > r.y1) continue;
    const index = (screen.doc.nodes[node].interactions ?? []).findIndex(want);
    if (index >= 0) { const b = rectOf(screen.doc, node); return { node, index, rect: b ? pageRect(b) : r }; }
  }
  return undefined;
}
/** Native's click outside the top overlay: it closes when it closes on a click outside. */
export function outsideTopOverlay(screen: Screen, p: { x: number; y: number }): PlacedOverlay | undefined {
  const top = screen.overlays.at(-1);
  if (!top) return undefined;
  const b = top.box;
  return p.x < b.x || p.x > b.x + b.width || p.y < b.y || p.y > b.y + b.height ? top : undefined;
}
/** The first key trigger under `screen.root` that fires for `key` with `mods`, in layer order. */
export function keyTarget(screen: Screen, key: string, mods: KeyMods): { node: NodeId; index: number } | undefined {
  for (const id of subtreeIds(screen.doc, screen.root)) {
    const index = (screen.doc.nodes[id].interactions ?? []).findIndex(it => firesOnKey(it.trigger, key, mods));
    if (index >= 0) return { node: id, index };
  }
  return undefined;
}
