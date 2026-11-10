import type {KiwiObject,KiwiValue,readKiwiSchema} from "./kiwi";

type Schema=ReturnType<typeof readKiwiSchema>;
type Field=Schema[number]["fields"][number];
const utf8=new TextEncoder();
const limit=256*1024**2;
class Writer {
  data=new Uint8Array(4096);
  position=0;
  reserve(n:number) {
    const end=this.position+n;
    if (end>limit) throw new Error("the document is too large for a .fig file");
    if (end<=this.data.length) return;
    const data=new Uint8Array(Math.max(end,Math.min(limit,this.data.length*2)));
    data.set(this.data.subarray(0,this.position));this.data=data;
  }
  byte(n:number) {this.reserve(1);this.data[this.position++]=n;}
  bytes(b:Uint8Array) {this.reserve(b.length);this.data.set(b,this.position);this.position+=b.length;}
  uint(v:number) {
    while (v>=128) {this.byte((v&127)|128);v=Math.floor(v/128);}
    this.byte(v);
  }
  int(v:number) {this.uint(v>=0 ? 2*v : -2*v-1);}
  string(v:string) {this.bytes(utf8.encode(v.replaceAll("\0","")));this.byte(0);}
  float(v:number) {
    floatBits.setFloat32(0,v,true);
    const raw=floatBits.getUint32(0,true),rotated=(raw>>>23 | raw<<9)>>>0;
    if ((rotated&255)===0) this.byte(0);
    else {this.reserve(4);new DataView(this.data.buffer).setUint32(this.position,rotated,true);this.position+=4;}
  }
  uint64(v:bigint) {
    for (let i=0;i<8;i++) {
      const b=Number(v&127n);v>>=7n;
      if (!v) {this.byte(b);return;}
      this.byte(b|128);
    }
    this.byte(Number(v));
  }
  finish() {return this.data.slice(0,this.position);}
}
const floatBits=new DataView(new ArrayBuffer(4));
export function writeKiwiSchema(schema:Schema) {
  const w=new Writer();
  w.uint(schema.length);
  for (const d of schema) {
    w.string(d.name);w.byte(d.kind);w.uint(d.fields.length);
    for (const f of d.fields) {w.string(f.name);w.int(d.kind===0 ? 0 : f.type);w.byte(Number(f.array));w.uint(f.id);}
  }
  return w.finish();
}
function integer(v:KiwiValue,lo:number,hi:number) {
  const n=typeof v==="boolean" || typeof v==="bigint" ? Number(v) : v;
  if (typeof n!=="number" || !Number.isInteger(n) || n<lo || n>hi) throw new Error("value outside Kiwi integer range");
  return n;
}
export function writeKiwiMessage(schema:Schema,root:KiwiValue) {
  const w=new Writer();
  const byName=schema.map(d=>new Map(d.fields.map(f=>[f.name,f])));
  function value(type:number,v:KiwiValue,depth:number) {
    switch(type) {
      case -1:
        if (typeof v!=="boolean") throw new Error("expected Kiwi boolean");
        w.byte(Number(v));return;
      case -2:w.byte(integer(v,0,255));return;
      case -3:w.int(integer(v,-2147483648,2147483647));return;
      case -4:w.uint(integer(v,0,4294967295));return;
      case -5:{
        const n=typeof v==="bigint" || typeof v==="boolean" ? Number(v) : v;
        if (typeof n!=="number" || Number.isNaN(n) || Number.isFinite(n) && !Number.isFinite(Math.fround(n))) throw new Error("invalid Kiwi float");
        w.float(n);return;
      }
      case -6:
        if (typeof v!=="string") throw new Error("expected Kiwi string");
        w.string(v);return;
      case -7:case -8:{
        if (typeof v!=="bigint" && typeof v!=="boolean" && !(typeof v==="number" && Number.isSafeInteger(v))) throw new Error("invalid Kiwi 64-bit integer");
        const n=BigInt(v as bigint|boolean|number), bits=type===-7 ? (n>=0n ? n*2n : -n*2n-1n) : n;
        if (bits<0n || bits>0xffffffffffffffffn) throw new Error("value outside Kiwi 64-bit integer range");
        w.uint64(bits);return;
      }
      default:definition(type,v,depth+1);
    }
  }
  function field(f:Field,v:KiwiValue,depth:number) {
    if (!f.array) {value(f.type,v,depth);return;}
    if (v instanceof Uint8Array && f.type===-2) {w.uint(v.length);w.bytes(v);return;}
    if (!Array.isArray(v)) throw new Error("expected a list for "+f.name);
    w.uint(v.length);
    for (const item of v) value(f.type,item,depth);
  }
  function definition(id:number,v:KiwiValue,depth:number) {
    if (depth>64) throw new Error("Kiwi message nested too deeply");
    const d=schema[id];
    if (!d) throw new Error("missing Kiwi definition");
    if (d.kind===0) {
      const raw=typeof v==="number" || typeof v==="bigint" ? integer(v,0,4294967295) : typeof v==="string" ? byName[id].get(v)?.id : undefined;
      if (raw===undefined) throw new Error("unknown enum value in "+d.name);
      w.uint(raw);return;
    }
    if (!v || typeof v!=="object" || v instanceof Uint8Array || Array.isArray(v)) throw new Error("expected a "+d.name+" object");
    if (d.kind===1) {
      for (const f of d.fields) {
        const item=(v as KiwiObject)[f.name];
        if (item===undefined || !Object.hasOwn(v,f.name)) throw new Error("missing "+d.name+"."+f.name);
        field(f,item,depth);
      }
    } else {
      for (const [name,item] of Object.entries(v)) {
        if (item===undefined) continue;
        const f=byName[id].get(name);
        if (!f) throw new Error("unknown "+d.name+"."+name);
        w.uint(f.id);field(f,item,depth);
      }
      w.byte(0);
    }
  }
  definition(schema.findIndex(d=>d.name==="Message"),root,0);
  return w.finish();
}
