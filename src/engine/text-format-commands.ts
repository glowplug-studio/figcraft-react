import { clearTextHeightLimit } from "./child-layout-properties";
import { type Document, type NodeId, type TextNode } from "./document";
import { pixelRound } from "./geometry";
import { HierarchyDraft, subtreeIds } from "./hierarchy";
import { parseBoolean, parseNodeId, parseNumber, parseString, propertyEnum } from "./parameters";
import { validateChangedGeometry } from "./rotation";
import type { TextData } from "./text-data";
import { textPathOffset } from "./text-path-commands";
import { listKey } from "./text-list-edit";
import { fitEditedText } from "./text-node-layout";
import { featureValues, variationValues, styledName, weightName } from "./text-properties";
import { commonParagraphList, editParagraphLists, paragraphSpan, restyleRange, sameTextData, scalarCount, textSpans, textStyleAt } from "./text-ranges";
import { lineHeightPx, setFontStyle, textItalic, textWeight, type TextStyle } from "./text-style";
import { stepFontWeight } from "./text-weight-step";

const titles = {
  pathOptions:"Text path options", removeFromPath:"Remove text from path",
  bold:"Bold", italic:"Italic", underline:"Underline", strikethrough:"Strikethrough", link:"Create link",
  alignLeft:"Align left", alignRight:"Align right", alignCenter:"Align centre", alignJustify:"Justify",
  sizeUp:"Increase font size", sizeDown:"Decrease font size", weightUp:"Increase font weight", weightDown:"Decrease font weight",
  lineHeightUp:"Increase line height", lineHeightDown:"Decrease line height", trackingUp:"Increase letter spacing", trackingDown:"Decrease letter spacing",
  caseOriginal:"Original case", caseUpper:"Uppercase", caseLower:"Lowercase", caseTitle:"Title case", caseSmallCaps:"Small caps",
  case:"Letter case", decoration:"Decoration", bulletList:"Bulleted list", numberList:"Numbered list", listStyle:"List style",
  listIndent:"Indent list", listOutdent:"Outdent list", direction:"Text direction", directionAuto:"Automatic text direction",
  directionLtr:"Left-to-right text", directionRtl:"Right-to-left text", wrapStyle:"Wrap style", maxLines:"Max lines",
  paragraphSpacing:"Paragraph spacing", paragraphIndent:"Paragraph indent", setFeatures:"OpenType features", setVariations:"Variable font axes",
};
type Action = keyof typeof titles;
export type TextFormatCommand = `text.${Action}`;
export const textFormatSpecs = Object.fromEntries(Object.entries(titles).map(([key,label]) => ["text."+key,{label,undo:true}])) as
  Record<TextFormatCommand,{label:string; undo:true}>;
export const isTextFormatCommand = (id:string): id is TextFormatCommand => Object.hasOwn(textFormatSpecs,id);
type Params = Record<string,unknown>;
type Range = {node:TextNode; start:number; end:number};
const parameters: Partial<Record<Action, readonly string[]>> = {
  pathOptions:["start","flip"], link:["url"], case:["case"], decoration:["decoration"], listStyle:["style","list"], wrapStyle:["style"],
  direction:["direction"], paragraphSpacing:["spacing"], paragraphIndent:["indent"], maxLines:["lines"],
  setFeatures:["features","replace"], setVariations:["variations","replace"],
};
const cases = ["original","upper","lower","title","smallCaps"] as const;
type Change = (text:TextData, start:number, end:number) => TextData;
type All = (predicate:(style:TextStyle)=>boolean) => boolean;
function styleChange(edit:(s:TextStyle)=>TextStyle): Change {
  return (t,a,b) => restyleRange(t,a===b ? 0 : a,a===b ? scalarCount(t.characters) : b,s => Object.freeze(edit(s)));
}

