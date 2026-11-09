import type { EditorEngine } from "./editor";
import { inspectedId, parseBoolean, parseNodeId, parseNumber, parseString } from "./parameters";
import { cleanInsertedText, textWordRange } from "./text-edit";
import { textKeyMotion, textLineBoundary } from "./text-key-motion";
import { scalarCount, scalarToUtf16 } from "./text-ranges";

const commands={
  begin:["Edit text",false,["caret"]],insert:["Type text",true,["text"]],key:["Text key",true,["key","shift","alt","cmd"]],
  caret:["Set caret",false,["index","extend"]],selectWord:["Select word",false,["index"]],selectLine:["Select line",false,["index"]],
  preedit:["Compose text (IME)",false,["text","cursor"]],selection:["Text selection",false,[]],end:["Stop editing text",false,[]],
} as const;
type Action=keyof typeof commands;
export type TextEditCommand=`text.edit.${Action}`;
export const editTextSpecs=Object.fromEntries(Object.entries(commands).map(([id,[label,undo]])=>["text.edit."+id,{label,undo}])) as
  Record<TextEditCommand,{label:string;undo:boolean}>;
export const isTextEditCommand=(key:string):key is TextEditCommand=>Object.hasOwn(editTextSpecs,key);
export type EditSelection={id:string|number;caret:number;anchor:number;text:string;preedit:{text:string;cursor:number}|null};

function optionalIndex(value:unknown) {
  try {return Math.max(0,Math.trunc(parseNumber(value)));} catch {return undefined;}
}

export function executeTextEdit(engine:EditorEngine,command:TextEditCommand,p:Record<string,unknown>):EditSelection|{ok:true}|null {
  const action=command.slice(10) as Action;
  const allowed:readonly string[]=commands[action][2];
  for (const k of Object.keys(p)) if (k!=="id" && k!=="ids" && !allowed.includes(k)) throw new Error("Unknown "+command+" option: "+k);
  const ok={ok:true} as const;
  let session=engine.currentTextEdit();
  if (action==="begin") {
    const id=parseNodeId(p.id);
    if (!id || engine.getRenderDocument().nodes[id]?.kind!=="text") throw new Error("Expected a text layer");
    session=engine.beginTextEdit({id});
    const n=scalarCount(session.node().text.characters), i=optionalIndex(p.caret);
    session.select(i ?? 0,i ?? n);
    return ok;
  }
  if (action==="end") {session?.finish();return ok;}
  const state=engine.getTextRange();
  if (action==="selection") {
    if (!state) return null;
    const chars=state.node.text.characters;
    return {id:inspectedId(state.node.id),anchor:state.anchor,caret:state.caret,
      text:chars.slice(scalarToUtf16(chars,state.start),scalarToUtf16(chars,state.end)),preedit:session?.composition() ?? null};
  }
  if (action==="caret" || action==="selectWord" || action==="selectLine") {
    const index=Math.max(0,Math.trunc(parseNumber(p.index,"index")));
    if (!session || !state) return ok;
    if (action==="caret") session.select(parseBoolean(p.extend) ? state.anchor : index,index);
    else if (action==="selectWord") session.select(...textWordRange(state.node.text.characters,index));
    else {
      const chars=Array.from(state.node.text.characters), i=Math.min(index,chars.length);
      session.select(textLineBoundary(chars,i,false),textLineBoundary(chars,i,true));
    }
    return ok;
  }
  const value=parseString(p.text) ?? "";
  if (action==="insert" && !cleanInsertedText(value)) return ok;
  if (!session || !state) throw new Error("Not editing text");
  if (action==="preedit") {session.compose(value,optionalIndex(p.cursor));return ok;}
  const {start,end}=state;
  function insert(text:string) {
    const cleaned=cleanInsertedText(text);
    if (!cleaned) return;
    const marker=session!.marker(start,end,cleaned);
    if (marker!==undefined) {session!.select(marker,marker);return;}
    session!.replace(start,end,cleaned);
    const to=start+scalarCount(cleaned);
    session!.select(to,to);
  }
  if (action==="insert") {insert(value);return ok;}
  const key=parseString(p.key)?.replace(/^Arrow/,"");
  if (key===undefined) throw new Error("text.edit.key requires a key");
  const mods={shift:parseBoolean(p.shift)===true,word:parseBoolean(p.alt)===true,line:parseBoolean(p.cmd)===true};
  if (!mods.word && !mods.line && ["Tab","Enter","Backspace","Delete"].includes(key) && session.listKey(key,mods.shift,start,end)) return ok;
  if (key==="Escape") session.finish();
  else if (key==="Tab" || key==="Enter") insert(key==="Tab" ? "\t" : "\n");
  else {
    const result=textKeyMotion(state.node,state,key,mods);
    if (result && "remove" in result) {
      session.replace(...result.remove,"");session.select(result.remove[0],result.remove[0]);
    } else if (result) session.select(result.selection.anchor,result.selection.caret);
  }
  return ok;
}
