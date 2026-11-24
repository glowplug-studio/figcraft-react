import { fromRgba8, toCssHex, toRgba8, type Colour } from "./colour";
import { trimNumber } from "./inspect-text";
import type { PrototypeExpression } from "./prototype-data";
import { resolveVariable, variableIndex, type Collection, type Mode, type Variable, type VariableType, type VariableValue, type Variables } from "./variables";

/** Source: upstream doc/src/proto_expr.rs and proto_expr_parse.rs. */
export const maxExpressionDepth = 32;
export const maxExpressionText = 4_000;
const maxString = 10_000;
const maxOperandBytes = 1 << 20;
type Op = Extract<PrototypeExpression, {op:unknown}>["op"]["op"];
type Literal = Extract<VariableValue, {type:"number"|"string"|"boolean"|"color"}>;
export type Modes = Readonly<Record<string,string>>;
export class ExpressionError extends Error { constructor(message:string, readonly at:number) { super(message); } }

const symbols:Record<Op,string> = {add:"+",subtract:"-",multiply:"*",divide:"/",equals:"==",notEqual:"!=",less:"<",lessOrEqual:"<=",
  greater:">",greaterOrEqual:">=",and:"and",or:"or",not:"not",negate:"-"};

// Native lookups: a person's name or an id; stored references by exact id only (#1613).
export const variableNamed = (vars:Variables,key:string):Variable|undefined => variableIndex(vars).variables.get(key) ?? vars.variables.find(v=>v.name===key);
export const variableById = (vars:Variables,id:string) => variableIndex(vars).variables.get(id);
export const collectionNamed = (vars:Variables,key:string):Collection|undefined => variableIndex(vars).collections.get(key) ?? vars.collections.find(c=>c.name===key);
export const collectionById = (vars:Variables,id:string) => variableIndex(vars).collections.get(id);
export const modeById = (c:Collection,id:string) => c.modes.find(m=>m.id===id);
export const findMode = (c:Collection,key:string):Mode|undefined => modeById(c,key) ?? c.modes.find(m=>m.name===key);
const currentMode = (c:Collection,modes:Modes) => (Object.hasOwn(modes,c.id) ? c.modes.find(m=>m.id===modes[c.id]) : undefined) ?? c.modes[0];

const value = (v:VariableValue):PrototypeExpression => ({value:v});
const variable = (id:string):PrototypeExpression => value({type:"alias",value:id});
const op = (o:Op,args:PrototypeExpression[]):PrototypeExpression => ({op:{op:o,args}});
const literalType = (v:VariableValue):VariableType|undefined => v.type==="alias" || v.type==="colorAlpha" || v.type==="colorMix" ? undefined : v.type;

/** Rust's `{}` for f64: plain decimals, never an exponent. */
export function rustFloat(n:number):string {
  if (Object.is(n,-0)) return "-0";
  if (!Number.isFinite(n)) return n!==n ? "NaN" : n>0 ? "inf" : "-inf";
  const text=String(n);
  if (!text.includes("e")) return text;
  const [mantissa,e]=text.split("e"), sign=mantissa.startsWith("-") ? "-" : "";
  const digits=mantissa.slice(sign.length).replace(".",""), point=1+Number(e);
  if (point<=0) return sign+"0."+"0".repeat(-point)+digits;
  if (point>=digits.length) return sign+digits+"0".repeat(point-digits.length);
  return sign+digits.slice(0,point)+"."+digits.slice(point);
}
/** Native `Color::from_hex`: 1, 2, 3, 4, 6 or 8 digits. */
function fromHex(hex:string):Colour|undefined {
  const d=[...hex].map(c=>parseInt(c,16));
  const b=(hi:number,lo:number)=>hi*16+lo;
  switch(d.length) {
    case 1:return fromRgba8(b(d[0],d[0]),b(d[0],d[0]),b(d[0],d[0]));
    case 2:return fromRgba8(b(d[0],d[1]),b(d[0],d[1]),b(d[0],d[1]));
    case 3:return fromRgba8(b(d[0],d[0]),b(d[1],d[1]),b(d[2],d[2]));
    case 4:return fromRgba8(b(d[0],d[0]),b(d[1],d[1]),b(d[2],d[2]),b(d[3],d[3]));
    case 6:return fromRgba8(b(d[0],d[1]),b(d[2],d[3]),b(d[4],d[5]));
    case 8:return fromRgba8(b(d[0],d[1]),b(d[2],d[3]),b(d[4],d[5]),b(d[6],d[7]));
    default:return undefined;
  }
}

