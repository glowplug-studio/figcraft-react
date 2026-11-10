import {identity} from "../../affine";
import {colour} from "../../colour";
import {isFrameLike,rectanglePaints,type Document,type DocumentNode} from "../../document";
import {solidPaint,type Paint} from "../../solid-paint";
import {newTextData} from "../../text-data";
import {compareScalarKeys} from "../../text-breaks";
import {flattenVariable} from "../../variable-export";
import {emptyVariables,ownVariableValue,variableIndex,type VariableType} from "../../variables";
import {figGuid as guid,figPosition,guide} from "./export-layout";
import {wireEffect,wireMatrix,type FigPaintWriter} from "./export-paint";
import {figExportSchema} from "./export-schema";
import {wireText} from "./export-text";
import {items,obj} from "./fields";
import type {KiwiObject} from "./kiwi";

const resolved=(type:VariableType)=>type==="number" ? "FLOAT" : type.toUpperCase();
const scopes=new Set(figExportSchema.find(d=>d.name==="VariableScope")!.fields.map(f=>f.name));
const slots={fill:"styleIdForFill",stroke:"styleIdForStrokeFill",text:"styleIdForText",grid:"styleIdForGrid",effect:"styleIdForEffect"} as const;
const bindingFields:Record<string,[string,string]>={
  width:["WIDTH","size"],height:["HEIGHT","size"],visible:["VISIBLE","visible"],opacity:["OPACITY","opacity"],characters:["TEXT_DATA","textData"],
  gap:["STACK_SPACING","stackSpacing"],crossGap:["STACK_COUNTER_SPACING","stackCounterSpacing"],
  paddingLeft:["STACK_PADDING_LEFT","stackHorizontalPadding"],paddingTop:["STACK_PADDING_TOP","stackVerticalPadding"],
  paddingRight:["STACK_PADDING_RIGHT","stackPaddingRight"],paddingBottom:["STACK_PADDING_BOTTOM","stackPaddingBottom"],
  cornerRadius:["CORNER_RADIUS","cornerRadius"],topLeftRadius:["RECTANGLE_TOP_LEFT_CORNER_RADIUS","rectangleTopLeftCornerRadius"],
  topRightRadius:["RECTANGLE_TOP_RIGHT_CORNER_RADIUS","rectangleTopRightCornerRadius"],bottomLeftRadius:["RECTANGLE_BOTTOM_LEFT_CORNER_RADIUS","rectangleBottomLeftCornerRadius"],
  bottomRightRadius:["RECTANGLE_BOTTOM_RIGHT_CORNER_RADIUS","rectangleBottomRightCornerRadius"],
  strokeWeight:["STROKE_WEIGHT","strokeWeight"],strokeTopWeight:["BORDER_TOP_WEIGHT","borderTopWeight"],strokeRightWeight:["BORDER_RIGHT_WEIGHT","borderRightWeight"],
  strokeBottomWeight:["BORDER_BOTTOM_WEIGHT","borderBottomWeight"],strokeLeftWeight:["BORDER_LEFT_WEIGHT","borderLeftWeight"],
  minWidth:["MIN_WIDTH","minSize"],minHeight:["MIN_HEIGHT","minSize"],maxWidth:["MAX_WIDTH","maxSize"],maxHeight:["MAX_HEIGHT","maxSize"],
  fontSize:["FONT_SIZE","fontSize"],fontFamily:["FONT_FAMILY","fontName"],fontStyle:["FONT_STYLE","fontName"],letterSpacing:["LETTER_SPACING","letterSpacing"],
  lineHeight:["LINE_HEIGHT","lineHeight"],paragraphSpacing:["PARAGRAPH_SPACING","paragraphSpacing"],paragraphIndent:["PARAGRAPH_INDENT","paragraphIndent"]
};
const aliases:Record<string,string[]>={padding:["paddingLeft","paddingTop","paddingRight","paddingBottom"],paddingHorizontal:["paddingLeft","paddingRight"],
  paddingVertical:["paddingTop","paddingBottom"],cornerRadius:["cornerRadius","topLeftRadius","topRightRadius","bottomLeftRadius","bottomRightRadius"]};
const tags=new Map(figExportSchema.find(d=>d.name==="NodeChange")!.fields.map(f=>[f.name,f.id]));
const perEffect:Record<string,string>={color:"colorVar",radius:"radiusVar",spread:"spreadVar",offsetX:"xVar",offsetY:"yVar",startRadius:"startRadiusVar"};
const perGrid:Record<string,string>={size:"sectionSizeVar",count:"numSectionsVar",offset:"offsetVar",gutter:"gutterSizeVar"};

