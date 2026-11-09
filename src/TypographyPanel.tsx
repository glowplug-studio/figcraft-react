import { useState, useSyncExternalStore } from "react";
import type { EditorEngine } from "./engine/editor";
import { familyStyles, fontFamilies } from "./engine/text-node-layout";
import { paragraphList, paragraphSpan, scalarCount, textSpans } from "./engine/text-ranges";
import type { TextStyle } from "./engine/text-style";

const common = <T,>(values: T[]) => values.every(v => v === values[0]) ? values[0] : undefined;
const measure = (v: TextStyle["lineHeight"]) => v.unit === "auto" ? "Auto" : String(v.value) + (v.unit === "percent" ? "%" : "");

function Field({label, value, apply}: {label:string; value?:string; apply:(value:string) => void}) {
  const [draft, setDraft] = useState<string>();
  function commit() {
    if (draft !== undefined && draft !== value && draft.trim()) apply(draft);
    setDraft(undefined);
  }
  return <label>{label}<input aria-label={label} value={draft ?? value ?? ""} placeholder={value === undefined ? "Mixed" : undefined}
    onChange={event => setDraft(event.target.value)} onBlur={commit}
    onKeyDown={event => {
      if (event.nativeEvent.isComposing) return;
      if (event.key === "Enter") { event.preventDefault(); commit(); }
      if (event.key === "Escape") { event.preventDefault(); setDraft(undefined); }
    }} /></label>;
}

export function TypographyPanel({engine, editable, apply, onLeave}: {engine:EditorEngine; editable:boolean;
  apply:(ids:string[], props:Record<string,unknown>) => void; onLeave:() => void}) {
  const live = useSyncExternalStore(engine.subscribeCanvas, engine.getTextRange, engine.getTextRange);
  const {document, selection} = engine.getSnapshot();
  const nodes = live ? [live.node] : selection.flatMap(id => { const n=document.nodes[id]; return n?.kind === "text" ? [n] : []; });
  if (!nodes.length) return null;
  const ids = nodes.map(n => n.id);
  const styles = nodes.flatMap(n => textSpans(n.text).filter(r => !live || live.start === live.end || r.end > live.start && r.start < live.end).map(r => r.style));
  const paragraphs = nodes.flatMap(n => {
    const end = scalarCount(n.text.characters);
    const span = paragraphSpan(n.text, live?.start ?? 0, live?.end ?? end);
    return Array.from({length:span[1]-span[0]+1}, (_,index) => paragraphList(n.text,span[0]+index));
  });
  function field(key:string, label:string, values:(number|string)[]) {
    const value = common(values.map(String));
    return <Field key={ids.join(",") + ":" + key} label={label} value={value} apply={v => apply(ids, {[key]:v})} />;
  }
  function select(key:string, label:string, values:string[], options:string[]) {
    const value = common(values);
    return <label>{label}<select aria-label={label} value={value ?? ""} onChange={e => apply(ids, {[key]:e.target.value})}>
      {value === undefined && <option value="" disabled>Mixed</option>}
      {[...new Set([...options, ...values])].map(name => <option key={name} value={name}>{name}</option>)}
    </select></label>;
  }
  const family = common(styles.map(s => s.fontFamily));
  return <fieldset aria-label="Typography" data-figcraft-typography="" disabled={!editable} onBlur={e => {
    const next = e.relatedTarget;
    if (next instanceof Element && (e.currentTarget.contains(next) ||
      next.matches("textarea") && next.closest("[data-figcraft-editor]") === e.currentTarget.closest("[data-figcraft-editor]"))) return;
    onLeave();
  }}><legend>Typography</legend>
    {select("fontFamily", "Font family", styles.map(s=>s.fontFamily), fontFamilies())}
    {select("fontStyle", "Font style", styles.map(s=>s.fontStyle), family ? familyStyles(family) : [])}
    {field("fontSize", "Font size", styles.map(s=>s.fontSize))}
    {field("lineHeight", "Line height", styles.map(s=>measure(s.lineHeight)))}
    {field("letterSpacing", "Letter spacing", styles.map(s=>measure(s.letterSpacing)))}
    {select("textAlign", "Text alignment", nodes.map(n=>n.text.alignH), ["left","center","right","justified"])}
    {select("textAlignVertical", "Vertical text alignment", nodes.map(n=>n.text.alignV), ["top","middle","bottom"])}
    {select("textAutoResize", "Text resizing", nodes.map(n=>n.text.autoResize), ["widthAndHeight","height","none","truncate"])}
    <details><summary>More typography options</summary>
      {select("textCase", "Letter case", styles.map(s=>s.case), ["original","upper","lower","title","smallCaps"])}
      {select("textDecoration", "Text decoration", styles.map(s=>s.decoration), ["none","underline","strikethrough"])}
      {select("textDecorationStyle", "Decoration style", styles.map(s=>s.decorationLook?.style ?? "solid"), ["solid","dotted","wavy"])}
      {select("listStyle", "List style", paragraphs.map(p=>p.list), ["none","bulleted","numbered"])}
      {field("indentation", "List indentation", paragraphs.map(p=>p.indent))}
      {select("textDirection", "Text direction", paragraphs.map(p=>p.direction), ["auto","ltr","rtl"])}
      {field("paragraphSpacing", "Paragraph spacing", nodes.map(n=>n.text.paragraphSpacing))}
      {field("paragraphIndent", "Paragraph indent", nodes.map(n=>n.text.paragraphIndent))}
      {field("listSpacing", "List spacing", nodes.map(n=>n.text.listSpacing))}
      {select("leadingTrim", "Leading trim", nodes.map(n=>n.text.leadingTrim), ["none","capHeight"])}
      {select("wrapStyle", "Text wrap", nodes.map(n=>n.text.wrapStyle), ["auto","balance","pretty"])}
      {field("maxLines", "Maximum lines", nodes.map(n=>n.text.maxLines))}
    </details>
  </fieldset>;
}