const isIdent = (c:string|undefined) => c!==undefined && /^[\p{Alphabetic}\p{N}_]$/u.test(c);
const isSpace = (c:string|undefined) => c!==undefined && /^\p{White_Space}$/u.test(c);
const isDigit = (c:string|undefined) => c!==undefined && c>="0" && c<="9";

class Parser {
  i=0;
  constructor(readonly s:string[], readonly names:readonly [string[],string][], readonly vars:Variables) {}
  peek(k=0) { return this.s[this.i+k]; }
  ws() { while (isSpace(this.peek())) this.i++; }
  err(message:string, at=this.i) { return new ExpressionError(message,at); }
  deeper(depth:number) { if (depth>=maxExpressionDepth*8) throw this.err("The expression is nested too deeply"); return depth+1; }
  atKeyword(word:string) {
    const w=[...word];
    return w.every((c,k)=>{ const x=this.peek(k); return x!==undefined && x.toLowerCase()===c.toLowerCase(); }) && !isIdent(this.peek(w.length));
  }
  nextAfter(k:number) { for (let j=this.i+k;j<this.s.length;j++) if (!isSpace(this.s[j])) return this.s[j]; return undefined; }
  atSymbol(sym:string) { return [...sym].every((c,k)=>this.peek(k)===c); }
  eatAny(words:string[], syms:string[]) {
    this.ws();
    const hit=words.find(w=>this.atKeyword(w)) ?? syms.find(s=>this.atSymbol(s));
    if (hit===undefined) return false;
    this.i+=[...hit].length;
    return true;
  }
  variableHere():[string,number]|undefined {
    for (const [name,id] of this.names) {
      const n=name.length;
      const same=name.every((c,k)=>this.peek(k)===c);
      const runsOn=isIdent(name[n-1]) && isIdent(this.peek(n));
      if (same && !runsOn) return [id,n];
    }
    return undefined;
  }
  chain(depth:number, o:Op, words:string[], syms:string[], next:(d:number)=>PrototypeExpression):PrototypeExpression {
    const d=this.deeper(depth);
    const args=[next(d)];
    while (this.eatAny(words,syms)) args.push(next(d));
    return args.length===1 ? args[0] : op(o,args);
  }
  or=(depth:number):PrototypeExpression => this.chain(depth,"or",["or"],["||"],this.and);
  and=(depth:number):PrototypeExpression => this.chain(depth,"and",["and"],["&&"],this.not);
  not=(depth:number):PrototypeExpression => {
    const d=this.deeper(depth);
    this.ws();
    const bang=this.peek()==="!" && this.peek(1)!=="=";
    if (!this.variableHere() && (this.atKeyword("not") || bang)) {
      this.i+=bang ? 1 : 3;
      return op("not",[this.not(d)]);
    }
    return this.compare(d);
  };
  compareOp():Op|undefined {
    this.ws();
    const ops:[string,Op][]=[["==","equals"],["!=","notEqual"],["<=","lessOrEqual"],[">=","greaterOrEqual"],["<","less"],[">","greater"],["=","equals"]];
    const hit=ops.find(([s])=>this.atSymbol(s));
    if (!hit) return undefined;
    this.i+=hit[0].length;
    return hit[1];
  }
  compare(depth:number):PrototypeExpression {
    const d=this.deeper(depth);
    const left=this.sum(d);
    const o=this.compareOp();
    if (!o) return left;
    const args=[left,this.sum(d)];
    for (;;) {
      const at=this.i, next=this.compareOp();
      if (!next) break;
      if (next===o && (o==="equals" || o==="notEqual")) args.push(this.sum(d));
      else { this.i=at; this.ws(); throw this.err("Compare two values at a time: join comparisons with `and` or `or`"); }
    }
    return op(o,args);
  }
  level(depth:number, ops:[string,Op][], next:(d:number)=>PrototypeExpression):PrototypeExpression {
    const d=this.deeper(depth);
    let cur=next(d), curOp:Op|undefined;
    for (;;) {
      this.ws();
      const hit=ops.find(([c])=>this.peek()===c);
      if (!hit) break;
      this.i++;
      const rhs=next(d);
      if ("op" in cur && curOp===hit[1]) cur={op:{op:cur.op.op,args:[...cur.op.args,rhs]}};
      else { cur=op(hit[1],[cur,rhs]); curOp=hit[1]; }
    }
    return cur;
  }
  sum=(depth:number) => this.level(depth,[["+","add"],["-","subtract"]],this.product);
  product=(depth:number) => this.level(depth,[["*","multiply"],["/","divide"]],this.unary);
  unary=(depth:number):PrototypeExpression => {
    const d=this.deeper(depth);
    this.ws();
    if (this.peek()==="-") {
      this.i++;
      this.ws();
      if (isDigit(this.peek()) || this.peek()===".") {
        const n=this.number();
        return "value" in n && n.value.type==="number" ? value({type:"number",value:-n.value.value}) : op("negate",[n]);
      }
      return op("negate",[this.unary(d)]);
    }
    return this.primary(d);
  };
  take(ok:(c:string)=>boolean) { let out=""; while (this.peek()!==undefined && ok(this.peek()!)) { out+=this.peek(); this.i++; } return out; }
  number():PrototypeExpression {
    const start=this.i;
    let text=this.take(c=>isDigit(c) || c===".");
    const expDigit=(k:number)=>isDigit(this.peek(k));
    if ((this.peek()==="e" || this.peek()==="E") && (expDigit(1) || ((this.peek(1)==="+" || this.peek(1)==="-") && expDigit(2)))) {
      text+="e"; this.i++;
      if (this.peek()==="+" || this.peek()==="-") { text+=this.peek(); this.i++; }
      text+=this.take(isDigit);
    }
    // Rust's f64 parser: digits with at most one point, at least one digit.
    const n=/^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/.test(text) ? Number(text) : NaN;
    if (!Number.isFinite(n)) throw this.err("`"+text+"` isn't a number",start);
    return value({type:"number",value:n});
  }
  text(quote:string):string {
    const start=this.i;
    this.i++;
    let out="";
    for (;;) {
      const c=this.peek();
      if (c===undefined) throw this.err("Close the text with "+quote,start);
      if (c===quote) { this.i++; return out; }
      if (c==="\\") {
        const next=this.peek(1);
        if (next===undefined) throw this.err("Close the text with "+quote,start);
        out+=next==="n" ? "\n" : next;
        this.i+=2;
      } else { out+=c; this.i++; }
    }
  }
  primary=(depth:number):PrototypeExpression => {
    const d=this.deeper(depth);
    this.ws();
    const c=this.peek();
    if (c===undefined) throw this.err("Something is missing at the end");
    if (c==="(") {
      this.i++;
      const e=this.or(d);
      this.ws();
      if (this.peek()!==")") throw this.err("Add a closing )");
      this.i++;
      return e;
    }
    if (c==="{") {
      const start=this.i;
      let end=-1;
      for (let k=this.i+1;k<this.s.length;k++) if (this.s[k]==="}") { end=k; break; }
      if (end<0) throw this.err("Add a closing }");
      const name=this.s.slice(start+1,end).join("").trim();
      this.i=end+1;
      const v=variableNamed(this.vars,name);
      if (!v) throw this.err("No variable `"+name+"`",start);
      return this.inMode(v.id);
    }
    if (c==="\"" || c==="'") return value({type:"string",value:this.text(c)});
    if (c==="#") {
      const start=this.i;
      this.i++;
      const hex=this.take(h=>/^[0-9a-fA-F]$/.test(h));
      const col=[3,4,6,8].includes(hex.length) ? fromHex(hex) : undefined;
      if (!col) throw this.err("`#"+hex+"` isn't a colour (use #RRGGBB)",start);
      return value({type:"color",value:col});
    }
    if (isDigit(c) || c===".") return this.number();
    if (c===")") throw this.err("Unexpected )");
    if (this.atKeyword("mode") && this.nextAfter(4)==="(") return this.modeOf();
    const found=this.variableHere();
    for (const [word,v] of [["true",true],["false",false]] as const) {
      if (this.atKeyword(word) && (!found || found[1]<=word.length)) { this.i+=word.length; return value({type:"boolean",value:v}); }
    }
    if (found) { this.i+=found[1]; return this.inMode(found[0]); }
    let word="";
    for (let k=this.i;k<this.s.length && isIdent(this.s[k]);k++) word+=this.s[k];
    throw this.err(word ? "No variable `"+word+"`" : "Unexpected "+c);
  };
  modeOf():PrototypeExpression {
    const start=this.i;
    while (this.peek()!==undefined && this.peek()!=="(") this.i++;
    this.i++;
    const name=this.argument(")","collection");
    const c=collectionNamed(this.vars,name);
    if (!c) throw this.err("No variable collection `"+name+"`",start);
    return {mode:{collection:c.id}};
  }
  inMode(id:string):PrototypeExpression {
    if (this.nextAfter(0)!=="[") return variable(id);
    this.ws();
    this.i++;
    const start=this.i;
    const name=this.argument("]","mode");
    const v=variableById(this.vars,id), coll=v && collectionById(this.vars,v.collection);
    const m=coll && findMode(coll,name);
    if (!m) throw this.err((coll ? coll.name : "The variable's collection")+" has no mode `"+name+"`",start);
    return {inMode:{variable:id,mode:m.id}};
  }
  argument(close:string, what:string):string {
    this.ws();
    const start=this.i, q=this.peek();
    let name:string;
    if (q==="\"" || q==="'") name=this.text(q);
    else {
      const t=this.take(c=>c!==close).trim();
      name=(t.startsWith("{") && t.endsWith("}") && t.length>=2 ? t.slice(1,-1) : t).trim();
    }
    this.ws();
    if (this.peek()!==close) throw this.err("Add a closing "+close);
    this.i++;
    if (!name) throw this.err("Name a "+what+" between the brackets",start);
    return name;
  }
  unexpected() {
    let word="";
    for (let k=this.i;k<this.s.length && isIdent(this.s[k]);k++) word+=this.s[k];
    const c=this.peek();
    if (c===")") return this.err("Unexpected ): there's no ( to close");
    if (word) return this.err("Add an operator before `"+word+"`");
    if (c!==undefined) return this.err("Unexpected "+c);
    return this.err("Something is missing at the end");
  }
}

