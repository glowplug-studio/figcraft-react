import { inverse, transformPoint } from "./affine";
import { isFrameLike, type Document } from "./document";
import type { CommentMessage, CommentThread } from "./comments";
import { pageForNode, worldTransform } from "./hierarchy";
import { U64_MAX } from "./native-values";
import { inspectedId, parseBoolean, parseIndex, parseNodeId, parseNumber } from "./parameters";

export function cleanDisplayName(name:string) {
  return [...name.trim()].filter(char=>!(/\p{Cc}/u.test(char))).slice(0,64).join("") || "You";
}

export const commentActions = {
  "comment.add": {label: "Add comment", undo: true},
  "comment.reply": {label: "Reply to comment", undo: true},
  "comment.edit": {label: "Edit comment", undo: true},
  "comment.delete": {label: "Delete comment", undo: true},
  "comment.react": {label: "React to comment", undo: true},
  "comment.resolve": {label: "Resolve comment", undo: true},
  "comment.move": {label: "Move comment", undo: true},
  "comment.markRead": {label: "Mark comment as read", undo: false},
} as const;
const prefix = "figcraft://comment/";
export function commentId(p: Record<string,unknown>) {
  if (typeof p.link !== "string") return parseNodeId(p.id);
  const raw = p.link.trim().replace(/^figcraft:\/\/comment\//,"").replace(/\/+$/,"");
  return /^\d+$/.test(raw) ? parseNodeId(raw) : undefined;
}
export const commentLink = (id:string) => prefix+id;

function pin(doc:Document,page:string,p:Record<string,unknown>,auto:boolean) {
  const point={x:parseNumber(p.x,"x"),y:parseNumber(p.y,"y")};
  let anchor:string|null=null;
  if ((p.anchor ?? auto) === true) {
    let parent=doc.nodes[page];
    while (parent && "children" in parent) {
      let found:typeof parent | undefined;
      for(let i=parent.children.length-1;i>=0;i--) {
        const child=doc.nodes[parent.children[i]];
        if (!child || !("children" in child) || child.kind==="page" || child.visible===false) continue;
        let local;
        try { local=transformPoint(inverse(worldTransform(doc,child.id)),point); } catch { continue; }
        if(local.x<0 || local.x>child.width || local.y<0 || local.y>child.height) continue;
        found=child;
        if(isFrameLike(child) || child.kind==="section") anchor=child.id;
        break;
      }
      if (!found) break;
      parent=found;
    }
  } else {
    const id=parseNodeId(p.anchor);
    if(id && id!==page && doc.nodes[id] && pageForNode(doc,id)===page) anchor=id;
  }
  return {...(anchor ? transformPoint(inverse(worldTransform(doc,anchor)),point) : point),anchor};
}

export function unread(c:CommentThread,who:string) {return !!c.readBy && !c.readBy.includes(who);}
export function markRead(c:CommentThread,who:string,read:boolean) {
  if(unread(c,who)!==read) return c;
  const readers=c.readBy ?? [...new Set([c.author,...c.replies.map(m=>m.author)])];
  return {...c,readBy:read?[...readers,who]:readers.filter(name=>name!==who)};
}

function body(p:Record<string,unknown>) {
  if(typeof p.text!=="string" || !p.text.trim()) throw new Error("Comment text is empty");
  return p.text.trim();
}

export function editComment(doc:Document,command:string,p:Record<string,unknown>,user:string,allocate?:()=>bigint,now=String(Math.floor(Date.now()/1000))) {
  const comments=doc.comments??[];
  const who=typeof p.author==="string" && p.author.trim() || user.trim() || "You";
  const complete=(next:readonly CommentThread[],result:Record<string,unknown>={ok:true}) => {
    if(next===comments) return {document:doc,result};
    const {comments:_old,...rest}=doc;
    return {document:Object.freeze({...rest,...(next.length&&{comments:Object.freeze(next)})}),result};
  };
  const newMessage=():CommentMessage=>({author:who,text:body(p),created:now,edited:"0",agent:false,reactions:[]});
  if(command==="comment.add") {
    const page=p.page===undefined?doc.currentPage:parseNodeId(p.page);
    if(!page || !doc.pages.includes(page)) throw new Error("Comment requires a page");
    const message=newMessage(), position=pin(doc,page,p,false);
    const highest=allocate ? allocate() : comments.reduce((max,c)=>BigInt(c.id)>max?BigInt(c.id):max,0n)+1n;
    const id=String(highest>U64_MAX?U64_MAX:highest);
    const thread={...message,...position,id,page,resolved:false,readBy:[who],replies:[]};
    return complete([...comments,thread],{id:inspectedId(id),link:commentLink(id)});
  }
  const key=commentId(p);
  if(command==="comment.markRead") {
    if(("id" in p || "link" in p) && !comments.some(c=>c.id===key)) throw new Error("No such comment");
    let changed=0;
    const next=comments.map(c=>{
      const n=(!key || c.id===key)?markRead(c,who,parseBoolean(p.read)??true):c;
      if(n!==c) changed++;
      return n;
    });
    return complete(changed?next:comments,{changed});
  }
  const index=comments.findIndex(c=>c.id===key);
  if(index===-1) throw new Error("No such comment");
  const c=comments[index];
  let updated:CommentThread=c,result:Record<string,unknown>={ok:true};
  if(command==="comment.reply") {
    result={reply:c.replies.length};
    updated={...c,replies:[...c.replies,newMessage()],resolved:false,readBy:[who]};
  } else if(command==="comment.resolve") {
    const resolved=parseBoolean(p.resolved)??true;
    if(c.resolved!==resolved) updated={...c,resolved};
  } else if(command==="comment.move") {
    const point=pin(doc,c.page,p,true);
    if(point.x!==c.x || point.y!==c.y || point.anchor!==c.anchor) updated={...c,...point};
  } else {
    const i=p.reply===undefined?-1:parseIndex(p.reply,"reply");
    if(!Number.isInteger(i) || (p.reply!==undefined && i<0) || i>=c.replies.length) throw new Error("No such reply");
    const message=i===-1?c:c.replies[i];
    const replace=(m:CommentMessage):CommentThread=>i===-1?{...c,...m}:{...c,replies:c.replies.map((old,j)=>j===i?m:old)};
    if(command==="comment.react") {
      const emoji=typeof p.emoji==="string"?p.emoji.trim():"";
      if(!emoji || /[\p{White_Space}\p{Cc}]/u.test(emoji) || new TextEncoder().encode(emoji).length>32) throw new Error("Reaction must be one emoji");
      const reaction=message.reactions.find(r=>r.emoji===emoji),has=reaction?.users.includes(who)??false;
      const on=parseBoolean(p.on)??!has;
      result={on};
      if(on!==has) {
        const reactions=reaction ? message.reactions.map(r=>r!==reaction?r:{...r,users:on?[...r.users,who]:r.users.filter(u=>u!==who)}).filter(r=>r.users.length)
          : [...message.reactions,{emoji,users:[who]}];
        updated=replace({...message,reactions});
      }
    } else {
      if(command!=="comment.edit" && command!=="comment.delete") throw new Error("Unsupported comment action");
      if(message.author!==who) throw new Error("Only "+message.author+" can "+(command==="comment.edit"?"edit":"delete")+" this message");
      if(command==="comment.delete") {
        if(i===-1) return complete(comments.filter(thread=>thread.id!==key));
        updated={...c,replies:c.replies.filter((_,j)=>j!==i)};
      } else {
        const text=body(p);
        if(text!==message.text) updated=replace({...message,text,edited:now==="0"?"1":now});
      }
    }
  }
  return complete(updated===c?comments:comments.map((old,j)=>j===index?updated:old),result);
}
