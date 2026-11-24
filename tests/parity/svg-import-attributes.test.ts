import { expect, it } from "vitest";
import fixture from "../fixtures/native-svg-import-attributes.json";
import { attributeDocument, type AttributeRecipe } from "../fixtures/svg-attribute-documents";
import { checkSvgNesting } from "../../src/engine/svg-import/xml";

// Before parsing, an SVG with an element of more than 4,096 attributes, or more attribute work over the whole file than
// 2^28 (a DTD counting as one element), is refused. Observed through the native engine at bad07e44 (upstream 4d3fe2aa,
// 70ed6c16; tests/fixtures/native-svg-import-attributes.provenance.md). The import itself runs in the browser case.

it.each(fixture.cases.map(c => [c.name, c] as const))("%s", (_name, c) => {
  const svg = attributeDocument(c.recipe as AttributeRecipe);
  expect(new TextEncoder().encode(svg).length, "the document native imported").toBe(c.bytes);
  if ("error" in c) expect(() => checkSvgNesting(svg)).toThrow(c.error);
  else expect(() => checkSvgNesting(svg)).not.toThrow();
});

it("refuses width before depth, as native checks them", () => {
  const deep = "<g>".repeat(600) + "</g>".repeat(600);
  expect(() => checkSvgNesting('<svg xmlns="http://www.w3.org/2000/svg">' + deep + "</svg>")).toThrow(/nested more than 512/);
  expect(() => checkSvgNesting('<svg xmlns="http://www.w3.org/2000/svg">' + deep + "<g" + Array.from({ length: 4097 }, (_, i) => ` a${i}="1"`).join("") + "/></svg>")).toThrow(/more than 4096 attributes/);
});
