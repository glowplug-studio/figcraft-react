import {Fragment,useEffect,useRef,useState,useSyncExternalStore,type RefObject} from "react";
import type {EditorEngine} from "./engine/editor";
import {pageForNode,worldTransform} from "./engine/hierarchy";
import {transformPoint} from "./engine/affine";
import {scalarCount} from "./engine/text-ranges";
import type {Point} from "./engine/geometry";
import type {LivePeople} from "./engine/sharing/live-people";
import {pageToScreen,screenToPage} from "./engine/viewport";
import {textCaret,textSelectionRects} from "./engine/text-caret";
import {documentTextReady,prepareDocumentText,textNodeLayout} from "./engine/text-node-layout";
import type {Document} from "./engine/document";

export function LivePeopleControls({room,engine,menuGroup,notify}:{room:LivePeople;engine:EditorEngine;menuGroup:string;notify:(message:string)=>void}) {
  // Cursor coordinates need not repaint the document header.
  useSyncExternalStore(room.subscribe,room.rosterKey,room.rosterKey);
  const {peers}=engine.execute("collab.peers");
  return <details name={menuGroup} className="figcraft-live-people"><summary>People ({peers.length+1})</summary><div>
    {peers.map(peer=><Fragment key={peer.id}><button type="button" onContextMenu={event=>{
      if(!engine.canRemovePeople)return;
      event.preventDefault();(event.currentTarget.nextElementSibling as HTMLButtonElement|null)?.focus();
    }} aria-pressed={room.following===peer.id}
      onClick={()=>engine.execute("collab.follow",room.following===peer.id?{}:{client:peer.id})}>
      <span aria-hidden="true" style={{color:peer.color}}>● </span>{room.following===peer.id?"Unfollow ":"Follow "}{peer.name}</button>
      {engine.canRemovePeople && <button type="button" onClick={async event=>{
        event.currentTarget.closest("details")?.removeAttribute("open");
        try{
          await engine.executeAsync("collab.removePerson",{client:peer.id});
        }catch(error){notify(error instanceof Error?error.message:"Could not remove the participant");}
      }}>Remove {peer.name} from session</button>}</Fragment>)}
    <button type="button" aria-pressed={room.spotlighting} onClick={()=>engine.execute("collab.spotlight")}>
      {room.spotlighting?"Stop spotlight":"Spotlight me"}</button>
    <button type="button" onClick={()=>engine.execute("collab.cursorChat")}>Cursor chat</button>
  </div></details>;
}

function textOn(colour:string) {
  const rgb=Number.parseInt(colour.slice(1),16);
  return ((rgb>>16)*0.299+(rgb>>8&255)*0.587+(rgb&255)*0.114)>170?"#1e1e1e":"#fff";
}

function drawName(ctx:CanvasRenderingContext2D,name:string,chat:string,colour:string,x:number,y:number) {
  ctx.font="600 11px system-ui";
  const lines=name?[name]:[];let line="";
  for(const char of chat) {
    if(ctx.measureText(line+char).width>220){lines.push(line);line="";}
    line+=char;
  }
  if(line)lines.push(line);
  const width=Math.max(...lines.map(value=>ctx.measureText(value).width))+12;
  ctx.fillStyle=colour;
  ctx.beginPath();ctx.roundRect(x,y,width,lines.length*15+4,4);ctx.fill();
  ctx.fillStyle=textOn(colour);ctx.textBaseline="top";
  lines.forEach((value,index)=>ctx.fillText(value,x+6,y+3+index*15));
}

