import { type JsonObject } from "../rest/values";

/** One budget covers every lookup and expression in a themed token library. */
export class TokenWork {
  remaining=2_000_000;
  spend(n:number) {
    if (n>this.remaining) {this.remaining=0;return false;}
    this.remaining-=n;
    return true;
  }
}
const utf8=new TextEncoder();
const round=(v:number)=>Math.sign(v)*Math.round(Math.abs(v));
function call(name:string,args:number[]) {
  const [a,b]=args;
  switch (name) {
    case "round": if (args.length===1) return round(a);
    case "roundto": if (args.length===2) {const k=10**Math.trunc(b);return round(a*k)/k;} break;
    case "floor": if (args.length===1) return Math.floor(a);break;
    case "ceil": if (args.length===1) return Math.ceil(a);break;
    case "abs": if (args.length===1) return Math.abs(a);break;
    case "sqrt": if (args.length===1 && a>=0) return Math.sqrt(a);break;
    case "log": if (a>0 && args.length===1) return Math.log(a);if (a>0 && args.length===2 && b>0 && b!==1) return Math.log(a)/Math.log(b);break;
    case "pow": if (args.length===2) return a**b;break;
    case "min": return args.reduce((x,y)=>Math.min(x,y),Infinity);
    case "max": return args.reduce((x,y)=>Math.max(x,y),-Infinity);
  }
  return NaN;
}
function expression(text:string,nesting:number,resolve:(path:string,depth:number)=>number) {
  let at=0;
  function space() {while (at<text.length && /[ \t\r\n\v\f]/.test(text[at])) at++;}
  function eat(ch:string) {space();if (text[at]!==ch) return false;at++;return true;}
  function sum():number {
    let v=product();
    while (true) {if (eat("+")) v+=product();else if (eat("-")) v-=product();else return v;}
  }
  function product():number {
    let v=unary();
    while (true) {if (eat("*")) v*=unary();else if (eat("/")) v/=unary();else if (eat("%")) v%=unary();else return v;}
  }
  function unary():number {
    if (nesting>=64) return NaN;
    nesting++;
    let v;
    if (eat("-")) v=-unary();
    else {eat("+");v=atom();}
    nesting--;return v;
  }
  function atom():number {
    if (eat("(")) {const n=sum();return eat(")") ? n : NaN;}
    if (eat("{")) {
      const end=text.indexOf("}",at);
      if (end<0) return NaN;
      const path=text.slice(at,end).trim();at=end+1;
      return resolve(path,nesting);
    }
    let start=at;
    while (at<text.length && /[\d.]/.test(text[at])) at++;
    if (at!==start) {
      const n=Number(text.slice(start,at));
      if (text.startsWith("px",at)) at+=2;
      return n;
    }
    start=at;
    while (at<text.length && /[a-z]/i.test(text[at])) at++;
    const name=text.slice(start,at).toLowerCase();
    if (!eat("(")) return NaN;
    const args=[sum()];
    while (eat(",")) args.push(sum());
    return eat(")") ? call(name,args) : NaN;
  }
  const answer=sum();space();
  return at===text.length ? answer : NaN;
}

export function tokenNumber(path:string,sets:readonly ReadonlyMap<string,JsonObject>[],work:TokenWork,aliases=0,nesting=0):number {
  if (!work.spend(1) || aliases>32 || nesting>=64) return NaN;
  for (let i=sets.length-1;i>=0;i--) {
    if (!work.spend(1)) return NaN;
    const token=sets[i].get(path);
    if (!token) continue;
    const v=Object.hasOwn(token,"$value") ? token.$value : token.value;
    const n=typeof v==="number" ? v : typeof v==="string" && work.spend(utf8.encode(v).length) ?
      expression(v,nesting,(p,d)=>tokenNumber(p,sets,work,aliases+1,d)) : NaN;
    return Math.abs(n)<=1e6 ? n : NaN;
  }
  return NaN;
}
