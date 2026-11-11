import {CommentComposer} from "./CommentComposer";
import {useEffect, useMemo, useRef, useState, useSyncExternalStore, type RefObject} from "react";
import type {EditorEngine, EditorSnapshot} from "./engine/editor";
import {peopleIn,queryComments} from "./engine/comment-query";
import type {Point} from "./engine/geometry";
import {pageToScreen,screenToPage} from "./engine/viewport";

type Row=ReturnType<typeof queryComments>[number];
type Dispatch=(command:string,params?:Record<string,unknown>)=>Record<string,unknown>|undefined;
type Props={engine:EditorEngine;snapshot:EditorSnapshot;canvas:RefObject<HTMLCanvasElement|null>;write:boolean;dispatch:Dispatch};

function pinGroups(rows:readonly Row[],project:(point:Point)=>Point,open?:string) {
  const groups:{ids:Row[];x:number;y:number}[]=[];
  const solo=[];
  for(const row of rows) {
    const p=project(row);
    if(String(row.id)===open) {solo.push({ids:[row],...p});continue;}
    const group=groups.find(g=>Math.hypot(g.x-p.x,g.y-p.y)<24);
    if(!group) {groups.push({ids:[row],...p});continue;}
    group.ids.push(row);group.x+=(p.x-group.x)/group.ids.length;group.y+=(p.y-group.y)/group.ids.length;
  }
  return [...groups,...solo];
}

