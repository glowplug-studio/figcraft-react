import { convertColour, type ColourProfile } from "./colour-spaces";
import { pageColour, rectanglePaints, withPageColour, withRectanglePaints, type Document, type DocumentNode } from "./document";
import type { Paint } from "./solid-paint";

export function setDocumentProfile(document: Document, target: ColourProfile, convert: boolean): Document {
  const from = document.colourProfile ?? "srgb";
  if (from === target) return document;
  const { colourProfile: previous, ...rest } = document;
  const assigned: Document = Object.freeze({ ...rest, ...(target === "displayP3" && { colourProfile: target }) });
  if (!convert) return assigned;

  const paint = (p: Paint): Paint => {
    if (p.type === "image" || p.type === "pattern") return p;
    if (p.type === "solid") return Object.freeze({ ...p, color: convertColour(p.color, from, target) });
    const stops = p.stops.map(stop => Object.freeze({ ...stop, color: convertColour(stop.color, from, target) }));
    return Object.freeze({ ...p, stops: Object.freeze(stops) });
  };
  const nodes: Record<string, DocumentNode> = Object.create(null);
  for (const node of Object.values(document.nodes)) {
    if (node.kind === "page") {
      const page = withPageColour(node, convertColour(pageColour(node), from, target));
      nodes[node.id] = node.prototypeBackground
        ? Object.freeze({ ...page, prototypeBackground: convertColour(node.prototypeBackground, from, target) }) : page;
      continue;
    }
    let layer = withRectanglePaints(node, rectanglePaints(node).map(paint));
    if (layer.strokes?.length) layer = Object.freeze({ ...layer, strokes: Object.freeze(layer.strokes.map(paint)) });
    if (layer.kind === "vector" && layer.network.regions.some(region => region.fills?.length)) {
      const regions = layer.network.regions.map(region => region.fills?.length
        ? Object.freeze({ ...region, fills: Object.freeze(region.fills.map(paint)) }) : region);
      layer = Object.freeze({ ...layer, network: Object.freeze({ ...layer.network, regions: Object.freeze(regions) }) });
    }
    nodes[node.id] = layer;
  }
  const palette = document.documentColours?.map(c => convertColour(c, from, target));
  return Object.freeze({ ...assigned, nodes: Object.freeze(nodes), ...(palette && { documentColours: Object.freeze(palette) }) });
}
