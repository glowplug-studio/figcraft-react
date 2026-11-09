import {expect,it} from "vitest";
import {parse,stringify,LosslessNumber} from "lossless-json";
import {newTextData,readTextData,wireTextData} from "../../src/engine/text-data";
import {commonParagraphList,editParagraphLists,paragraphSpan,normaliseRuns,replaceTextRange,restyleRange,scalarCount,scalarToUtf16,textSpans,textStyleAt,utf16ToScalar} from "../../src/engine/text-ranges";
import {defaultTextStyle,readTextStyle,setFontStyle} from "../../src/engine/text-style";

it("preserves native paragraph settings, typed fields and a full-width saved-break hash",()=>{
  const data=readTextData(parse('{"characters":"A😀\\nB","paragraphs":[{"list":"numbered","indent":2,"direction":"rtl","start_offset":4294967295},{}],"path":{"d":"M0,0L90,0","start":1.2,"flip":true},"features":{"liga":false},"max_lines":2,"wrap_style":"pretty","saved_breaks":{"for_text":18446744073709551615,"starts":[2],"width":18.25}}'));
  expect(data.paragraphs).toEqual([{list:"numbered",indent:2,direction:"rtl",startOffset:4294967295},{list:"none",indent:0,direction:"auto",startOffset:0}]);
  expect(readTextData(parse(stringify(wireTextData(data))!))).toEqual(data);
  expect(stringify(wireTextData(data))).toContain('"for_text":18446744073709551615');
  expect(Object.keys(wireTextData(newTextData()))).toEqual(["characters","style"]);
  for(const bad of [{saved_breaks:{for_text:new LosslessNumber("18446744073709551616")}},
    {paragraphs:[{indent:256}]},{runs:[{start:0,end:1}]},{path:{d:3}},{align_h:"middle"},{features:{liga:1}}])
    expect(()=>readTextData(bad)).toThrow();
});

it("indexes Unicode scalars independently of UTF-16 and grapheme length",()=>{
  const s="A😀e\u0301🇬🇧";
  expect(scalarCount(s)).toBe(6);
  expect([0,1,2,3,4,5,6,100].map(i=>scalarToUtf16(s,i))).toEqual([0,1,3,4,5,7,9,9]);
  expect([0,1,2,3,4,5,6,7,8,9].map(i=>utf16ToScalar(s,i))).toEqual([0,1,1,2,3,4,4,5,5,6]);
});

it("normalises native spans and resolves malformed stored overlaps through their first run",()=>{
  const red=readTextStyle({font_size:17}), blue=readTextStyle({font_size:18});
  const t={...newTextData("abcd😀f"),runs:[{start:3,end:9,style:blue},{start:2,end:4,style:red},{start:0,end:2,style:red}]};
  expect(textStyleAt(t,3)).toBe(blue);
  expect(textSpans(t).map(r=>[r.start,r.end,r.style.fontSize])).toEqual([[0,2,17],[2,4,17],[4,6,18]]);
  expect(normaliseRuns(t.runs,t.style,6).map(r=>[r.start,r.end])).toEqual([[0,4],[4,6]]);
  const changed=restyleRange(t,2,5,s=>setFontStyle(s,"Bold"));
  expect(changed.style).toBe(defaultTextStyle);
  expect(changed.runs.map(r=>[r.start,r.end,r.style.fontSize,r.style.fontStyle])).toEqual([
    [0,2,17,"Regular"],[2,3,17,"Bold"],[3,5,18,"Bold"],[5,6,18,"Regular"]]);
  expect(restyleRange(newTextData(""),0,0,s=>setFontStyle(s,"Italic")).style.fontStyle).toBe("Italic");
});

it("extends the style of typed characters and copies the current list on paragraph breaks",()=>{
  const t=readTextData({characters:"A😀\nB\nC",list:"bulleted",
    runs:[{start:0,end:2,style:{font_size:19}},{start:4,end:0xffffffff,style:{font_size:15}}],
    paragraphs:[{list:"numbered",start_offset:2},{list:"none"},{list:"bulleted",indent:1}]});
  const inserted=replaceTextRange(t,2,2,"X\nY");
  expect(inserted.characters).toBe("A😀X\nY\nB\nC");
  expect(inserted.runs.map(r=>[r.start,r.end])).toEqual([[0,5],[7,9]]);
  expect(inserted.paragraphs.map(p=>[p.list,p.startOffset])).toEqual([["numbered",2],["numbered",2],["none",0],["bulleted",0]]);
  const removed=replaceTextRange(inserted,2,7,"");
  expect(removed.characters).toBe("A😀\nC");
  expect(removed.paragraphs.map(p=>p.list)).toEqual(["numbered","bulleted"]);
  expect(t.characters).toBe("A😀\nB\nC");
});

it("restyles a long uniform document without expanding its style to every character",()=>{
  const t=newTextData("x".repeat(200_000));
  let edits=0;
  const r=restyleRange(t,50,190_000,s=>{edits++;return setFontStyle(s,"Bold");});
  expect(edits).toBe(1);
  expect(r.runs.map(v=>[v.start,v.end])).toEqual([[50,190000]]);
});

it("distinguishes a caret at a paragraph start from a selection ending there",()=>{
  const t=newTextData("😀\na\n");
  expect(paragraphSpan(t,0,2)).toEqual([0,0]);
  expect(paragraphSpan(t,2,2)).toEqual([1,1]);
  expect(paragraphSpan(t,3,0)).toEqual([0,1]);
  expect(paragraphSpan(t,4,4)).toEqual([2,2]);
  const numbered=editParagraphLists(t,[0,2],p=>({...p,list:"numbered"}));
  expect(numbered.list).toBe("numbered"); expect(numbered.paragraphs).toEqual([]);
  const nested=editParagraphLists(numbered,[1,1],p=>({...p,indent:12,startOffset:5}));
  expect(nested.paragraphs[1]).toMatchObject({indent:8,startOffset:5});
  expect(commonParagraphList(nested,0,3)).toBeUndefined();
  const unlisted=editParagraphLists(nested,[1,1],p=>({...p,list:"none"}),true);
  expect(unlisted.paragraphs[1]).toMatchObject({indent:8,startOffset:0});
  const collapsed=editParagraphLists(unlisted,[0,2],p=>({...p,list:"none"}));
  expect(collapsed.list).toBe("none"); expect(collapsed.paragraphs).toEqual([]);
});

it("retains exact native pattern IDs and numeric appearance fields inside text runs", () => {
  const native = `{"characters":"a","runs":[{"start":0,"end":1,"style":{
    "fills":[{"type":"solid","color":[0.25,0.5,1,1],"opacity":0.75},
             {"type":"pattern","source":18446744073709551614,"spacing":[2,4]}],
    "decoration_look":{"color":[0.5,0,0,1]}}}],
    "saved_breaks":{"for_text":18446744073709551615}}`;
  const data = readTextData(parse(native));
  expect(data.runs[0].style.fills).toMatchObject([
    {type:"solid",opacity:0.75},
    {type:"pattern",source:"18446744073709551614",spacing:[2,4]},
  ]);
  const encoded = stringify(wireTextData(data))!;
  expect(encoded).toContain('"source":18446744073709551614');
  expect(readTextData(parse(encoded))).toEqual(data);
  expect(() => readTextData(parse(native.replace("18446744073709551614", '"12"')))).toThrow();
  expect(() => readTextData(parse('{"style":42}'))).toThrow();
});