/** Native `Expr::parse`: an expression typed as text, variables by name (or id). */
export function parseExpression(text:string, vars:Variables):PrototypeExpression {
  const s=Array.from(text);
  if (s.length>maxExpressionText) throw new ExpressionError(`Keep expressions under ${maxExpressionText} characters`,0);
  const names:[string[],string][]=vars.variables.flatMap(v=>[[Array.from(v.name),v.id],[Array.from(v.id),v.id]] as [string[],string][]).filter(([n])=>n.length>0);
  names.sort((a,b)=>b[0].length-a[0].length);
  const p=new Parser(s,names,vars);
  p.ws();
  if (p.peek()===undefined) throw new ExpressionError("Type an expression",0);
  const e=p.or(0);
  p.ws();
  if (p.peek()!==undefined) throw p.unexpected();
  return e;
}

const nouns:Record<VariableType,string> = {number:"a number",string:"text",boolean:"true or false",color:"a colour"};
export const typeNoun = (t:VariableType) => nouns[t];

/** Native `Expr::type_of`: the type an expression gives, or why it gives none (thrown as a message). */
export function expressionType(e:PrototypeExpression, vars:Variables, depth=0):VariableType {
  if (depth>maxExpressionDepth) throw new Error("The expression is nested too deeply");
  if ("value" in e) {
    const v=e.value;
    if (v.type==="alias") { const x=variableById(vars,v.value); if (!x) throw new Error("No variable `"+v.value+"`"); return x.resolvedType; }
    if (v.type==="number" && !Number.isFinite(v.value)) throw new Error("Numbers must be finite");
    const t=literalType(v);
    if (!t) throw new Error("Not a value");
    return t;
  }
  if ("mode" in e) { if (!collectionById(vars,e.mode.collection)) throw new Error("No variable collection `"+e.mode.collection+"`"); return "string"; }
  if ("inMode" in e) {
    const v=variableById(vars,e.inMode.variable);
    if (!v) throw new Error("No variable `"+e.inMode.variable+"`");
    const c=collectionById(vars,v.collection);
    if (!c) throw new Error("No variable collection `"+v.collection+"`");
    if (!modeById(c,e.inMode.mode)) throw new Error(c.name+" has no mode `"+e.inMode.mode+"`");
    return v.resolvedType;
  }
  const o=e.op.op, ts=e.op.args.map(a=>expressionType(a,vars,depth+1)), sym=symbols[o];
  const all=(k:VariableType)=>ts.length>0 && ts.every(t=>t===k);
  switch(o) {
    case "add":case "subtract":case "multiply":case "divide":
      if (o==="add" && ts.includes("string")) { if (ts.includes("color")) throw new Error("Colours can't be joined to text"); return "string"; }
      if (all("number")) return "number";
      throw new Error(o==="add" ? "`+` adds numbers or joins text" : "`"+sym+"` needs numbers");
    case "equals":case "notEqual": {
      if (ts.length<2) throw new Error("`"+sym+"` compares two values");
      const other=ts.slice(1).find(t=>t!==ts[0]);
      if (other) throw new Error("Can't compare "+nouns[ts[0]]+" with "+nouns[other]);
      return "boolean";
    }
    case "less":case "lessOrEqual":case "greater":case "greaterOrEqual":
      if (ts.length===2 && ts[0]===ts[1] && (ts[0]==="number" || ts[0]==="string")) return "boolean";
      throw new Error("`"+sym+"` compares two numbers or two texts");
    case "and":case "or":
      if (all("boolean")) return "boolean";
      throw new Error("`"+sym+"` needs true or false on both sides");
    case "not":
      if (ts.length===1 && ts[0]==="boolean") return "boolean";
      throw new Error("`not` needs true or false");
    case "negate":
      if (ts.length===1 && (ts[0]==="number" || ts[0]==="boolean")) return ts[0];
      throw new Error("`-` needs a number");
  }
}
/** Native `check_condition`. */
export function checkCondition(e:PrototypeExpression, vars:Variables) {
  const t=expressionType(e,vars);
  if (t!=="boolean") throw new Error("A condition must be true or false, not "+nouns[t]);
}
/** Native `check_value`: text variables take numbers and booleans as text. */
export function checkValue(e:PrototypeExpression, vars:Variables, kind:VariableType) {
  const t=expressionType(e,vars);
  if (!(t===kind || kind==="string" && (t==="number" || t==="boolean"))) throw new Error("This gives "+nouns[t]+", but the variable holds "+nouns[kind]);
}

