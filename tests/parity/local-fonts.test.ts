import { expect,it,vi } from "vitest";
import { readFile } from "node:fs/promises";
import { FontLibrary, type LocalFontName } from "../../src/engine/font-library";
import { TextGraphemes } from "../../src/engine/text-graphemes";
import { LocalFontAccess } from "../../src/engine/local-font-access";
import { readFontFaces } from "../../src/engine/font-source";

function local(id:number,style:string,family="Shop Sans"):LocalFontName {
  return {id,style,family,postscript:family.replaceAll(" ","")+"-"+style};
}
const bytes=await readFile(new URL("../../fonts/inter/Inter-Regular.ttf",import.meta.url));
it("lists offered names without reading them and requests each nearest face once",async ()=>{
  const reads:number[]=[];
  const db=new FontLibrary(f=>reads.push(f.id));
  const entries=[local(0,"Bold"),local(1,"Regular"),local(2,"Light Italic"),local(3,"Regular"," ")];
  expect(db.offerLocal(entries)).toEqual(["Shop Sans"]);
  expect(db.families()).toEqual(["Shop Sans"]);
  expect(db.hasFamily("ShopSans")).toBe(true);
  expect(db.styles("Shop Sans")).toEqual(["Light Italic","Regular","Bold"]);
  expect(reads).toEqual([]);
  expect(db.find("Shop Sans","Regular")).toBeUndefined();
  expect(db.find("Shop Sans","Regular")).toBeUndefined();
  db.find("Shop Sans","Black");expect(reads).toEqual([1,0]);
  const [face]=await readFontFaces(bytes,entries[1]);
  db.finishLocal(1,face);
  expect(db.find("Shop Sans","Regular")).toMatchObject({family:"Shop Sans",style:"Regular"});
  db.finishLocal(0);
  expect(db.styles("shopsans")).toEqual(["Light Italic","Regular"]);
  expect(db.offerLocal([local(4,"Regular")])).toEqual([]);
  expect(db.find("Shop Sans","Regular")).toBe(face);
  expect(reads).toEqual([1,0]);
});
it("drops unreadable families and retains no fallback face for them",()=>{
  const db=new FontLibrary(()=>{});
  db.offerLocal([local(0,"W3"),local(1,"W7")]);
  expect(db.styleWeights("Shop Sans")).toEqual([{name:"W3",weight:300},{name:"W7",weight:700}]);
  db.finishLocal(0);db.finishLocal(1);
  expect(db.families()).toEqual([]);
  expect(db.hasFamily("ShopSans")).toBe(false);
});

it("rotates equally near pending styles in the same order as native when bytes have not arrived",()=>{
  const requests:number[]=[], db=new FontLibrary(f=>requests.push(f.id));
  db.offerLocal(["Medium","Bold","Regular","W3","W7"].map((s,i)=>local(i,s)));
  for (const style of ["Regular","Medium","Bold","SemiBold","Black"]) db.find("Shop Sans",style);
  expect(requests).toEqual([2,0,1,4]);
});

it("offers legacy weight families as styles before reading their files",()=>{
  const db=new FontLibrary(()=>{});
  db.offerLocal([local(0,"Regular","Brand Sans Medium"),local(1,"Italic","Brand Sans Medium")]);
  expect(db.hasFamily("Brand Sans")).toBe(true);
  expect(db.styles("Brand Sans")).toEqual(["Medium","Medium Italic"]);
});

it("uses a collection's matching PostScript face and falls back to face zero for unknown names",async ()=>{
  const bold=await readFile(new URL("../../fonts/inter/Inter-Bold.ttf",import.meta.url));
  const start=20, second=start+Math.ceil(bytes.byteLength/4)*4;
  const collection=Buffer.alloc(second+bold.byteLength);
  collection.write("ttcf"); collection.writeUInt32BE(0x10000,4); collection.writeUInt32BE(2,8);
  collection.writeUInt32BE(start,12); collection.writeUInt32BE(second,16);
  for (const [offset,ttf] of [[start,bytes],[second,bold]] as const) {
    ttf.copy(collection,offset);
    for (let i=0;i<ttf.readUInt16BE(4);i++) {
      const pos=12+i*16+8;
      collection.writeUInt32BE(ttf.readUInt32BE(pos)+offset,offset+pos);
    }
  }
  const name=local(0,"Regular");
  const read=async(ps:string)=>(await readFontFaces(collection,{...name,postscript:ps}))[0];
  expect(await read("Inter-Bold")).toMatchObject({family:"Shop Sans",style:"Regular",postscript:"Inter-Bold",weight:700});
  expect(await read("Unknown")).toMatchObject({postscript:"Inter-Regular",weight:400});
});

it("caps discovery at 20,000 and refuses oversized files before allocating their bytes",async ()=>{
  const read=vi.fn(), blob=vi.fn(async()=>({size:256*1024*1024+1,arrayBuffer:read}));
  const names=Array.from({length:20_001},(_,i)=>({family:"Family "+i,style:"Regular",postscriptName:"",blob}));
  const query=vi.fn(async()=>names), access=new LocalFontAccess();
  const db=new FontLibrary(), first=local(0,"Regular","Family 0");
  vi.stubGlobal("window",{queryLocalFonts:query});
  try {
    await access.ask(db);await access.ask(db);
    expect(query).toHaveBeenCalledTimes(1);
    expect(db.families()).toHaveLength(20_000);
    expect(db.hasFamily("Family 20000")).toBe(false);
    expect(blob).not.toHaveBeenCalled();
    await access.load(db,first);
    expect(blob).toHaveBeenCalledOnce();
    expect(read).not.toHaveBeenCalled();
    expect(db.hasFamily("Family 0")).toBe(false);
  } finally {vi.unstubAllGlobals();}
});

it("does not request the large emoji font for covered Latin text",async ()=>{
  const requests:number[]=[], db=new FontLibrary(f=>requests.push(f.id));
  db.add((await readFontFaces(bytes))[0]);
  db.offerLocal([local(0,"Regular","Apple Color Emoji"),local(1,"Regular","Hiragino Sans")]);
  const shape=(s:string)=>[...db.segments([...s],new TextGraphemes(s),0,[...s].length,"Inter","Regular")];
  shape("Latin");expect(requests).toEqual([]);
  shape("🙂");expect(requests).toEqual([0,1]);
});

it("requests a closer pending fallback style even after the regular face is loaded",async ()=>{
  const requests:number[]=[],db=new FontLibrary(f=>requests.push(f.id));
  const regular=local(0,"Regular","Noto Sans Thai"),bold=local(1,"Bold","Noto Sans Thai");
  db.offerLocal([regular,bold]);
  db.fallbacks("Regular");db.fallbacks("Regular");
  expect(requests).toEqual([0]);
  db.finishLocal(0,(await readFontFaces(bytes,regular))[0]);
  db.fallbacks("Regular");expect(requests).toEqual([0]);
  db.fallbacks("Bold");db.fallbacks("Bold");expect(requests).toEqual([0,1]);
});
