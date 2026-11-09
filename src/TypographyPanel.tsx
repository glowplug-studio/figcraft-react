import { LayerVariablePicker, type InspectorDispatch } from "./StyleVariablePicker";
import { useMemo, useSyncExternalStore, type ReactNode, type RefObject } from "react";
import { TypographyField as Field, textMeasure as measure } from "./TypographyField";
import { TypographySettings } from "./TypographySettings";
import { toCssHex } from "./engine/colour";
import { hasRtlText } from "./engine/text-bidi";
import { FontFamilyPicker } from "./FontFamilyPicker";
import { fontGeneration, subscribeFonts } from "./engine/font-generation";
import { canSupplyTextPath } from "./engine/text-path-commands";
import type { EditorEngine } from "./engine/editor";
import { familyStyles, fontFamilies } from "./engine/text-node-layout";
import { paragraphList, paragraphSpan, scalarCount, textSpans } from "./engine/text-ranges";
import type { TextStyle } from "./engine/text-style";

const common = <T,>(values: T[]) => values.every(v => v === values[0]) ? values[0] : undefined;
export function TypographyPanel({engine, editable, apply, onLeave, linkDialog, link, run, bind}: {bind:InspectorDispatch;engine:EditorEngine; linkDialog:RefObject<HTMLDialogElement|null>; link:(ids:string[],url:string)=>void; run:(command:string,params:Record<string,unknown>)=>void; editable:boolean;
  apply:(ids:string[], props:Record<string,unknown>) => void; onLeave:() => void}) {
  const catalogueVersion=useSyncExternalStore(subscribeFonts,fontGeneration,fontGeneration);
  const live = useSyncExternalStore(engine.subscribeCanvas, engine.getTextRange, engine.getTextRange);
  const snapshot=engine.getSnapshot(),selection=snapshot.selection;
  const document=live ? engine.getRenderDocument() : snapshot.document;
  const nodes = live ? [live.node] : selection.flatMap(id => { const n=document.nodes[id]; return n?.kind === "text" ? [n] : []; });
  const hasText=nodes.length>0;
  const families=useMemo(()=>hasText ? fontFamilies() : [],[hasText,catalogueVersion]);
  if (!hasText) return null;
  const ids = nodes.map(n => n.id);
  const styles = nodes.flatMap(n => textSpans(n.text).filter(r => !live || live.start === live.end || r.end > live.start && r.start < live.end).map(r => r.style));
  const paragraphs = nodes.flatMap(n => {
    const end = scalarCount(n.text.characters);
    const span = paragraphSpan(n.text, live?.start ?? 0, live?.end ?? end);
    return Array.from({length:span[1]-span[0]+1}, (_,index) => paragraphList(n.text,span[0]+index));
  });
  function variable(field:string,label:string,type:"number"|"string",control?:ReactNode) {
    if (live && field!=="characters") return control;
    return <LayerVariablePicker doc={document} ids={ids} field={field} label={label} type={type}
      run={(command,params)=>{if (live) onLeave(); return bind(command,params);}}>{control}</LayerVariablePicker>;
  }
  function field(key:string, label:string, values:(number|string)[]) {
    const value = common(values.map(String));
    const control = <Field key={ids.join(",") + ":" + key} label={label} value={value} apply={v => apply(ids, {[key]:v})} />;
    return ["fontSize","lineHeight","letterSpacing"].includes(key) ? variable(key,label,"number",control) : control;
  }
  function select(key:string, label:string, values:string[], options:string[]) {
    const value = common(values);
    return <label>{label}<select aria-label={label} value={value ?? ""} onChange={e => apply(ids, {[key]:e.target.value})}>
      {value === undefined && <option value="" disabled>Mixed</option>}
      {[...new Set([...options, ...values])].map(name => <option key={name} value={name}>{name}</option>)}
    </select></label>;
  }
  const decoration=common(styles.map(s=>s.decoration));
  const underline=decoration==="underline";
  function decorationLength(key:"thickness"|"offset",label:string) {
    const prop=key==="thickness" ? "textDecorationThickness" : "textDecorationOffset";
    const value=common(styles.map(s=>measure(s.decorationLook?.[key] ?? {unit:"auto"})));
    return <Field key={prop} label={label} value={value} empty="Auto" apply={raw=>{
      const numeric=Number(raw.replace(/%$/,""));
      if (raw.toLowerCase()==="auto" || (key==="thickness" && numeric<=0)) {apply(ids,{[prop]:"auto"});return;}
      if (!Number.isFinite(numeric)) return;
      const clamped=Math.max(-1000,Math.min(1000,numeric));
      apply(ids,{[prop]:raw.endsWith("%") ? clamped+"%" : clamped});
    }} />;
  }
  const startAligned=nodes.some(n=>n.text.alignH!=="center" && n.text.alignH!=="justified");
  const truncating=common(nodes.map(n=>n.text.autoResize==="truncate" || n.text.autoResize!=="none" && n.text.maxLines>0));
  const resizing=common(nodes.map(n=>n.text.autoResize));
  const showDirection=nodes.some(n=>hasRtlText(n.text.characters) || n.text.paragraphs.some(p=>p.direction!=="auto"));
  const allOnPath = nodes.every(n=>n.text.path);
  const source = !live && selection.length===2 && nodes.length===1 && selection.map(id=>document.nodes[id]).some(canSupplyTextPath);
  const flipped = allOnPath && nodes.every(n=>n.text.path?.flip);
  const family = common(styles.map(s => s.fontFamily));
  return <fieldset aria-label="Typography" data-figcraft-typography="" disabled={!editable} onBlur={e => {
    const next = e.relatedTarget;
    if (next instanceof Element && (e.currentTarget.contains(next) ||
      (next.matches("textarea") || next.closest("[data-figcraft-style-picker]")) && next.closest("[data-figcraft-editor]") === e.currentTarget.closest("[data-figcraft-editor]"))) return;
    onLeave();
  }}><legend>Typography</legend>
    {variable("characters","Text content","string")}
    {variable("fontFamily","Font family","string",<FontFamilyPicker key={ids.join(",")} current={family} families={families}
      preview={fontFamily=>run("text.preview",{command:"text.style",params:{ids,fontFamily,
        ...(live && live.start!==live.end && {id:live.node.id,start:live.start,end:live.end})}})}
      endPreview={()=>engine.endTextPreview()} apply={fontFamily=>apply(ids,{fontFamily})} />)}
    {variable("fontStyle","Font style","string",select("fontStyle", "Font style", styles.map(s=>s.fontStyle), family ? familyStyles(family) : []))}
    {field("fontSize", "Font size", styles.map(s=>s.fontSize))}
    {field("lineHeight", "Line height", styles.map(s=>measure(s.lineHeight)))}
    {field("letterSpacing", "Letter spacing", styles.map(s=>measure(s.letterSpacing)))}
    {select("textAlign", "Text alignment", nodes.map(n=>n.text.alignH), ["left","center","right","justified"])}
    {select("textAlignVertical", "Vertical text alignment", nodes.map(n=>n.text.alignV), ["top","middle","bottom"])}
    {select("textAutoResize", "Text resizing", nodes.map(n=>n.text.autoResize), ["widthAndHeight","height","none","truncate"])}
    {allOnPath ? <>
      <Field label="Start on path (%)" value={common(nodes.map(n=>String(n.text.path!.start*100)))}
        apply={v=>{ const n=Number(v); if (Number.isFinite(n)) run("text.pathOptions",{ids,start:n/100}); }} />
      <button type="button" aria-pressed={flipped} onClick={()=>run("text.pathOptions",{ids,flip:!flipped})}>Flip text to the other side</button>
      <button type="button" onClick={()=>run("text.removeFromPath",{ids})}>Remove text from path</button>
    </> : source && <button type="button" onClick={()=>run("text.onPath",{ids:selection})}>Put text on path</button>}
    <dialog ref={linkDialog} aria-label="Create link" onClose={e=>e.currentTarget.querySelector("form")?.reset()}>
      <form method="dialog" onSubmit={e=>{
        const url = new FormData(e.currentTarget).get("url");
        if (typeof url !== "string" || !url.trim()) { e.preventDefault(); return; }
        link(ids,url.trim());
      }}>
        <label>URL<input name="url" autoFocus required /></label>
        <button type="submit">Apply link</button><button type="button" onClick={()=>linkDialog.current?.close()}>Cancel</button>
      </form>
    </dialog>
    <TypographySettings key={ids.join(",")} nodes={nodes} styles={styles} run={run} applyStyle={props=>apply(ids,props)}
      end={()=>engine.endTextPreview()} styleParams={props=>({ids,...props,...(live && live.start!==live.end && {id:live.node.id,start:live.start,end:live.end})})}>
      <label>Load font file<input type="file" aria-label="Load font file" accept=".ttf,.otf,.ttc,.otc" onChange={event=>{
        const file=event.currentTarget.files?.[0];
        event.currentTarget.value="";
        if (file) run("text.loadFont",{path:file});
      }} /></label>
      <button type="button" onClick={()=>run("text.missingFonts",{})}>Missing fonts…</button>
      <button type="button" onClick={()=>linkDialog.current?.showModal()}>Create link</button>
      {select("textCase", "Letter case", styles.map(s=>s.case), ["original","upper","lower","title","smallCaps"])}
      {select("textDecoration", "Text decoration", styles.map(s=>s.decoration), ["none","underline","strikethrough"])}
      {(underline || decoration==="strikethrough") && <>
        {select("textDecorationStyle", "Decoration style", styles.map(s=>s.decorationLook?.style ?? "solid"), ["solid","dotted","wavy"])}
        {decorationLength("thickness","Decoration thickness")}
        {underline && <>
          {decorationLength("offset","Underline offset")}
          <label><input type="checkbox" checked={styles.every(s=>s.decorationLook?.skipInk)}
            onChange={e=>apply(ids,{textDecorationSkipInk:e.target.checked})} />Skip ink</label>
        </>}
        <Field label="Decoration colour" value={common(styles.map(s=>s.decorationLook?.color ? toCssHex(s.decorationLook.color) : "Auto"))}
          empty="auto" apply={value=>apply(ids,{textDecorationColor:value})} />
      </>}
      {select("listStyle", "List style", paragraphs.map(p=>p.list), ["none","bulleted","numbered"])}
      {field("indentation", "List indentation", paragraphs.map(p=>p.indent))}
      {showDirection && select("textDirection", "Text direction", paragraphs.map(p=>p.direction), ["auto","ltr","rtl"])}
      {field("paragraphSpacing", "Paragraph spacing", nodes.map(n=>n.text.paragraphSpacing))}
      <fieldset disabled={!startAligned}>{field("paragraphIndent", "Paragraph indent", nodes.map(n=>n.text.paragraphIndent))}</fieldset>
      {(["hangingPunctuation","hangingList"] as const).map(key=><label key={key}><input type="checkbox" checked={nodes.every(n=>n.text[key])}
        onChange={e=>apply(ids,{[key]:e.target.checked})} />{key==="hangingList" ? "Hanging list" : "Hanging punctuation"}</label>)}
      {field("listSpacing", "List spacing", nodes.map(n=>n.text.listSpacing))}
      {select("leadingTrim", "Leading trim", nodes.map(n=>n.text.leadingTrim), ["none","capHeight"])}
      {select("wrapStyle", "Text wrap", nodes.map(n=>n.text.wrapStyle), ["auto","balance","pretty"])}
      <label>Truncate text<select aria-label="Truncate text" value={truncating===undefined ? "" : truncating ? "on" : "off"} onChange={e=>{
        if (e.target.value==="on") apply(ids,{textAutoResize:"truncate"});
        else if (resizing==="height") { if (truncating) apply(ids,{maxLines:0}); }
        else if (resizing!=="widthAndHeight") apply(ids,{textAutoResize:"none"});
      }}>
        {truncating===undefined && <option value="" disabled>Mixed</option>}
        <option value="off">Off</option><option value="on">Truncate with an ellipsis</option>
      </select></label>
      {truncating && <Field label="Maximum lines" value={common(nodes.map(n=>n.text.maxLines ? String(n.text.maxLines) : "Auto"))} empty="Auto"
        apply={raw=>{
          const lines=raw.toLowerCase()==="auto" ? 0 : Math.round(Number(raw));
          if (Number.isFinite(lines)) run("text.maxLines",{ids,lines:Math.max(0,Math.min(10000,lines))});
        }} />}
    </TypographySettings>
  </fieldset>;
}