/** Native `VariableValue::display` for joining: numbers trimmed, booleans as words. */
function asText(v:Literal):string|undefined {
  if (v.type==="string") return v.value;
  if (v.type==="number") return trimNumber(v.value);
  if (v.type==="boolean") return String(v.value);
  return undefined;
}
function same(a:Literal,b:Literal) {
  if (a.type==="number" && b.type==="number") return Math.abs(a.value-b.value)<=1e-9*Math.max(Math.abs(a.value),Math.abs(b.value),1);
  if (a.type==="color" && b.type==="color") { const x=toRgba8(a.value), y=toRgba8(b.value); return x.every((c,i)=>c===y[i]); }
  return a.type===b.type && a.value===b.value;
}
const finite=(n:number):Literal|undefined => Number.isFinite(n) ? {type:"number",value:n} : undefined;
const utf8=(s:string)=>new TextEncoder().encode(s).length;
function apply(o:Op, vals:Literal[]):Literal|undefined {
  const nums=()=>vals.every(v=>v.type==="number") ? vals.map(v=>v.value as number) : undefined;
  const bools=()=>vals.every(v=>v.type==="boolean") ? vals.map(v=>v.value as boolean) : undefined;
  const fold=(f:(a:number,b:number)=>number|undefined)=>{
    const n=nums();
    if (!n || !n.length) return undefined;
    let acc:number|undefined=n[0];
    for (const x of n.slice(1)) { acc=f(acc!,x); if (acc===undefined) return undefined; }
    return finite(acc!);
  };
  switch(o) {
    case "add":
      if (vals.some(v=>v.type==="string")) {
        let s="", chars=0;
        for (const v of vals) {
          const t=asText(v);
          if (t===undefined) return undefined;
          if (chars<maxString) { const add=Array.from(t).slice(0,maxString-chars); s+=add.join(""); chars+=add.length; }
        }
        return {type:"string",value:s};
      }
      return fold((a,b)=>a+b);
    case "subtract":return fold((a,b)=>a-b);
    case "multiply":return fold((a,b)=>a*b);
    case "divide":return fold((a,b)=>b!==0 ? a/b : undefined);
    case "equals":case "notEqual": {
      if (vals.length<2) return undefined;
      const eq=vals.slice(1).every(v=>same(vals[0],v));
      return {type:"boolean",value:o==="equals" ? eq : !eq};
    }
    case "less":case "lessOrEqual":case "greater":case "greaterOrEqual": {
      if (vals.length!==2) return undefined;
      const [a,b]=vals;
      let ord:number;
      if (a.type==="number" && b.type==="number") { if (a.value!==a.value || b.value!==b.value) return undefined; ord=Math.sign(a.value-b.value); }
      else if (a.type==="string" && b.type==="string") ord=compareUtf8(a.value,b.value);
      else return undefined;
      return {type:"boolean",value:o==="less" ? ord<0 : o==="lessOrEqual" ? ord<=0 : o==="greater" ? ord>0 : ord>=0};
    }
    case "and":case "or": {
      const b=bools();
      if (!b || !b.length) return undefined;
      return {type:"boolean",value:o==="and" ? b.every(x=>x) : b.some(x=>x)};
    }
    case "not":return vals.length===1 && vals[0].type==="boolean" ? {type:"boolean",value:!vals[0].value} : undefined;
    case "negate":
      if (vals.length===1 && vals[0].type==="number") return finite(-vals[0].value);
      if (vals.length===1 && vals[0].type==="boolean") return {type:"boolean",value:!vals[0].value};
      return undefined;
  }
}
/** Rust `str::cmp`: byte order, which is code point order. */
function compareUtf8(a:string,b:string) {
  const x=Array.from(a,c=>c.codePointAt(0)!), y=Array.from(b,c=>c.codePointAt(0)!);
  for (let i=0;i<Math.min(x.length,y.length);i++) if (x[i]!==y[i]) return x[i]<y[i] ? -1 : 1;
  return x.length===y.length ? 0 : x.length<y.length ? -1 : 1;
}

