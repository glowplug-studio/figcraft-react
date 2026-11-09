// Run with a local copy of the Unicode 16.0.0 UCD directory. Normal builds use the generated tables.
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const root = process.argv[2];
if (!root) throw new Error("Pass the path to the Unicode 16.0.0 UCD directory");
async function pinned(file: string, sha256: string) {
  const bytes = await readFile(join(root,file));
  if (createHash("sha256").update(bytes).digest("hex") !== sha256) throw new Error("Unexpected Unicode data "+file);
  return bytes.toString("utf8");
}
const source = await pinned("extracted/DerivedBidiClass.txt","71ed943a49c58568d8d92e80ecc2ba2f06e62aee9c8ebb0e6e8bd2c3ed8b180e");
const brackets = await pinned("BidiBrackets.txt","b8f32554c6f658821fb0ee742d21c5b1f2086b9bf13071fed04894b022f93d67");
const names = "L R AL EN ES ET AN CS NSM BN B S WS ON LRE LRO RLE RLO PDF LRI RLI FSI PDI".split(" ");
const aliases: Record<string,string> = {Left_To_Right:"L",Right_To_Left:"R",Arabic_Letter:"AL",European_Terminator:"ET"};
const data = new Uint8Array(0x110000);
function ranges(pattern: RegExp) {
  for (const [,first,last,name,category] of source.matchAll(pattern)) {
    if (name==="BN" && category==="Cn") continue; // Native assigns unallocated BN entries their block default.
    const type = names.indexOf(aliases[name] ?? name);
    if (type<0) throw new Error("Unknown bidi class "+name);
    data.fill(type,parseInt(first,16),parseInt(last || first,16)+1);
  }
}
ranges(/^# @missing: ([0-9A-F]+)(?:\.\.([0-9A-F]+))?; (\w+)/gm);
// unicode-bidi 0.3.18 defaults these unassigned blocks to R before applying assigned characters.
for (const [start,end] of [[0x860,0x89f],[0x10d00,0x10d3f],[0x10ec0,0x10eff],
  [0x10f30,0x10f6f],[0x1ec70,0x1ecbf],[0x1ed00,0x1ed4f]]) data.fill(names.indexOf("R"),start,end+1);
ranges(/^([0-9A-F]+)(?:\.\.([0-9A-F]+))?\s*;\s*(\w+)\s*#\s*(\w+)/gm);
const runs = [];
for (let cp=0; cp<data.length; cp++) if (!cp || data[cp]!==data[cp-1]) runs.push(cp*32+data[cp]);
const pairs = [...brackets.matchAll(/^([0-9A-F]+); ([0-9A-F]+); o/gm)].flatMap(m=>m.slice(1).map(n=>parseInt(n,16)));
const rows = (values: number[]) => {
  const lines: string[] = [];
  for (let i=0;i<values.length;i+=16) lines.push("  "+values.slice(i,i+16).join(",")+",");
  return lines.join("\n");
};
await writeFile(new URL("../src/engine/bidi-data.ts",import.meta.url),
  "// Generated from Unicode 16.0.0 by scripts/generate-bidi-data.ts. See NOTICE.\n"+
  "export const enum BidiClass { "+names.join(", ")+" }\n"+
  "// Each entry packs the first scalar and its five-bit Bidi_Class.\n"+
  "export const bidiStarts = new Uint32Array([\n"+rows(runs)+"\n]);\n"+
  "export const bracketPairs = new Uint32Array([\n"+rows(pairs)+"\n]);\n");
