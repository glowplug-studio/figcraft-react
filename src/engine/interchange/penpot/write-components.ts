import type {LayerNode} from "../../document";
import {ancestors} from "../../hierarchy";
import {componentOverrides} from "../../component-properties";
import {compareScalarKeys} from "../../text-breaks";
import {children,object} from "../rest/values";
import {PenpotExportIds} from "./write-pages";
import {sourceValue,type Fields,type Warn} from "./write-geometry";

const touchedGroups:Readonly<Record<string,string>>={fills:"fill-group",strokes:"stroke-group",strokeWeight:"stroke-group",stroke:"stroke-group",
  characters:"content-group",text:"content-group",textStyle:"content-group",visible:"visibility-group",name:"name-group",effects:"shadow-group",
  opacity:"layer-group",blend:"layer-group",cornerRadius:"radius-group",corners:"radius-group",width:"geometry-group",height:"geometry-group",size:"geometry-group",transform:"geometry-group"};

export class PenpotComponentWriter {
  readonly records=new Map<string,Fields>();
  private masters:Set<string>;
  private layers:Set<string>;
  constructor(private ids:PenpotExportIds,private warn:Warn) {
    this.masters=new Set(ids.components.values());this.layers=new Set(ids.layers.values());
  }
  fields(n:LayerNode,pageId:string,fields:Fields) {
    const {ids}=this,doc=ids.doc,meta=n.sourceMetadata;
    const parents=ancestors(doc,n.id),insideInstance=parents.some(p=>doc.nodes[p].kind==="instance");
    const parent=doc.nodes[n.parent],pid=ids.layers.get(n.id)!;
    if (n.kind==="component") {
      const cid=ids.components.get(n.id)!;
      Object.assign(fields,{componentId:cid,componentFile:ids.file,componentRoot:true,mainInstance:true});
      const source=object(sourceValue(n,"component"));
      const component:Fields={id:cid,name:Object.hasOwn(source,"name") ? source.name : n.name,path:Object.hasOwn(source,"path") ? source.path : "",
        mainInstanceId:pid,mainInstancePage:pageId};
      const set=parent?.kind==="componentSet" && ids.layers.get(parent.id);
      if (set) {
        const props=n.name.split(",").flatMap(pair=>{
          const eq=pair.indexOf("=");
          const name=eq>=0 ? pair.slice(0,eq).trim() : "";
          return name ? [{name,value:pair.slice(eq+1).trim()}] : [];
        });
        if (!Object.hasOwn(source,"name")) component.name=parent.name;
        component.variantId=set;component.variantProperties=props;
        fields.variantId=set;fields.variantName=props.map(p=>p.value).join(", ");
        if (meta?.["penpot.originalName"]!==undefined) fields.name=meta["penpot.originalName"];
      }
      this.records.set(cid,component);
    } else if (n.kind==="instance") {
      const cid=ids.components.get(n.component);
      if (!cid) {this.warn("Instance '"+n.name+"' points at a component that is not exported; it was exported as a plain board");return;}
      Object.assign(fields,{componentId:cid,componentFile:ids.file});
      if (!insideInstance && !parents.some(id=>doc.nodes[id].kind==="component")) fields.componentRoot=true;
      const ref=ids.layers.get(n.source ?? n.component);
      if (ref) fields.shapeRef=ref;
    } else if (insideInstance) {
      const ref=n.source && ids.layers.get(n.source);
      if (ref) fields.shapeRef=ref;
    } else if (meta) {
      const cid=meta["penpot.componentId"],ref=meta["penpot.shapeRef"];
      if (this.masters.has(cid)) {
        fields.componentId=cid;fields.componentFile=ids.file;
        const root=sourceValue(n,"componentRoot");
        if (root!==undefined) fields.componentRoot=root;
        else if (Object.hasOwn(meta,"penpot.componentLinkStatus")) fields.componentRoot=true;
      } else if (cid!==undefined) this.warn("Some component copies point at components that are not in the exported file; they were exported as plain layers");
      if (this.layers.has(ref)) {
        fields.shapeRef=ref;
        const touched=sourceValue(n,"touched");
        if (touched!==undefined) fields.touched=touched;
      }
    }
    if (insideInstance || n.kind==="instance") {
      const touched=new Set(children(sourceValue(n,"touched")).filter((v):v is string=>typeof v==="string"));
      for (const group of componentOverrides(n)) if (Object.hasOwn(touchedGroups,group)) touched.add(touchedGroups[group]);
      if (touched.size) fields.touched=[...touched].sort(compareScalarKeys);
    }
  }
}