/** Native `Expr::eval`: the value with variables resolved in `modes`, or undefined. */
export function evaluateExpression(e:PrototypeExpression, vars:Variables, modes:Modes={}, depth=0):Literal|undefined {
  if (depth>maxExpressionDepth) return undefined;
  if ("value" in e) {
    const v=e.value;
    if (v.type==="alias") return resolveVariable(vars,v.value,modes) as Literal|undefined;
    if (v.type==="number") return Number.isFinite(v.value) ? v : undefined;
    return literalType(v) ? v as Literal : undefined;
  }
  if ("mode" in e) {
    const c=collectionById(vars,e.mode.collection), m=c && currentMode(c,modes);
    return m ? {type:"string",value:m.name} : undefined;
  }
  if ("inMode" in e) {
    const v=variableById(vars,e.inMode.variable), c=v && collectionById(vars,v.collection), m=c && modeById(c,e.inMode.mode);
    if (!m) return undefined;
    return resolveVariable(vars,v!.id,{...modes,[c!.id]:m.id}) as Literal|undefined;
  }
  let bytes=0;
  const vals:Literal[]=[];
  for (const a of e.op.args) {
    const v=evaluateExpression(a,vars,modes,depth+1);
    if (!v) return undefined;
    if (v.type==="string") { bytes+=utf8(v.value); if (bytes>maxOperandBytes) return undefined; }
    vals.push(v);
  }
  return apply(e.op.op,vals);
}

