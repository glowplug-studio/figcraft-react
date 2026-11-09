import { expect, it } from "vitest";
import { TextGraphemes } from "../../src/engine/text-graphemes";
import reference from "../fixtures/grapheme-steps.json" with { type:"json" };

// Each tuple is the native backward arrow, forward arrow and Backspace
// destination at that scalar index, including one position beyond the text.
it.each(reference)("moves across $text using native graphemes and letter-mark deletion", ({text,steps}) => {
  const map = new TextGraphemes(text);
  expect(map.length).toBe(Array.from(text).length);
  expect(steps.map((_,i)=>[map.step(i,false),map.step(i,true),map.backspace(i)])).toEqual(steps);
  const expected = new Set([0,...steps.map(row=>row[1])]);
  for(let i=0;i<=map.length+1;i++) expect(map.isBoundary(i)).toBe(expected.has(i));
});

it("supports repeated steps through a long ASCII layer and guards invalid positions", () => {
  const map = new TextGraphemes("abcdef".repeat(40_000));
  expect(map.backspace(185_901)).toBe(185_900);
  expect(map.step(185_901,true)).toBe(185_902);
  expect(new TextGraphemes("😀").step(NaN,true)).toBe(0);
});
