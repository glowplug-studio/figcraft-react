import { convertVariableColours } from "./variables";
import { convertColour, type ColourProfile } from "./colour-spaces";
import { pageColour, rectanglePaints, withPageColour, withRectanglePaints, type Document, type DocumentNode } from "./document";
import type { Colour } from "./colour";
import type { Effect } from "./effects";
import type { LayoutGrid, SharedStyle } from "./shared-styles";
import type { TextStyle } from "./text-style";
import type { Paint } from "./solid-paint";

export function setDocumentProfile(document: Document, target: ColourProfile, convert: boolean): Document {
  const from = document.colourProfile ?? "srgb";
  if (from === target) return document;
  const { colourProfile: previous, ...rest } = document;
  const assigned: Document = Object.freeze({ ...rest, ...(target === "displayP3" && { colourProfile: target }) });
  if (!convert) return assigned;

  const color = (value: Colour) => convertColour(value, from, target);
  const paint = (p: Paint): Paint => {
    if (p.type === "image" || p.type === "pattern") return p;
    if (p.type === "solid") return Object.freeze({ ...p, color: color(p.color) });
    const stops = p.stops.map(stop => Object.freeze({ ...stop, color: color(stop.color) }));
    return Object.freeze({ ...p, stops: Object.freeze(stops) });
  };
  const paints = (values: readonly Paint[]) => Object.freeze(values.map(paint));
  const effect = (value: Effect): Effect => {
    if (value.type === "noise") return Object.freeze({ ...value, color: color(value.color), secondary: color(value.secondary) });
    if (value.type === "dropShadow" || value.type === "innerShadow") return Object.freeze({ ...value, color: color(value.color) });
    return value;
  };
  const grids = (values: readonly LayoutGrid[]) => Object.freeze(values.map(grid => Object.freeze({ ...grid, color: color(grid.color) })));
  const textStyle = (value: TextStyle): TextStyle => {
    const look = value.decorationLook;
    if (!value.fills?.length && !look?.color) return value;
    return Object.freeze({ ...value, ...(value.fills?.length && { fills: paints(value.fills) }),
      ...(look?.color && { decorationLook: Object.freeze({ ...look, color: color(look.color) }) }) });
  };
  const style = (value: SharedStyle): SharedStyle => {
    switch (value.type) {
      case "paint": return Object.freeze({ ...value, paints: paints(value.paints) });
      case "effect": return Object.freeze({ ...value, effects: Object.freeze(value.effects.map(effect)) });
      case "grid": return Object.freeze({ ...value, grids: grids(value.grids) });
      case "text": return Object.freeze({ ...value, style: textStyle(value.style) });
    }
  };
  const nodes: Record<string, DocumentNode> = Object.create(null);
  for (const original of Object.values(document.nodes)) {
    const node = original.grids?.length || original.effects?.length ? Object.freeze({ ...original,
      ...(original.grids?.length && {grids: grids(original.grids)}),
      ...(original.effects?.length && {effects: Object.freeze(original.effects.map(effect))}),
    }) : original;
    if (node.kind === "page") {
      const page = withPageColour({...node, ...(node.fills?.length && {fills:paints(node.fills)}),
        ...(node.strokes?.length && {strokes:paints(node.strokes)})}, convertColour(pageColour(node), from, target));
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
    if (layer.kind === "text") {
      const text = layer.text;
      const runs = Object.freeze(text.runs.map(run => Object.freeze({ ...run, style: textStyle(run.style) })));
      layer = Object.freeze({ ...layer, text: Object.freeze({ ...text, style: textStyle(text.style), runs }) });
    }
    nodes[node.id] = layer;
  }
  const palette = document.documentColours?.map(color);
  const styles = document.styles?.map(style);
  return Object.freeze({ ...assigned, nodes: Object.freeze(nodes), ...(document.variables && {variables:convertVariableColours(document.variables,color)}), ...(styles && { styles: Object.freeze(styles) }), ...(palette && { documentColours: Object.freeze(palette) }) });
}
