import { createHash } from "node:crypto";
import { bidiClass } from "../../src/engine/bidi-resolve";
import { expect, it } from "vitest";
import { textBidi, visualGaps, visualOrder } from "../../src/engine/text-bidi";
import type { ParaList } from "../../src/engine/text-data";
import reference from "../fixtures/text-bidi.json" with {type:"json"};

it.each(reference.map((fixture,i)=>({fixture,i})))("resolves native scalar levels, paragraph direction, order and gaps in fixture $i", ({fixture})=>{
  const bidi=textBidi(fixture.text,fixture.paragraphs as Pick<ParaList,"direction">[]);
  const gaps=Array.from(bidi?.levels ?? [],(_,i)=>i%3===1);
  expect(bidi ? [[...bidi.levels],Array.from(bidi.paragraphRtl,Boolean),[...visualOrder(bidi.levels)],
    visualGaps(bidi.levels,gaps,Math.max(0,gaps.length-2))] : null).toEqual(fixture.expected);
});

it("skips ordinary LTR paragraphs, including directions left beyond an old file's final paragraph",()=>{
  expect(textBidi("abc".repeat(100000))).toBeUndefined();
  expect(textBidi("a\nb",[{direction:"auto"},{direction:"auto"},{direction:"rtl"}])).toBeUndefined();
});

it("matches the native Unicode 16 class for every scalar, including unassigned blocks",()=>{
  const classes=new Uint8Array(0x110000-0x800);
  let i=0;
  for (let cp=0;cp<=0x10ffff;cp++) if (cp<0xd800 || cp>0xdfff) classes[i++]=bidiClass(cp);
  expect(createHash("sha256").update(classes).digest("hex")).toBe("1e3f1cd6eec5e9d1133fc5bf85e4701b25e94255813178ea1fa0c7bee298c2f3");
});