const quote=(s:string)=>"\""+s.replaceAll("\\","\\\\").replaceAll("\"","\\\"")+"\"";
function nameArg(name:string) {
  const plain=name!=="" && name.trim()===name && !/["'\\()[\]{}]/.test(name);
  return plain ? name : quote(name);
}
const equal=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
function variableRef(vars:Variables,v:Variable) {
  try { if (equal(parseExpression(v.name,vars),variable(v.id))) return v.name; } catch { /* not readable bare */ }
  const braced=!v.name.includes("}") && v.name.trim()===v.name && variableNamed(vars,v.name)?.id===v.id;
  return braced ? "{"+v.name+"}" : "{"+v.id+"}";
}
/** Native `Expr::display`: readable text that `parseExpression` reads back. */
export function displayExpression(e:PrototypeExpression, vars:Variables, depth=0):string {
  if (depth>maxExpressionDepth) return "…";
  if ("value" in e) {
    const v=e.value;
    if (v.type==="alias") { const x=variableById(vars,v.value); return x ? variableRef(vars,x) : "(missing variable)"; }
    if (v.type==="string") return quote(v.value);
    if (v.type==="number") return rustFloat(v.value);
    if (v.type==="color") return toCssHex(v.value);
    if (v.type==="boolean") return String(v.value);
    return "";
  }
  if ("mode" in e) { const c=collectionById(vars,e.mode.collection); return "mode("+nameArg(c ? c.name : "(missing collection)")+")"; }
  if ("inMode" in e) {
    const v=variableById(vars,e.inMode.variable), c=v && collectionById(vars,v.collection), m=c && modeById(c,e.inMode.mode);
    return displayExpression(variable(e.inMode.variable),vars,depth+1)+"["+nameArg(m ? m.name : "(missing mode)")+"]";
  }
  const parts=e.op.args.map(a=>"op" in a && (a.op.args.length>1 || a.op.op==="not") ? "("+displayExpression(a,vars,depth+1)+")" : displayExpression(a,vars,depth+1));
  if (e.op.op==="not" && parts.length===1) {
    const bare="not "+parts[0];
    let reads=false;
    try { reads=equal(parseExpression(bare,vars),e); } catch { /* falls back to brackets */ }
    return parts[0].startsWith("(") || reads ? bare : "not ("+parts[0]+")";
  }
  if (e.op.op==="negate" && parts.length===1) return "-"+parts[0];
  return parts.join(" "+symbols[e.op.op]+" ");
}
