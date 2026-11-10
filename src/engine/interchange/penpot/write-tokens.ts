import {toRgba8} from "../../colour";
import {isFrameLike,type LayerNode} from "../../document";
import {compareScalarKeys} from "../../text-breaks";
import {flattenVariable} from "../../variable-export";
import {emptyVariables,ownVariableValue,resolveVariable,variableIndex,type Variable,type Variables} from "../../variables";
import {object} from "../rest/values";
import {variableFingerprint} from "./tokens";
import {numberText,sourceValue,type Fields,type Warn} from "./write-geometry";
import {derivedId,PenpotExportIds} from "./write-pages";

const attributes:Readonly<Record<string,string>>={"fills/0/color":"fill","strokes/0/color":"strokeColor",width:"width",height:"height",
  paddingTop:"p1",paddingRight:"p2",paddingBottom:"p3",paddingLeft:"p4",topLeftRadius:"r1",topRightRadius:"r2",bottomRightRadius:"r3",
  bottomLeftRadius:"r4",strokeWeight:"strokeWidth",fontSize:"fontSize",letterSpacing:"letterSpacing",fontFamily:"fontFamily"};

function valueOrFirst(v:Variable,mode:string) {
  return ownVariableValue(v.values,mode) ?? v.values[Object.keys(v.values).sort(compareScalarKeys)[0]];
}

/** Any mode that omits a calculation also prevents aliases from naming it across sets. */
function unresolvedReferences(data:Variables) {
  const broken=new Set<string>(),readers=new Map<string,string[]>(),index=variableIndex(data);
  for (const v of data.variables) {
    for (const val of Object.values(v.values)) if (val.type==="alias") {
      const list=readers.get(val.value);
      if (list) list.push(v.id);else readers.set(val.value,[v.id]);
    }
    const modes=index.collections.get(v.collection)?.modes;
    if (modes?.some(m=>{
      const val=valueOrFirst(v,m.id);
      return val && !flattenVariable(data,v,m.id,val);
    })) broken.add(v.id);
  }
  for (const id of broken) for (const dependent of readers.get(id) ?? []) broken.add(dependent);
  return broken;
}

function insertToken(root:Fields,name:string,token:Fields) {
  const path=name.split(".");
  let parent=root;
  for (let i=0;i<path.length-1;i++) {
    const key=path[i],child=Object.hasOwn(parent,key) && parent[key];
    if (!child || typeof child!=="object" || Array.isArray(child)) parent[key]=Object.create(null);
    parent=parent[key] as Fields;
  }
  parent[path[path.length-1]]=token;
}

export class PenpotTokenWriter {
  private data:Variables;
  private names=new Map<string,string>();
  constructor(private ids:PenpotExportIds,private warn:Warn) {
    this.data=ids.doc.variables ?? emptyVariables;
    for (const v of this.data.variables) {
      if (this.names.has(v.id)) continue;
      const name=v.id.startsWith("penpot:tokens:") ? v.name.slice(v.name.indexOf("/")+1) :
        v.name.split("/").map(s=>s.trim().replaceAll(" ","-")).filter(Boolean).join(".");
      this.names.set(v.id,name);
    }
  }

  fields(n:LayerNode,shape:Fields) {
    const out=Object.assign(Object.create(null),object(sourceValue(n,"appliedTokens")));
    const vertical=isFrameLike(n) && n.layout?.mode==="vertical";
    for (const [field,id] of Object.entries(n.boundVariables ?? {})) {
      const key=field==="gap" ? vertical ? "rowGap" : "columnGap" : field==="crossGap" ? vertical ? "columnGap" : "rowGap" :
        Object.hasOwn(attributes,field) ? attributes[field] : undefined;
      const name=this.names.get(id);
      if (key && name!==undefined) out[key]=name;
    }
    if (Object.keys(out).length) shape.appliedTokens=out;
  }

  source() {
    const first=this.ids.doc.nodes[this.ids.doc.pages[0]],meta=first?.sourceMetadata;
    const key=meta && Object.keys(meta).sort(compareScalarKeys).find(k=>k.startsWith("penpot.tokens."));
    if (key && meta) {
      const source=meta[key];
      let valid=true;
      try {JSON.parse(source);} catch {valid=false;}
      if (valid) {
        if (meta["penpot.fp.tokens"]!==variableFingerprint(this.data))
          this.warn("Variables edited since the Penpot import are not exported; the file keeps its original Penpot tokens");
        return source;
      }
    }
    if (!this.data.variables.length) return;
    const broken=unresolvedReferences(this.data),root:Fields=Object.create(null),themes:Fields[]=[],order:string[]=[],activeSets:string[]=[],activeThemes:string[]=[];
    const grouped=new Map<string,Variable[]>();
    for (const v of this.data.variables) {
      const list=grouped.get(v.collection);
      if (list) list.push(v);else grouped.set(v.collection,[v]);
    }
    for (const collection of this.data.collections) for (const [index,mode] of collection.modes.entries()) {
      const many=collection.modes.length>1,name=many ? collection.name+"/"+mode.name : collection.name,tokens:Fields=Object.create(null);
      for (const v of grouped.get(collection.id) ?? []) {
        const original=valueOrFirst(v,mode.id);
        if (!original) continue;
        const val=original.type==="alias" && broken.has(original.value) ? resolveVariable(this.data,v.id,{[v.collection]:mode.id}) :
          flattenVariable(this.data,v,mode.id,original);
        if (!val) {this.warn("colour calculations that don't resolve were left out");continue;}
        let value:string,kind:string=val.type;
        switch(val.type) {
          case "alias": {
            const target=this.names.get(val.value);
            if (target===undefined) continue;
            value="{"+target+"}";kind=v.resolvedType;break;
          }
          case "color": {
            const rgba=toRgba8(val.value);
            value="#"+rgba.slice(0,rgba[3]===255 ? 3 : 4).map(v=>v.toString(16).padStart(2,"0")).join("");break;
          }
          case "number": value=numberText(val.value);break;
          case "boolean": case "string": value=String(val.value);break;
        }
        insertToken(tokens,this.names.get(v.id)!,Object.assign(Object.create(null),{$type:kind,$value:value,$description:v.description}));
      }
      root[name]=tokens;order.push(name);
      if (many) {
        themes.push({id:derivedId(this.ids.file+":theme:"+collection.id+":"+mode.id),name:mode.name,group:collection.name,description:"",
          isSource:false,selectedTokenSets:{[name]:"enabled"}});
        if (!index) activeThemes.push(name);
      }
      if (!index) activeSets.push(name);
    }
    root.$themes=themes;
    root.$metadata={tokenSetOrder:order,activeThemes,activeSets};
    return JSON.stringify(root);
  }
}
