import { compareScalarKeys } from "../../text-breaks";
import { children, clipped, object, string, type JsonObject } from "../rest/values";
import { sketchColour, type SketchNode } from "./geometry";
import { sketchEffects, sketchPaints } from "./style";
import { sketchTypeStyle, type SketchTextContext } from "./text";

interface SharedEntry { name: string; value: JsonObject; record:boolean }
function* sourceStyles(document: JsonObject, local: string, foreign: string, keys: string[]) {
  yield* children(object(document[local]).objects);
  for (const key of keys) for (const value of children(document[foreign])) {
    const entry = object(value);
    if (Object.hasOwn(entry,key)) yield entry[key];
  }
}
function readEntries(sources: Iterable<unknown>, swatches = false) {
  const items = new Map<string,SharedEntry>();
  let count = 0;
  for (const value of sources) {
    if (++count>20000) break;
    const entry = object(value), id = string(entry.do_objectID);
    if (id === undefined || items.has(id) || !Object.hasOwn(entry,"value")) continue;
    if (swatches && !sketchColour(entry.value)) continue;
    items.set(id,{ name:clipped(string(entry.name) ?? "Style"), value:object(entry.value), record:entry.value!==null && typeof entry.value==="object" && !Array.isArray(entry.value) });
  }
  return items;
}
export class SketchShared {
  readonly layer: Map<string,SharedEntry>;
  readonly text: Map<string,SharedEntry>;
  readonly colours: Map<string,SharedEntry>;
  readonly swatches: ReadonlySet<string>;
  readonly #defined = new Set<string>();
  constructor(document: JsonObject) {
    this.layer = readEntries(sourceStyles(document,"layerStyles","foreignLayerStyles",["localSharedStyle"]));
    this.text = readEntries(sourceStyles(document,"layerTextStyles","foreignTextStyles",["localSharedStyle"]));
    this.colours = readEntries(sourceStyles(document,"sharedSwatches","foreignSwatches",["localSwatch","localSharedSwatch"]),true);
    this.swatches = new Set(this.colours.keys());
  }
  definitions(cx: SketchTextContext) {
    const defs: SketchNode[] = [];
    for (const [id,{name,value}] of this.layer) {
      for (const [slot,paints] of [["fill",sketchPaints(cx,value,100,100)],["stroke",sketchPaints(cx,value,100,100,true)]] as const) {
        if (paints.length) defs.push({id:id+":"+slot,name:slot==="fill" ? name : name+" border",styleType:"FILL",node:{fills:paints}});
      }
      const effects = sketchEffects(cx,value);
      if (effects.length) defs.push({id:id+":effect",name,styleType:"EFFECT",node:{effects}});
    }
    for (const [id,{name,value}] of this.text) {
      const t = object(value.textStyle);
      if (!Object.hasOwn(t,"encodedAttributes")) continue;
      const style = sketchTypeStyle(cx,object(t.encodedAttributes));
      delete style.fills;
      defs.push({id,name,styleType:"TEXT",node:{type:"TEXT",characters:"",style}});
    }
    for (const d of defs) this.#defined.add(String(d.id));
    return defs;
  }
  link(layer: JsonObject, node: SketchNode) {
    const id = string(object(layer.style).sharedObjectID);
    if (id === undefined) return;
    const refs: Record<string,string> = {};
    if (layer._class==="text" && this.text.has(id)) refs.text=id;
    else if (this.layer.has(id)) {
      for (const slot of ["fill","stroke","effect"]) if (this.#defined.has(id+":"+slot)) refs[slot]=id+":"+slot;
    }
    if (Object.keys(refs).length) node.styles=refs;
  }
  variables() {
    if (!this.colours.size) return {};
    const collection = "sketch-color-variables", ids = [...this.colours.keys()].sort(compareScalarKeys);
    const variables: SketchNode = Object.create(null);
    for (const id of ids) {
      const swatch = this.colours.get(id)!;
      variables[id]={id,name:swatch.name,resolvedType:"COLOR",variableCollectionId:collection,valuesByMode:{default:sketchColour(swatch.value)}};
    }
    return { variableCollections:{[collection]:{id:collection,name:"Color Variables",modes:[{modeId:"default",name:"Default"}],defaultModeId:"default",variableIds:ids}},variables };
  }
}