function formatChange(action:Action, p:Params, all:All, allListed:(l:"numbered"|"bulleted")=>boolean): Change {
  switch (action) {
    case "pathOptions": {
      const start = textPathOffset(p.start), flip = parseBoolean(p.flip);
      return t => t.path ? {...t,path:Object.freeze({...t.path,start:start ?? t.path.start,flip:flip ?? t.path.flip})} : t;
    }
    case "removeFromPath": return t => {
      if (!t.path) return t;
      const {path, ...rest} = t;
      return {...rest,autoResize:"widthAndHeight"};
    };
    case "bold": {
      const bold = all(s=>textWeight(s)>=700);
      return styleChange(s=>setFontStyle(s,styledName(bold?"Regular":"Bold",textItalic(s))));
    }
    case "italic": {
      const italic = all(textItalic);
      return styleChange(s=>setFontStyle(s,styledName(weightName(textWeight(s)),!italic)));
    }
    case "underline": case "strikethrough": {
      const decoration = all(s=>s.decoration===action) ? "none" : action;
      return styleChange(s=>({...s,decoration}));
    }
    case "link": {
      const link = parseString(p.url);
      if (link === undefined) throw new Error("text.link requires a URL");
      return styleChange(s=>({...s,link,decoration:s.link===undefined && s.decoration==="none" ? "underline" : s.decoration}));
    }
    case "sizeUp": case "sizeDown":
      return styleChange(s=>({...s,fontSize:action==="sizeUp" ? Math.min(5000,s.fontSize+1) : Math.max(1,s.fontSize-1)}));
    case "weightUp": case "weightDown": return styleChange(s=>stepFontWeight(s,action==="weightUp"));
    case "lineHeightUp": case "lineHeightDown":
      return styleChange(s=>({...s,lineHeight:{unit:"pixels",value:Math.max(0,pixelRound(lineHeightPx(s,1.21))+(action==="lineHeightUp"?1:-1))}}));
    case "trackingUp": case "trackingDown":
      return styleChange(s=>({...s,letterSpacing:{unit:"percent", value:(s.letterSpacing.unit==="percent" ? s.letterSpacing.value
        : s.letterSpacing.value/Math.max(1,s.fontSize)*100)+(action==="trackingUp"?1:-1)}}));
    case "case": case "caseOriginal": case "caseUpper": case "caseLower": case "caseTitle": case "caseSmallCaps": {
      const value = action === "case" ? p.case : action.slice(4,5).toLowerCase()+action.slice(5);
      const letterCase = propertyEnum(value,cases);
      return styleChange(s=>({...s,case:letterCase}));
    }
    case "decoration": {
      const decoration = propertyEnum(p.decoration,["none","underline","strikethrough"] as const);
      return styleChange(s=>({...s,decoration}));
    }
    case "bulletList": case "numberList": case "listStyle": {
      const target = action === "bulletList" ? "bulleted" : "numbered";
      const list = action === "listStyle" ? propertyEnum(p.style ?? p.list, ["none","numbered","bulleted"] as const)
        : allListed(target) ? "none" : target;
      return (t,a,b) => editParagraphLists(t,paragraphSpan(t,a,b),item=>({...item,list}));
    }
    case "listIndent": case "listOutdent":
      return (t,a,b) => listKey(t,a,b,"Tab",action==="listOutdent") ?? t;
    case "direction": case "directionAuto": case "directionLtr": case "directionRtl": {
      const direction = propertyEnum(action==="direction" ? p.direction : action.slice(9).toLowerCase(),["auto","ltr","rtl"] as const);
      return (t,a,b) => editParagraphLists(t,paragraphSpan(t,a,b),item=>({...item,direction}));
    }
    case "alignLeft": case "alignRight": case "alignCenter": case "alignJustify": {
      const alignH = {alignLeft:"left",alignRight:"right",alignCenter:"center",alignJustify:"justified"}[action] as TextData["alignH"];
      return t=>({...t,alignH});
    }
    case "paragraphIndent": case "paragraphSpacing": {
      const value = Math.max(0,Math.min(10000,parseNumber(action==="paragraphIndent" ? p.indent : p.spacing)));
      return t=>({...t,[action]:value});
    }
    case "maxLines": {
      const maxLines = Math.trunc(Math.max(0,Math.min(10000,parseNumber(p.lines))));
      return t=>({...t,maxLines,autoResize:maxLines>0 && t.autoResize==="none" ? "truncate" : t.autoResize});
    }
    case "wrapStyle": {
      const wrapStyle = propertyEnum(p.style,["auto","balance","pretty"] as const);
      return t=>({...t,wrapStyle});
    }
    case "setFeatures": {
      const features = featureValues(p.features), apply = tagEdit(p.features,features,parseBoolean(p.replace) === true);
      return t=>({...t,features:apply(t.features)});
    }
    case "setVariations": {
      if (p.variations == null) throw new Error("text.setVariations requires an axis map");
      const axes = variationValues(p.variations), apply = tagEdit(p.variations,axes,parseBoolean(p.replace) === true);
      return styleChange(s=>({...s,variations:apply(s.variations)}));
    }
  }
}

