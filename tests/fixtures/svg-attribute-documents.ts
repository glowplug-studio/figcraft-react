// Rebuilds the SVG documents of native-svg-import-attributes.json from their recipes, as the native observation built
// them (tests/fixtures/native-svg-import-attributes.provenance.md).
export type AttributeRecipe = { kind: "element" | "root" | "entity" | "small" | "text"; count?: number; repeat?: number; svg?: string };
const many = (n: number, quote = '"') => Array.from({ length: n }, (_, i) => " a" + i + "=" + quote + "1" + quote).join("");
const wrap = (body: string) => '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10">' + body + '<rect width="4" height="4" fill="#ff0000"/></svg>';
export function attributeDocument(r: AttributeRecipe): string {
  if (r.kind === "element") return wrap(("<g" + many(r.count!) + "/>").repeat(r.repeat!));
  if (r.kind === "root") return '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"' + many(r.count!) + '><rect width="4" height="4"/></svg>';
  if (r.kind === "entity") return "<!DOCTYPE svg [<!ENTITY e '<g" + many(r.count!, "'") + "/>'>]>" + '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10">&e;<rect width="4" height="4"/></svg>';
  if (r.kind === "small") return wrap("<g a='1' b='2'/>".repeat(r.repeat!));
  return r.svg!;
}