export function CommentOverlay({engine,snapshot,canvas,write,dispatch}:Props) {
  const view=useSyncExternalStore(engine.subscribeView,engine.getView,engine.getView);
  const tool=snapshot.tool==="comment",you=engine.commentName;
  const [filter,setFilter]=useState("open"),[sort,setSort]=useState("date"),[query,setQuery]=useState("");
  const [draft,setDraft]=useState<Point>(),[text,setText]=useState(""),[editing,setEditing]=useState<number>();
  const [panel,setPanel]=useState(true),[copyError,setCopyError]=useState("");
  const drag=useRef<{from:Point;at:Point;id:Row["id"];moved:boolean} | undefined>(undefined);
  const [dragPoint,setDragPoint]=useState<Point>();
  const doc=snapshot.document,opened=snapshot.openComment;
  const people=useMemo(()=>peopleIn(doc),[doc]);
  const all=useMemo(()=>queryComments(doc,{page:"all"},you),[doc,you]);
  const list=useMemo(()=>queryComments(doc,{page:"all",filter,sort,query},you),[doc,you,filter,sort,query]);
  const thread=all.find(row=>String(row.id)===opened);
  const rows=useMemo(()=>{
    const pins=queryComments(doc,{filter},you).reverse();
    if(thread && String(thread.page)===doc.currentPage && !pins.some(r=>r.id===thread.id)) pins.push(thread);
    return pins;
  },[doc,thread,filter,you]);
  const groups=useMemo(()=>pinGroups(rows,p=>pageToScreen(view,p),opened)
    .filter(p=>p.x>=-48 && p.y>=0 && p.x<=view.vw && p.y<=view.vh+28),[rows,view,opened]);
  const run=useRef(dispatch);run.current=dispatch;
  useEffect(()=>{
    const el=canvas.current;
    if(!el || !tool) return;
    const place=(ev:PointerEvent)=>{
      if(ev.button!==0 || !write) return;
      ev.preventDefault();ev.stopImmediatePropagation();
      const box=el.getBoundingClientRect();
      engine.closeComment();setEditing(undefined);setText("");
      setDraft(screenToPage(engine.getView(),{x:ev.clientX-box.left,y:ev.clientY-box.top}));
    };
    el.addEventListener("pointerdown",place,true);
    return ()=>el.removeEventListener("pointerdown",place,true);
  },[engine,canvas,tool,write]);
  useEffect(()=>{
    const root=canvas.current?.closest("[data-figcraft-editor]");
    if(!root) return;
    const key=(ev:Event)=>{
      const k=ev as KeyboardEvent;
      const input=k.target instanceof Element && k.target.closest("input,textarea,select,[contenteditable=true]");
      if(k.key==="Escape" && input && k.target instanceof Element && k.target.closest("form")?.querySelector('[role="listbox"]')) return;
      if(k.key==="Escape" && (draft||opened||tool)) {
        k.preventDefault();k.stopPropagation();
        if(editing!==undefined) {setEditing(undefined);setText("");return;}
        if(draft || opened) {engine.closeComment();setDraft(undefined);setEditing(undefined);setText("");}
        else run.current("tool.move");
        canvas.current?.focus();return;
      }
      if(input || !tool || !["ArrowDown","ArrowUp"].includes(k.key) || !list.length) return;
      k.preventDefault();k.stopPropagation();
      run.current("comment.next",{id:opened,page:"all",filter,sort,query,dir:k.key==="ArrowDown"?1:-1});
      setText("");setEditing(undefined);setDraft(undefined);
    };
    root.addEventListener("keydown",key,true);return ()=>root.removeEventListener("keydown",key,true);
  },[canvas,engine,draft,opened,tool,filter,sort,query,list.length,editing]);
  function open(row:Row,view:"keep"|"center") {
    setDraft(undefined);setEditing(undefined);setText("");
    if(view==="keep" && String(row.id)===opened) {engine.closeComment();return;}
    dispatch("comment.open",{id:row.id,view});
  }
  async function copy(value:string) {
    try {await navigator.clipboard.writeText(value);setCopyError("");}
    catch {setCopyError("Could not copy to clipboard");}
  }
  function submit() {
    if(!write || !text.trim()) return;
    const result=draft?dispatch("comment.add",{...draft,text,anchor:true}):thread?editing===undefined?
      dispatch("comment.reply",{id:thread.id,text}):dispatch("comment.edit",{id:thread.id,text,...(editing>=0&&{reply:editing})}):undefined;
    if(!result) return;
    if(draft) dispatch("comment.open",{id:result.id,view:"keep"});
    setText("");setDraft(undefined);setEditing(undefined);
  }
  const anchor=draft??thread,point=anchor?pageToScreen(view,anchor):undefined;
  const threadHeight=Math.min(360,view.vh-8);
  return <>
    {groups.map(({ids,x,y})=>{
      const row=ids[0],cluster=ids.length>1;
      const at=dragPoint&&drag.current?.id===row.id?dragPoint:{x,y};
      return <button key={String(row.id)} type="button" className="figcraft-comment-pin" aria-label={cluster?`${ids.length} comments`:`Comment by ${row.author}: ${row.text}`}
        style={{left:at.x,top:at.y}} onPointerDown={e=>{
          if(cluster||!write||row.author!==you||e.button!==0) return;
          drag.current={from:{x:e.clientX,y:e.clientY},at:{x,y},id:row.id,moved:false};e.currentTarget.setPointerCapture(e.pointerId);
        }} onPointerMove={e=>{
          const d=drag.current;if(d?.id!==row.id)return;
          const dx=e.clientX-d.from.x,dy=e.clientY-d.from.y;
          if(d.moved||Math.hypot(dx,dy)>3){d.moved=true;setDragPoint({x:d.at.x+dx,y:d.at.y+dy});}
        }} onPointerCancel={()=>{drag.current=undefined;setDragPoint(undefined);}} onPointerUp={e=>{
          const d=drag.current;if(d?.id===row.id && d.moved) dispatch("comment.move",{id:row.id,...screenToPage(view,{x:d.at.x+e.clientX-d.from.x,y:d.at.y+e.clientY-d.from.y})});
          setDragPoint(undefined);
        }} onClick={()=>{
          const moved=drag.current?.moved;drag.current=undefined;if(moved)return;
          if(cluster) dispatch("comment.zoom",{ids:ids.map(r=>r.id)});else open(row,"keep");
        }}>{cluster?ids.length:row.author.trim().slice(0,1)||"?"}</button>;
    })}
    {tool && <div className="figcraft-comment-list">
      <button type="button" onClick={()=>setPanel(!panel)} aria-expanded={panel}>Comments</button>
      {panel && <section aria-label="Comment list"><input type="search" aria-label="Search comments" placeholder="Search comments" value={query} onChange={e=>setQuery(e.target.value)}/>
        <select aria-label="Filter comments" value={filter} onChange={e=>setFilter(e.target.value)}>
          {[["open","Open"],["resolved","Resolved"],["mine","Only your threads"],["unread","Unread"],["all","All comments"]].map(([k,v])=><option key={k} value={k}>{v}</option>)}
        </select><select aria-label="Sort comments" value={sort} onChange={e=>setSort(e.target.value)}><option value="date">Sort by date</option><option value="page">Sort by page</option></select>
        <button disabled={!list.length} onClick={()=>{const result=dispatch("comment.prompt",{ids:list.map(r=>r.id)});if(typeof result?.text==="string")void copy(result.text);}}>Copy comments for AI</button>
        {write && <button onClick={()=>dispatch("comment.markRead")}>Mark all as read</button>}
        {list.map(row=><button key={row.id} onClick={()=>open(row,"center")}>{row.author} · {row.text}</button>)}
        {!list.length && <p>{all.length?"No matching comments":"No comments yet"}</p>}
      </section>}
    </div>}
    {point && <section key={draft?"draft":opened} className="figcraft-comment-thread" aria-label={draft?"New comment":"Comment thread"}
      style={{left:Math.max(4,Math.min(view.vw-282,point.x+32)),top:Math.max(4,Math.min(view.vh-threadHeight-4,point.y)),maxHeight:threadHeight}}>
      <button aria-label="Close comment" onClick={()=>{setDraft(undefined);engine.closeComment();}}>×</button>
      {thread && !draft && <>
        {[thread,...thread.replies].map((m,i)=><article key={i}><strong>{m.author}</strong><p>{m.text}</p>
          {m.reactions.map(r=><button key={r.emoji} disabled={!write} aria-label={r.emoji+" "+r.users.join(", ")} onClick={()=>dispatch("comment.react",{id:thread.id,...(i&&{reply:i-1}),emoji:r.emoji})}>{r.emoji} {r.users.length}</button>)}
          {write && <><details><summary>React</summary>{["👍","❤","😂","🎉","👀","🙏","🔥","✅"].map(emoji=>
            <button key={emoji} aria-label={"React with "+emoji} onClick={e=>{e.currentTarget.closest("details")?.removeAttribute("open");dispatch("comment.react",{id:thread.id,...(i&&{reply:i-1}),emoji});}}>{emoji}</button>)}</details>
          {m.author===you && <><button onClick={()=>{setEditing(i-1);setText(m.text);}}>Edit</button>
          <button onClick={()=>{if(dispatch("comment.delete",{id:thread.id,...(i&&{reply:i-1})}) && i===0)engine.closeComment();}}>Delete</button></>}</>}
        </article>)}
        {write && <button onClick={()=>dispatch("comment.resolve",{id:thread.id,resolved:!thread.resolved})}>{thread.resolved?"Reopen":"Resolve"}</button>}
        <button onClick={()=>void copy(thread.link)}>Copy link</button>
      </>}
      {write && <CommentComposer label={draft?"Comment":editing!==undefined?"Edit message":"Reply"} button={draft?"Post comment":editing!==undefined?"Save":"Reply"}
        people={people} you={you} text={text} change={setText} submit={submit} focus={!!draft}/>}
    </section>}
    {copyError && <p role="alert">{copyError}</p>}
  </>;
}
