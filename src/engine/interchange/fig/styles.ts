import type {FigAssets} from "./assets";
import {guid,items,obj} from "./fields";
import type {KiwiObject,KiwiValue} from "./kiwi";
import {compareScalarKeys} from "../../text-breaks";

const slots=[
  ["fill","styleIdForFill","inheritFillStyleID"],
  ["stroke","styleIdForStrokeFill","inheritFillStyleIDForStroke"],
  ["effect","styleIdForEffect","inheritEffectStyleID"],
  ["grid","styleIdForGrid","inheritGridStyleID"],
  ["text","styleIdForText","inheritTextStyleID"]
] as const;
function boundPaints(itemsValue:KiwiValue|undefined,assets:FigAssets) {
  return items(itemsValue).some(v=>{const p=obj(v);return assets.alias(p.colorVar) || items(p.stopsVar).some(s=>assets.alias(obj(s).colorVar));});
}

export class FigStyles {
  readonly metadata:Record<string,unknown>=Object.create(null);
  constructor(readonly assets:FigAssets,readonly warn:(s:string)=>void) {}
  resolve(n:KiwiObject,type:KiwiValue|undefined) {
    const refs:Record<string,string>=Object.create(null), values:Record<string,KiwiObject|undefined>=Object.create(null);
    for (const [slot,key,legacy] of slots) {
      if (slot==="text" && type!=="TEXT") continue;
      const link=obj(n[key]), marker=guid(link.guid), fallback=guid(n[legacy]);
      const id=this.assets.resource(link) ?? (!marker && fallback!=="4294967295:4294967295" ? fallback : undefined);
      const record=id && this.assets.records.get(id);
      if (id && record && typeof record.styleType==="string") {
        refs[slot]=id;values[slot]=record;
        this.metadata[id]??={name:record.name ?? "Style",description:record.styleDescription ?? record.description ?? ""};
      } else if (link.assetRef || marker && marker!=="4294967295:4294967295" || fallback && fallback!=="4294967295:4294967295") {
        this.warn("links to shared styles that aren't in the file kept the layers' own values");
      }
    }
    return {
      refs,fill:values.fill && !boundPaints(n.fillPaints,this.assets) ? values.fill.fillPaints : n.fillPaints,
      stroke:values.stroke && !boundPaints(n.strokePaints,this.assets) ? values.stroke.fillPaints : n.strokePaints,
      effects:values.effect ? values.effect.effects : n.effects,grids:values.grid ? values.grid.layoutGrids : n.layoutGrids,
      text:values.text?.styleType==="TEXT" ? values.text : undefined
    };
  }
  async definitions(map:(id:string)=>Promise<Record<string,unknown>|undefined>) {
    const found=[...this.assets.records].filter(([,n])=>!n.isSoftDeleted && !n.isSoftDeletedStyle &&
      typeof n.styleType==="string" && ["FILL","TEXT","EFFECT","GRID"].includes(n.styleType));
    const pos=(n:KiwiObject)=>typeof n.sortPosition==="string" ? n.sortPosition : "";
    const result=[];
    for (const [id,n] of found.sort(([a,x],[b,y])=>compareScalarKeys(pos(x),pos(y)) || compareScalarKeys(a,b))) {
      const node=await map(id);
      if (node) result.push({id,name:n.name ?? "Style",description:n.styleDescription ?? n.description ?? "",styleType:n.styleType,node});
    }
    return result;
  }
}