function tagEdit<T>(raw:unknown, patch:Readonly<Record<string,T>>, replace:boolean) {
  const removed = Object.entries(raw as Record<string,unknown>).filter(([,v])=>v===null).map(([k])=>k);
  return (previous:Readonly<Record<string,T>>) => {
    const next = {...(replace ? {} : previous), ...patch};
    for (const key of removed) delete next[key];
    return Object.freeze(Object.fromEntries(Object.keys(next).sort().map(key=>[key,next[key]])));
  };
}

export function executeTextFormat(command:TextFormatCommand, doc:Document, selection:readonly NodeId[], params:Params, range?:Range) {
  const action = command.slice(5) as Action;
  for (const key of Object.keys(params)) if (key!=="id" && key!=="ids" && !parameters[action]?.includes(key)) throw new Error(command+" does not take "+key);
  const indent = action==="listIndent" || action==="listOutdent";
  if (indent && !range) return {document:doc, result:{changed:false}};
  let ids:readonly NodeId[];
  if (range) ids=[range.node.id];
  else {
    if (params.ids!=null && !Array.isArray(params.ids)) throw new Error("ids must be an array");
    const raw = Array.isArray(params.ids) ? params.ids : params.id!=null ? [params.id] : selection;
    if (!raw.length) throw new Error("No text targets selected");
    ids=raw.map(value=>{
      const id=parseNodeId(value);
      if (id===undefined || !doc.nodes[id]) throw new Error("Invalid text command target");
      return id;
    });
  }
  const targets=ids.flatMap(id=>subtreeIds(doc,id)).filter(id=>doc.nodes[id].kind==="text");
  const all:All = predicate => targets.length>0 && targets.every(id=>{
    const {text}=doc.nodes[id] as TextNode;
    if (!range) return textSpans(text).every(r=>predicate(r.style));
    const length = scalarCount(text.characters);
    const start = range.start===range.end ? 0 : range.start, end = range.start===range.end ? length : range.end;
    // The live native editor uses style_at in stored order, even on overlapping runs in older files.
    if (!predicate(textStyleAt(text,start))) return false;
    if (!text.runs.length) return true;
    let last = 0;
    if (text.runs.every(run => {const ordered=run.start>=last; last=run.end; return ordered;}))
      return textSpans(text).every(run=>run.end<=start || run.start>=end || predicate(run.style));
    const boundaries = new Set(text.runs.flatMap(run=>[run.start,run.end]).filter(i=>i>start && i<end));
    return [...boundaries].every(i=>predicate(textStyleAt(text,i)));
  });
  const allListed = (list:"bulleted"|"numbered") => ids.every(id=>{
    const n=doc.nodes[id];
    return n.kind==="text" && commonParagraphList(n.text,range?.start ?? 0,range?.end ?? scalarCount(n.text.characters))?.list===list;
  });
  const change=formatChange(action,params,all,allListed), edits=new Map<NodeId,TextData>();
  for (const id of targets) {
    const text=edits.get(id) ?? (doc.nodes[id] as TextNode).text;
    edits.set(id,Object.freeze(change(text,range?.start ?? 0,range?.end ?? scalarCount(text.characters))));
  }
  const draft=new HierarchyDraft(doc);
  for (const [id,text] of edits) {
    const node=doc.nodes[id] as TextNode;
    const changed = !sameTextData(text,node.text);
    if (changed || action === "maxLines") {
      const fitted = fitEditedText(changed ? {...node,text} : node,node);
      if (changed || fitted.width !== node.width || fitted.height !== node.height || fitted.textSizing !== node.textSizing)
        draft.set(fitted);
    }
  }
  draft.normaliseGroups();
  let document=validateChangedGeometry(draft);
  // Native text.maxLines first settles the paragraph edit, then releases the height limit
  // on each targeted text and normalises the final transaction against its original state.
  if (action === "maxLines" && [...edits.values()].some(t => t.maxLines > 0)) {
    const limits = new HierarchyDraft(document,doc);
    for (const id of targets) {
      const current = document.nodes[id] as TextNode;
      const updated = clearTextHeightLimit(current);
      if (updated === current && current === doc.nodes[id]) continue;
      limits.set(fitEditedText({...updated},current));
    }
    limits.normaliseGroups();
    document = validateChangedGeometry(limits);
  }
  return {document,result:indent ? {changed:document!==doc} : {ok:true}};
}