export class FigAssetWriter {
  readonly #styles=new Map<string,number>();
  readonly #sets=new Map<string,number>();
  readonly #variables=new Map<string,number>();
  readonly #modes=new Map<string,Map<string,number>>();
  readonly data;
  constructor(readonly doc:Document,readonly page:number,readonly paints:FigPaintWriter,allocate:()=>number) {
    this.data=doc.variables ?? emptyVariables;
    let next=page;
    const reserve=(map:Map<string,number>,id:string)=>{if (!map.has(id)) map.set(id,++next);};
    for (const s of doc.styles ?? []) reserve(this.#styles,s.id);
    for (const c of this.data.collections) reserve(this.#sets,c.id);
    for (const v of this.data.variables) if (this.#sets.has(v.collection)) reserve(this.#variables,v.id);
    for (const c of this.data.collections) {
      const modes=this.#modes.get(c.id) ?? new Map<string,number>();
      for (const m of c.modes) if (!modes.has(m.id)) modes.set(m.id,allocate());
      this.#modes.set(c.id,modes);
    }
  }
  #alias(id:string):KiwiObject|undefined {
    const local=this.#variables.get(id),v=variableIndex(this.data).variables.get(id);
    if (local && v) return {value:{alias:{guid:guid(local)}},dataType:"ALIAS",resolvedDataType:resolved(v.resolvedType)};
    this.paints.warn("bindings to variables that aren't in the document were written as their values");
  }
  bindings(out:KiwiObject,bindings:Readonly<Record<string,string>>|undefined,ownFills=false,fills?:readonly Paint[],strokes?:readonly Paint[]) {
    const paintIndex=(source:readonly Paint[]|undefined)=>{
      if (!source?.some(p=>p.type==="pattern")) return;
      let at=0;
      return source.map(p=>p.type==="pattern" ? -1 : at++);
    };
    const fillIndices=paintIndex(fills),strokeIndices=paintIndex(strokes);
    const entries:KiwiObject[]=[];
    for (const key of Object.keys(bindings ?? {}).sort(compareScalarKeys)) {
      const id=bindings![key],paint=/^(fills|strokes)\/(\d+)\/(?:stops\/(\d+)\/)?color$/.exec(key);
      if (paint || ["fill","fills","fills/0","stroke"].includes(key)) {
        const fill=paint ? paint[1]==="fills" : key!=="stroke",index=paint ? Number(paint[2]) : 0;
        const indices=fill ? fillIndices : strokeIndices;
        const alias=this.#alias(id),target=obj(items(fill ? out.fillPaints : out.strokePaints)[indices ? indices[index] : index]);
        if (!alias || fill && ownFills) continue;
        if (!paint?.[3]) {if (target.type==="SOLID") target.colorVar=alias;continue;}
        if (!Array.isArray(target.stops)) continue;
        target.stopsVar??=target.stops.map(s=>({...obj(s)}));
        const stop=items(target.stopsVar)[Number(paint[3])];
        if (stop) obj(stop).colorVar=alias;
        continue;
      }
      const item=/^(effects|layoutGrids)\/(\d+)\/(.+)$/.exec(key);
      if (item) {
        const fields=item[1]==="effects" ? perEffect : perGrid;
        if (Object.hasOwn(fields,item[3])) {
          const alias=this.#alias(id),target=items(out[item[1]])[Number(item[2])];
          if (alias && target) obj(target)[fields[item[3]]]=alias;
          continue;
        }
      }
      const keys=Object.hasOwn(aliases,key) ? aliases[key] : [key];
      for (const k of keys) {
        if (!Object.hasOwn(bindingFields,k)) {this.paints.warn("variables bound to properties the format has no field for were written as their values");continue;}
        const [variableField,field]=bindingFields[k],variableData=this.#alias(id);
        if (variableData) entries.push({nodeField:tags.get(field),variableField,variableData});
      }
    }
    if (entries.length) out.variableConsumptionMap={entries};
  }
  links(out:KiwiObject,node:DocumentNode) {
    const modes:KiwiObject[]=[];
    for (const [c,m] of Object.entries(node.variableModes ?? {})) {
      const set=this.#sets.get(c),mode=this.#modes.get(c)?.get(m);
      if (set && mode) modes.push({variableSetID:{guid:guid(set)},variableModeID:guid(mode,2)});
      else this.paints.warn("variable modes of collections that aren't in the document were left out");
    }
    if (modes.length) out.variableModeBySetMap={entries:modes};
    if (node.kind==="page") return;
    this.bindings(out,node.boundVariables,node.kind==="text" && !!node.text.style.fills,rectanglePaints(node),node.strokes);
    for (const slot of Object.keys(slots) as (keyof typeof slots)[]) {
      const ref=node.styles?.[slot];
      if (ref==null) continue;
      const local=this.#styles.get(ref);
      if (local && (slot!=="text" || node.kind==="text") && (slot!=="grid" || isFrameLike(node))) out[slots[slot]]={guid:guid(local)};
      else this.paints.warn("links to shared styles that aren't in the document were left out (their layers keep the values)");
    }
  }
  styleList(slot:"effect"|"grid",id:string) {
    const st=this.doc.styles?.find(s=>s.id===id);
    if (st?.type!==slot) return;
    const sample:KiwiObject=st.type==="effect" ? {effects:st.effects.map(e=>wireEffect(e,this.paints.warn))} : {layoutGrids:st.grids.map(guide)};
    this.bindings(sample,st.bound);
    return sample[slot==="effect" ? "effects" : "layoutGrids"];
  }
  async append(changes:KiwiObject[],root:KiwiObject) {
    if (!this.#styles.size && !this.#sets.size) return;
    const page=guid(this.page);
    changes.push({...root,guid:page,type:"CANVAS",phase:"CREATED",name:"Internal Only Canvas",visible:false,internalOnly:true,
      parentIndex:{guid:guid(0,0),position:figPosition(this.doc.pages.length)}});
    let index=0;
    const head=(type:string,name:string,local:number):KiwiObject=>{
      const position=figPosition(++index);
      return {guid:guid(local),type,name,phase:"CREATED",sortPosition:position,parentIndex:{guid:page,position}};
    };
    for (const st of this.doc.styles ?? []) {
      const type=st.type==="text" ? "TEXT" : st.type==="grid" ? "FRAME" : "ROUNDED_RECTANGLE";
      const sample:KiwiObject={...head(type,st.name,this.#styles.get(st.id)!),styleType:st.type==="paint" ? "FILL" : st.type.toUpperCase(),
        visible:true,opacity:1,size:{x:100,y:100},transform:wireMatrix(identity),strokeWeight:0,strokeAlign:"INSIDE",strokeJoin:"MITER",
        fillPaints:[],...(st.description && {description:st.description})};
      switch (st.type) {
        case "paint":sample.fillPaints=await this.paints.list(st.paints);break;
        case "grid":sample.layoutGrids=st.grids.map(guide);break;
        case "effect":sample.effects=st.effects.map(e=>wireEffect(e,this.paints.warn));break;
        case "text": {
          const base=newTextData("Ag"),p=st.paragraph,black=[solidPaint(colour(0,0,0,1))];
          const td={...base,style:st.style,paragraphSpacing:p?.paragraph_spacing ?? 0,paragraphIndent:p?.paragraph_indent ?? 0,
            list:p?.list ?? base.list,features:p?.features ?? base.features};
          sample.fillPaints=await this.paints.list(st.style.fills ?? black);
          Object.assign(sample,await wireText(td,black,this.paints));break;
        }
      }
      this.bindings(sample,st.bound,false,st.type==="paint" ? st.paints : st.type==="text" ? st.style.fills : undefined);
      changes.push(sample);
    }
    for (const c of this.data.collections) {
      changes.push({...head("VARIABLE_SET",c.name,this.#sets.get(c.id)!),variableSetModes:c.modes.map((m,i)=>({
        id:guid(this.#modes.get(c.id)!.get(m.id)!,2),name:m.name,sortPosition:figPosition(i)}))});
      if (c.extends!==undefined) this.paints.warn("extended variable collections were written as collections of their own");
    }
    for (const v of this.data.variables) {
      const local=this.#variables.get(v.id),set=this.#sets.get(v.collection),collection=variableIndex(this.data).collections.get(v.collection);
      if (!local || !set || !collection) {this.paints.warn("variables whose collection isn't in the document were left out");continue;}
      const entries:KiwiObject[]=[],resolvedDataType=resolved(v.resolvedType);
      for (const m of collection.modes) {
        const original=ownVariableValue(v.values,m.id);
        if (!original) continue;
        const source=flattenVariable(this.data,v,m.id,original);
        if (!source) {this.paints.warn("colour calculations that don't resolve were left out");continue;}
        let value:KiwiObject;
        switch (source.type) {
          case "boolean":value={boolValue:source.value};break;
          case "string":value={textValue:source.value.replaceAll("\0","")};break;
          case "color":value={colorValue:{...source.value}};break;
          case "number":value={floatValue:source.value};break;
          case "alias": {
            const target=this.#variables.get(source.value);
            if (!target) {this.paints.warn("variable aliases to variables that aren't in the document were left out");continue;}
            value={alias:{guid:guid(target)}};break;
          }
        }
        entries.push({modeID:guid(this.#modes.get(v.collection)!.get(m.id)!,2),variableData:{value,dataType:source.type==="alias" ? "ALIAS" : resolved(source.type),resolvedDataType}});
      }
      const n={...head("VARIABLE",v.name,local),variableSetID:{guid:guid(set)},variableResolvedType:resolvedDataType,variableDataValues:{entries},
        ...(v.description && {description:v.description})} as KiwiObject;
      if (v.scopes) {
        const known=v.scopes.map(s=>s==="STROKE_COLOR" ? "STROKE" : s).filter(s=>scopes.has(s));
        if (known.length<v.scopes.length) this.paints.warn("variable scopes the format has no name for were left out");
        n.variableScopes=known;
      }
      if (v.hiddenFromPublishing || v.codeSyntax || v.extends!==undefined) this.paints.warn("variables' publishing, code syntax and inheritance settings were left out");
      changes.push(n);
    }
  }
}