export function LivePeopleOverlay({room,engine,canvas}:{room:LivePeople;engine:EditorEngine;canvas:RefObject<HTMLCanvasElement|null>}) {
  const layer=useRef<HTMLCanvasElement>(null),point=useRef<Point|null>(null),input=useRef<HTMLInputElement>(null);
  const [chatAt,setChatAt]=useState<Point|null>(null);
  useSyncExternalStore(room.subscribe,room.rosterKey,room.rosterKey);
  const following=room.getSnapshot().find(peer=>peer.client===room.following);
  const presenter=room.getSnapshot().find(peer=>peer.client===room.presenter);
  const localTyped=useRef(-Infinity),redraw=useRef<()=>void>(()=>{});
  const closeTimer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
  useEffect(()=>{
    const surface=canvas.current,overlay=layer.current,ctx=overlay?.getContext("2d");
    if(!surface || !overlay || !ctx)return;
    const motion=window.matchMedia("(prefers-reduced-motion: reduce)");
    const shown=new Map<number,Point>(), chats=new Map<number,{text:string;since:number}>();
    const preparing=new WeakSet<Document>();
    let mounted=true,frame=0,last=performance.now(),wake:ReturnType<typeof setTimeout>|undefined;
    const queue=()=>{if(mounted && !frame)frame=requestAnimationFrame(draw);};
    const updatePointer=()=>room.point(point.current && screenToPage(engine.getView(),point.current));
    function pointer(event:PointerEvent) {
      const rect=surface!.getBoundingClientRect();
      point.current={x:event.clientX-rect.left,y:event.clientY-rect.top};updatePointer();
    }
    function leave(){point.current=null;updatePointer();}
    function editChat() {
      localTyped.current=performance.now();
      const rect=surface!.getBoundingClientRect(),at=point.current??{x:rect.width/2,y:rect.height/2};
      setChatAt({x:Math.max(0,Math.min(at.x+12,rect.width-220)),y:Math.max(0,Math.min(at.y+16,rect.height-38))});
    }
    function shortcut(event:KeyboardEvent) {
      if(event.key!=="/" || event.ctrlKey || event.metaKey || event.altKey || (event.target as HTMLElement)?.closest("input,textarea,select,[contenteditable=true]"))return;
      event.preventDefault();engine.execute("collab.cursorChat");
    }
    function draw(now:number) {
      frame=0;clearTimeout(wake);
      const rect=surface!.getBoundingClientRect(),dpr=window.devicePixelRatio||1;
      const width=Math.round(rect.width*dpr),height=Math.round(rect.height*dpr);
      if(overlay!.width!==width)overlay!.width=width;
      if(overlay!.height!==height)overlay!.height=height;
      const c=ctx!,view=engine.getView(),doc=engine.getRenderDocument(),peers=room.getSnapshot();
      c.setTransform(dpr,0,0,dpr,0,0);c.clearRect(0,0,rect.width,rect.height);
      const origin=pageToScreen(view,{x:0,y:0}),ids=new Set(peers.map(p=>p.client));
      for(const id of shown.keys())if(!ids.has(id))shown.delete(id);
      for(const id of chats.keys())if(!ids.has(id))chats.delete(id);
      let delay=Infinity;
      const glide=motion.matches?1:1-Math.exp(-20*Math.max(0,now-last)/1000);
      last=now;
      for(const peer of peers) {
        const {cursor,selection,viewport,editingText}=peer.presence;
        if(room.following===peer.client){c.strokeStyle=peer.colour;c.lineWidth=2;c.strokeRect(1,1,rect.width-2,rect.height-2);}
        if((viewport?.[0]??cursor?.[0])===doc.currentPage){
          c.save();c.translate(origin.x,origin.y);c.scale(view.zoom,view.zoom);
          c.strokeStyle=peer.colour;c.lineWidth=1.5/view.zoom;
          let outlines=0;
          for(const id of selection??[]){
            const node=doc.nodes[id];if(!node || node.kind==="page" || pageForNode(doc,id)!==doc.currentPage)continue;
            c.save();c.transform(...worldTransform(doc,id));c.strokeRect(0,0,node.width,node.height);c.restore();
            if(++outlines===500)break;
          }
          c.restore();
        }
        const text=editingText && doc.nodes[editingText.node];
        const visibleText=text?.kind==="text" && pageForNode(doc,text.id)===doc.currentPage;
        if(visibleText && !documentTextReady(doc) && !preparing.has(doc)){
          preparing.add(doc);
          // The main canvas reports a failed font load. Resume this overlay once the same drawing is ready.
          void prepareDocumentText(doc).then(queue,()=>{});
        }
        if(editingText && visibleText && documentTextReady(doc)) {
          const {layout,dy}=textNodeLayout(text),length=scalarCount(text.text.characters);
          const caret=textCaret(layout,Math.min(length,editingText.caret)),line=layout.lines[caret.line];
          const matrix=worldTransform(doc,text.id),top=(line?.top??0)+dy;
          if(editingText.selection && editingText.selection[0]<editingText.selection[1]){
            c.save();c.translate(origin.x,origin.y);c.scale(view.zoom,view.zoom);c.transform(...matrix);c.translate(0,dy);
            c.fillStyle=peer.colour;c.globalAlpha=0.25;
            const [start,end]=editingText.selection;
            for(const r of textSelectionRects(layout,Math.min(length,start),Math.min(length,end)))c.fillRect(r.x,r.y,r.width,r.height);
            c.restore();
          }
          const start=pageToScreen(view,transformPoint(matrix,{x:caret.x,y:top}));
          const end=pageToScreen(view,transformPoint(matrix,{x:caret.x,y:top+(line?.height??text.height)}));
          c.beginPath();c.moveTo(start.x,start.y);c.lineTo(end.x,end.y);c.strokeStyle=peer.colour;c.lineWidth=2;c.stroke();
          const name=engine.getTextRange()?.node.id===text.id?peer.name+" is editing this text":peer.name;
          drawName(c,name,"",peer.colour,Math.min(start.x,end.x)-1,Math.min(start.y,end.y)-21);
        }
        let message=chats.get(peer.client);
        if(!peer.chat){chats.delete(peer.client);message=undefined;}
        else if(message?.text!==peer.chat){message={text:peer.chat,since:now};chats.set(peer.client,message);}
        if(!cursor || cursor[0]!==doc.currentPage){shown.delete(peer.client);continue;}
        const target={x:cursor[1],y:cursor[2]},old=shown.get(peer.client)??target;
        const pos={x:old.x+(target.x-old.x)*glide,y:old.y+(target.y-old.y)*glide};
        if(Math.hypot(pos.x-target.x,pos.y-target.y)*view.zoom<0.5)Object.assign(pos,target);
        else queue();
        shown.set(peer.client,pos);
        const tip=pageToScreen(view,pos);c.save();c.translate(tip.x,tip.y);
        c.beginPath();c.moveTo(0,0);c.lineTo(3.5,15.5);c.lineTo(7.5,8.5);c.lineTo(15.5,4);c.closePath();
        c.fillStyle=peer.colour;c.fill();c.strokeStyle="#fff";c.lineWidth=1.5;c.stroke();
        const age=message?now-message.since:Infinity;
        if(age<5000)delay=Math.min(delay,5000-age);
        else if(age<6000 && !motion.matches){c.globalAlpha=(6000-age)/1000;queue();}
        drawName(c,peer.name,age<(motion.matches?5000:6000)?peer.chat:"",peer.colour,12,16);c.restore();
      }
      const localAge=now-localTyped.current;
      if(!input.current && room.cursorChat && localAge<(motion.matches?5000:6000)){
        const tip=point.current??{x:rect.width/2,y:rect.height/2};
        c.save();
        if(localAge<5000)delay=Math.min(delay,5000-localAge);
        else {c.globalAlpha=(6000-localAge)/1000;queue();}
        drawName(c,"",room.cursorChat,room.colour,tip.x+12,tip.y+16);c.restore();
      }
      if(Number.isFinite(delay))wake=setTimeout(queue,Math.ceil(delay));
    }
    redraw.current=queue;
    const unlisten=[room.subscribe(queue),engine.subscribeCanvas(queue),engine.subscribeView(()=>{updatePointer();queue();}),room.onChat(editChat)];
    const resize=new ResizeObserver(queue);resize.observe(surface);
    const abort=new AbortController(),options={signal:abort.signal,capture:true};
    surface.addEventListener("pointermove",pointer,options);surface.addEventListener("pointerleave",leave,options);
    window.addEventListener("keydown",shortcut,options);queue();
    return ()=>{mounted=false;abort.abort();resize.disconnect();unlisten.forEach(remove=>remove());clearTimeout(wake);clearTimeout(closeTimer.current);cancelAnimationFrame(frame);room.point(null);};
  },[room,engine,canvas]);
  function expireChat() {
    clearTimeout(closeTimer.current);
    closeTimer.current=setTimeout(()=>{
      engine.execute("collab.cursorChat",{text:""});setChatAt(null);redraw.current();
    },Math.max(0,6000-(performance.now()-localTyped.current)));
  }
  useEffect(()=>{
    if(chatAt){input.current?.focus();expireChat();}
    redraw.current();
  },[chatAt]);
  return <><canvas aria-hidden="true" ref={layer} className="figcraft-people-overlay"/>
    {following && <div className="figcraft-follow-name" style={{background:following.colour,color:textOn(following.colour)}}>
      Following {following.name} · Escape to stop</div>}
    {room.spotlighting ? <div className="figcraft-spotlight-banner">You're spotlighting: everyone follows your view
      <button type="button" onClick={()=>engine.execute("collab.spotlight",{on:false})}>Stop</button></div>
      : presenter && presenter!==following && <div className="figcraft-spotlight-banner">{presenter.name} is spotlighting
        <button type="button" onClick={()=>engine.execute("collab.follow",{client:presenter.client})}>Follow</button></div>}
    {chatAt && <input ref={input} className="figcraft-cursor-chat" aria-label="Cursor chat" defaultValue={room.cursorChat}
      style={{left:chatAt.x,top:chatAt.y}} onChange={e=>{engine.execute("collab.cursorChat",{text:e.target.value});e.target.value=room.cursorChat;
        localTyped.current=performance.now();expireChat();}}
      onKeyDown={e=>{if(e.key==="Escape"||e.key==="Enter"){e.preventDefault();e.stopPropagation();if(e.key==="Escape")engine.execute("collab.cursorChat",{text:""});setChatAt(null);canvas.current?.focus();}}}
      onBlur={()=>setChatAt(null)}/>}</>;
}
