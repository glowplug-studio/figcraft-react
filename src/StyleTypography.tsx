import { useMemo, useState, useSyncExternalStore } from "react";
import { FontFamilyPicker } from "./FontFamilyPicker";
import { TypographyField, textMeasure } from "./TypographyField";
import { sameComponentValue } from "./engine/component-groups";
import { fieldValue, parseFieldEdit } from "./engine/field-math";
import { fontGeneration, subscribeFonts } from "./engine/font-generation";
import { familyStyles, fontFamilies } from "./engine/text-node-layout";
import { setFontStyle, textItalic, textWeight, wireTextStyle, type TextStyle } from "./engine/text-style";

type Length = TextStyle["lineHeight"];
function readMeasure(raw:string, current:Length, lineHeight:boolean): Length | undefined {
  const s = raw.trim();
  if (lineHeight && (!s || s.toLowerCase() === "auto")) return {unit:"auto"};
  const unit = s.endsWith("%") ? "percent" : s.endsWith("px") ? "pixels" : current.unit === "auto" ? "pixels" : current.unit;
  const n = fieldValue(parseFieldEdit(s.replace(/(%|px)$/,""),true),current.unit === unit ? current.value : undefined);
  return n === undefined ? undefined : {unit,value:lineHeight ? Math.max(0,n) : n};
}

export function StyleTypography({value,change,binding,isBound}:{value:TextStyle;isBound:(key:string)=>boolean;binding:(field:string,label:string)=>import("react").ReactNode;change:(value:ReturnType<typeof wireTextStyle>)=>void}) {
  const version=useSyncExternalStore(subscribeFonts,fontGeneration,fontGeneration);
  const families=useMemo(()=>fontFamilies(),[version]);
  const styles=familyStyles(value.fontFamily);
  const [sample,setSample]=useState<string>();
  const save=(next:TextStyle)=>{ if (!sameComponentValue(value,next)) change(wireTextStyle(next)); };
  return <fieldset><legend>Typography properties</legend>
    <div aria-label="Text style sample" style={{fontFamily:sample ?? value.fontFamily,fontSize:28,
      fontWeight:textWeight(value),fontStyle:textItalic(value) ? "italic" : undefined}}>Ag</div>
    {!isBound("fontFamily") && <FontFamilyPicker current={value.fontFamily} families={families} preview={setSample} endPreview={()=>setSample(undefined)} apply={fontFamily=>{
      if (fontFamily === value.fontFamily) return;
      const offered=familyStyles(fontFamily);
      const next={...value,fontFamily};
      save(offered.length && !offered.includes(value.fontStyle) ? setFontStyle(next,offered.find(n=>n.toLowerCase()==="regular") ?? offered[0]) : next);
    }}/>}
    {binding("fontFamily","Style font family")}
    {!isBound("fontStyle") && <label>Font style<select aria-label="Style font style" value={value.fontStyle}
      onChange={e=>save(setFontStyle(value,e.target.value))}>
      {[...new Set([value.fontStyle,...styles])].map(name=><option key={name}>{name}</option>)}
    </select></label>}
    {binding("fontStyle","Style font style")}
    {!isBound("fontSize") && <TypographyField label="Style font size" value={String(value.fontSize)} apply={s=>{
      const n=fieldValue(parseFieldEdit(s,true),value.fontSize);
      if (n !== undefined) save({...value,fontSize:Math.min(5000,Math.max(1,n))});
    }}/>}
    {binding("fontSize","Style font size")}
    {!isBound("lineHeight") && <TypographyField label="Style line height" value={textMeasure(value.lineHeight)} empty="Auto" apply={s=>{
      const lineHeight=readMeasure(s,value.lineHeight,true);
      if (lineHeight) save({...value,lineHeight});
    }}/>}
    {binding("lineHeight","Style line height")}
    {!isBound("letterSpacing") && <TypographyField label="Style letter spacing" value={textMeasure(value.letterSpacing)} apply={s=>{
      const letterSpacing=readMeasure(s,value.letterSpacing,false);
      if (letterSpacing && letterSpacing.unit !== "auto") save({...value,letterSpacing});
    }}/>}
    {binding("letterSpacing","Style letter spacing")}
  </fieldset>;
}
