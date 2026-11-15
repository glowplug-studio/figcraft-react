import {expect,it} from "vitest";
import {peerColour,peerColourFallback,peerTextColour} from "../../src/engine/sharing/peer-colour";

// Independent fixtures transcribed from the native parse_color / live::color contract.
it("renders exactly six ASCII hexadecimal digits after # as native RGB",()=>{
  for(const [input,display] of [
    ["#000000","#000000"],["#ffffff","#FFFFFF"],["#aB09Ef","#AB09EF"],
    ["#00875F","#00875F"],["#123456","#123456"],["#FEDCBA","#FEDCBA"],
  ])expect(peerColour(input)).toBe(display);
});

it("uses the native accent for malformed, non-ASCII, control and CSS colour strings",()=>{
  const invalid=[
    "","#","#12345","#1234567","#abc","#12345678","123456","##12345",
    "#12345g","#ABCDEG"," #123456","#123456 ","#123456\n","#123456\r",
    "#12\t456","#12\u0000456","\n#123456","#１２３４５６","＃123456","#é12345",
    "#𝟙23456","#12345\uD800","red","transparent","rgb(0, 0, 0)","hsl(0 0% 0%)",
    "var(--peer)","url(https://example.invalid/colour)","inherit","currentColor",
    "#123456; color: red","#123456\u2028",
  ];
  for(const input of invalid){
    expect(peerColour(input),JSON.stringify(input)).toBe("#00875F");
    expect(peerTextColour(input),JSON.stringify(input)).toBe("#fff");
  }
  expect(peerColourFallback).toBe("#00875F");
});

it("uses native text contrast after display fallback without mutating identity strings",()=>{
  const identity={colour:"white"};
  expect(peerColour(identity.colour)).toBe("#00875F");
  expect(peerTextColour(identity.colour)).toBe("#fff");
  expect(identity.colour).toBe("white");
  expect(peerTextColour("#FFFFFF")).toBe("#1e1e1e");
  expect(peerTextColour("#aaaaaa")).toBe("#fff");
  expect(peerTextColour("#ababab")).toBe("#1e1e1e");
  expect(peerTextColour("#000000")).toBe("#fff");
  // Native f32 rounding crosses the threshold for these colours; JS doubles do not.
  expect(peerTextColour("#02F8D1")).toBe("#1e1e1e");
  expect(peerTextColour("#44FE05")).toBe("#1e1e1e");
});
