import { expect, it } from "vitest";
import { parse, stringify } from "lossless-json";
import { newTextData, readTextData, wireTextData } from "../../src/engine/text-data";
import { savedBreaksFor, saveTextBreaks, textLayoutKey } from "../../src/engine/text-breaks";

// Generated once by doc::TextData::layout_key at a4251ca8; no Rust dependency at test time.
const nativeCases = [
  ["{}","13398478078750993855"],
  ["{\"characters\":\"😀 é\\nქართული אב\"}","13080241309463306440"],
  ["{\"style\":{\"font_size\":1e-6,\"variations\":{\"wght\":610.5,\"10\":-0.0,\"2\":1e16,\"𐀀\":1e-5,\"￿\":1e15}},\"features\":{\"2\":false,\"10\":true}}","10718517497758878083"],
  ["{\"characters\":\"abcd😀f\",\"runs\":[{\"start\":3,\"end\":9,\"style\":{\"font_size\":15}},{\"start\":1,\"end\":4,\"style\":{\"font_size\":15}},{\"start\":0,\"end\":1,\"style\":{\"decoration\":\"underline\"}}],\"align_h\":\"center\",\"align_v\":\"bottom\",\"leading_trim\":\"capHeight\",\"auto_resize\":\"truncate\"}","7584215621680633052"],
  ["{\"characters\":\"abc\\ndef\",\"paragraph_indent\":-1.5,\"list\":\"numbered\",\"paragraphs\":[{\"list\":\"numbered\",\"indent\":2,\"start_offset\":17,\"direction\":\"rtl\"}],\"hanging_list\":true,\"hanging_punctuation\":true,\"wrap_style\":\"balance\",\"path\":{\"d\":\"M0,0L10,9\",\"start\":1,\"flip\":true}}","5617428041483751152"],
  ["{\"characters\":\"\\u0001\\u2028\\\\\\\"ä\",\"style\":{\"letter_spacing\":{\"unit\":\"pixels\",\"value\":5e-324},\"line_height\":{\"unit\":\"percent\",\"value\":1.7976931348623157e308}}}","1222352029082454326"],
] as const;

it.each(nativeCases)("matches the native saved layout key for %s", (json, expected) => {
  const text = readTextData(parse(json));
  expect(textLayoutKey(text)).toBe(expected);
  const saved = saveTextBreaks(text,[],12);
  const reopened = readTextData(parse(stringify(wireTextData(saved))!));
  expect(savedBreaksFor(reopened,12)).toEqual([]);
});

it("retains native breaks after appearance and vertical edits, and invalidates changes to wrapping", () => {
  const original = saveTextBreaks(newTextData("AB😀CD"), [2,4], 100);
  const changed = readTextData({characters:original.characters, align_v:"middle", max_lines:1, leading_trim:"capHeight",
    paragraph_spacing:23, list_spacing:12, style:{link:"",decoration:"underline",fills:[],style_id:"id"},
    runs:[{start:0,end:2,style:{link:"a"}}]});
  expect(savedBreaksFor({...changed, savedBreaks:original.savedBreaks},100.00005)).toEqual([2,4]);
  expect(savedBreaksFor(original,100.001)).toBeUndefined();
  for (const edits of [{characters:"AB😀CC"},{alignH:"right" as const},{paragraphIndent:4},{features:{liga:false}}]) {
    expect(savedBreaksFor({...original,...edits},100)).toBeUndefined();
  }
});

it("accepts empty saved lines and requires increasing positive scalar offsets inside the text", () => {
  const text = newTextData("a😀b");
  const starts = [1];
  const saved = saveTextBreaks(text,starts,0);
  starts.push(2);
  expect(savedBreaksFor(saved,0.0000005)).toEqual([1]);
  expect(savedBreaksFor(saved,0.000002)).toBeUndefined();
  expect(savedBreaksFor(text,0)).toBeUndefined();
  expect(savedBreaksFor(saveTextBreaks(newTextData(),[],0),0)).toEqual([]);
  for (const list of [[0],[3],[1,1],[2,1],[1.5]]) {
    expect(savedBreaksFor(saveTextBreaks(text,list,0),0)).toBeUndefined();
  }
});
