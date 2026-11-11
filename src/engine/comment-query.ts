import { commentId, commentLink, unread } from "./comment-actions";
import { commentPosition, type CommentMessage, type CommentThread } from "./comments";
import { isFrameLike, type Document } from "./document";
import { ancestors } from "./hierarchy";
import { inspectedId, parseBoolean, parseNodeId, parseString } from "./parameters";
import { boundsOf } from "./viewport";

export const commentQueries = {
  "comment.list": {label:"List comments",undo:false},
  "comment.link": {label:"Copy link to comment",undo:false},
  "comment.people": {label:"People in comments",undo:false},
} as const;

const asciiLower = (value:string) => value.replace(/[A-Z]/g,char=>char.toLowerCase());
const compare = (a:string,b:string) => a<b?-1:a>b?1:0;
const nameOrder = (a:string,b:string) => compare(a.toLowerCase(),b.toLowerCase()) || compare(a,b);
const alnum = /[\p{Alphabetic}\p{Number}]/u;

function mentions(text:string,people:readonly string[],user:string) {
  const found = new Map<string,{name:string;known:boolean;you:boolean}>();
  let from=0;
  for (let at=text.indexOf("@");at>=0;at=text.indexOf("@",from)) {
    from=at+1;
    if (at && /[\p{Alphabetic}\p{Number}]$/u.test(text.slice(Math.max(0,at-2),at))) continue;
    const rest=text.slice(from);
    let selected="";
    for (const name of people) {
      if (!name || name.length<selected.length || asciiLower(rest.slice(0,name.length))!==asciiLower(name)) continue;
      const next=rest.codePointAt(name.length);
      if (next===undefined || !alnum.test(String.fromCodePoint(next))) selected=name;
    }
    const name=selected || rest.match(/^[\p{Alphabetic}\p{Number}]+/u)?.[0];
    if (!name) continue;
    from+=name.length;
    found.set(name,{name,known:!!selected,you:!!selected && asciiLower(name)===asciiLower(user)});
  }
  return [...found.values()];
}

export function peopleIn(doc:Document) {
  const names=new Set<string>();
  for (const thread of doc.comments??[]) for (const m of [thread,...thread.replies]) {
    if (m.author.trim()) names.add(m.author);
    for (const r of m.reactions) for (const user of r.users) if(user.trim()) names.add(user);
  }
  return [...names].sort(nameOrder);
}

function frameOf(doc:Document,c:CommentThread) {
  if(c.anchor && doc.nodes[c.anchor]) {
    const top=[c.anchor,...ancestors(doc,c.anchor)].at(-2), n=top && doc.nodes[top];
    return n && (isFrameLike(n)||n.kind==="section") ? n.id : null;
  }
  const page=doc.nodes[c.page];
  if(page?.kind!=="page") return null;
  const p=commentPosition(doc,c);
  return [...page.children].reverse().find(id=>{
    const n=doc.nodes[id];
    if(!n || !(isFrameLike(n)||n.kind==="section") || !n.visible) return false;
    const b=boundsOf(doc,[id]);
    return b && p.x>=b.x && p.y>=b.y && p.x<=b.x+b.width && p.y<=b.y+b.height;
  })??null;
}

export function queryComments(doc:Document,p:Record<string,unknown>,user:string) {
  const name=typeof p.author==="string" && p.author.trim() || user, people=[...peopleIn(doc),name];
  const filter=(parseString(p.filter)??(parseBoolean(p.resolved)===false?"open":"all")).trim().toLowerCase();
  const sort=(parseString(p.sort)??"date").trim().toLowerCase();
  if (!["all","open","resolved","mine","unread"].includes(filter)) throw new Error("Unknown comment filter");
  if (!["page","date"].includes(sort)) throw new Error("Unknown comment order");
  const page=p.page==="all"?null:parseNodeId(p.page)??doc.currentPage,frame=parseNodeId(p.frame);
  const search=(parseString(p.query)??"").trim().toLowerCase();
  const wanted=typeof p.mentions==="string"?p.mentions.trim().replace(/^@+/,"").trim():"";
  if (p.mentions!=null && !wanted) throw new Error("mentions must be a name");
  const message=(m:CommentMessage)=>({author:m.author,agent:m.agent,text:m.text,created:inspectedId(m.created),edited:inspectedId(m.edited),reactions:m.reactions,mentions:mentions(m.text,people,name)});
  const rows=[];
  for (const c of doc.comments??[]) {
    if (!doc.pages.includes(c.page) || page && c.page!==page) continue;
    const messages=[c,...c.replies],isUnread=unread(c,name);
    if (filter==="resolved" && !c.resolved || filter==="open" && c.resolved || filter==="unread" && !isUnread) continue;
    if (filter==="mine" && !messages.some(m=>m.author===name || mentions(m.text,[name],name).some(a=>a.known))) continue;
    if (wanted && !messages.some(m=>mentions(m.text,[...people,wanted],name).some(a=>asciiLower(a.name)===asciiLower(wanted)))) continue;
    const container=frameOf(doc,c),frameName=container?doc.nodes[container].name:null;
    if (frame && frame!==container || search && ![frameName,...messages.flatMap(m=>[m.author,m.text])].some(s=>s?.toLowerCase().includes(search))) continue;
    const value={...message(c),id:inspectedId(c.id),page:inspectedId(c.page),pageName:doc.nodes[c.page].name,
      ...commentPosition(doc,c),anchor:c.anchor?inspectedId(c.anchor):null,frame:container?inspectedId(container):null,frameName,
      resolved:c.resolved,unread:isUnread,link:commentLink(c.id),replies:c.replies.map(message)};
    rows.push({value,page:doc.pages.indexOf(c.page),activity:messages.reduce((latest,m)=>BigInt(m.created)>latest?BigInt(m.created):latest,0n),id:BigInt(c.id)});
  }
  rows.sort((a,b)=>(sort==="page"?a.page-b.page:0) || (a.activity>b.activity?-1:a.activity<b.activity?1:a.id>b.id?-1:a.id<b.id?1:0));
  return rows.map(row=>row.value);
}

export function readCommentsCommand(doc:Document,command:string,p:Record<string,unknown>,user:string) {
  if (command==="comment.list") return {comments:queryComments(doc,p,user)};
  if (command==="comment.link") {
    const id=commentId(p);
    if (!id || !doc.comments?.some(c=>c.id===id)) throw new Error("No such comment");
    return {link:commentLink(id)};
  }
  const people=peopleIn(doc),names=new Map(people.map(name=>[name.toLowerCase(),name] as const).reverse());
  for (const c of doc.comments??[]) for (const m of [c,...c.replies]) {
    for (const {name} of mentions(m.text,[...people,user],user)) if(!names.has(name.toLowerCase())) names.set(name.toLowerCase(),name);
  }
  return {people:[...names.values()].sort(nameOrder),you:user};
}
