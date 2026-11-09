import { type Document, type InstanceNode, type LayerNode, type NodeId, isLeaf } from "./document";
import { componentOverrides, type ComponentProperties, type InstanceValue } from "./component-properties";
import { propertyNodeId } from "./component-tree";
import { wireId } from "./native-values";
import { normaliseTextLines } from "./text-data";
import { autoSizeText } from "./text-node-layout";
import { replaceTextRange, scalarCount } from "./text-ranges";

type Values = InstanceNode["props"];

export function defaultInstanceValues(definitions: ComponentProperties): Values {
  const entries: [string, InstanceValue][] = [];
  for (const [key, prop] of Object.entries(definitions)) {
    if (prop.type !== "slot") entries.push([key, prop.type === "instanceSwap" ? wireId(prop.default) : prop.default]);
  }
  return Object.freeze(Object.fromEntries(entries));
}

function applyBinding(document: Document, layer: LayerNode, field: string, value: InstanceValue): LayerNode {
  if (field === "visible" && typeof value === "boolean") {
    const {visible, ...rest} = layer;
    return value ? rest : {...rest, visible:false};
  }
  if (field === "characters" && layer.kind === "text" && typeof value === "string") {
    const normal = normaliseTextLines(value);
    if (layer.text.characters === normal) return layer;
    return autoSizeText({...layer, text:replaceTextRange(layer.text, 0, scalarCount(layer.text.characters), normal)});
  }
  if (field === "mainComponent" && layer.kind === "instance") {
    const component = propertyNodeId(value);
    if (component && document.nodes[component]?.kind === "component") return {...layer, component};
  }
  return layer;
}

export function boundCopy(document: Document, original: LayerNode, id: NodeId, values: readonly Values[]): LayerNode {
  const {overrides, propRefs, ...rest} = original;
  let copy: LayerNode = {...rest, id, source:original.id};
  if (copy.kind === "text" && copy.charactersOverridden) {
    const {charactersOverridden, ...text} = copy;
    copy = text;
  }
  if (!isLeaf(copy)) copy = {...copy, children:Object.freeze([])};
  const chain = [original];
  let source = original.source;
  while (chain.length < values.length && source) {
    const layer = document.nodes[source];
    if (!layer || layer.kind === "page") break;
    chain.push(layer);
    source = layer.source;
  }
  for (let i = chain.length - 1; i >= 0; i--) {
    for (const [field, key] of Object.entries(chain[i].propRefs ?? {})) {
      const group = field === "mainComponent" ? "component" : field;
      if (i > 0 && componentOverrides(original).includes(group)) continue;
      if (Object.hasOwn(values[i], key)) copy = applyBinding(document, copy, field, values[i][key]);
    }
  }
  return copy;
}
