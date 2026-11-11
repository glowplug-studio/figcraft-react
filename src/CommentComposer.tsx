import {useRef,useState} from "react";

export function CommentComposer({label,button,people,you,text,change,submit,focus}:{
  label:string;button:string;people:readonly string[];you:string;text:string;change:(text:string)=>void;submit:()=>void;focus:boolean;
}) {
  const ref=useRef<HTMLTextAreaElement>(null);
  const [cursor,setCursor]=useState(0),[selected,setSelected]=useState(0),[dismissed,setDismissed]=useState(-1);
  const before=text.slice(0,cursor),at=before.lastIndexOf("@"),query=before.slice(at+1);
  const active=at>=0 && at!==dismissed && !/[\p{Alphabetic}\p{Number}]$/u.test(before.slice(0,at)) &&
    !query.includes("\n") && [...query].length<=40 && !/\s$/u.test(query);
  const lower=query.toLowerCase();
  const matches=active?people.filter(n=>n!==you && n.toLowerCase().split(/\s+/).some(part=>part.startsWith(lower)) ||
    n!==you && n.toLowerCase().startsWith(lower)).slice(0,6):[];
  function choose(name:string) {
    const end=at+name.length+2;
    change(text.slice(0,at)+"@"+name+" "+text.slice(cursor));setCursor(end);setSelected(0);
    requestAnimationFrame(()=>{ref.current?.focus();ref.current?.setSelectionRange(end,end);});
  }
  return <form onSubmit={e=>{e.preventDefault();submit();}}>
    <textarea ref={ref} aria-label={label} autoFocus={focus} value={text}
      onChange={e=>{change(e.target.value);setCursor(e.target.selectionStart);setSelected(0);setDismissed(-1);}}
      onSelect={e=>setCursor(e.currentTarget.selectionStart)}
      onKeyDown={e=>{
        if(e.nativeEvent.isComposing)return;
        if(matches.length && ["ArrowUp","ArrowDown","Enter","Tab","Escape"].includes(e.key)) {
          e.preventDefault();e.stopPropagation();
          if(e.key==="Escape")setDismissed(at);
          else if(e.key==="Enter"||e.key==="Tab") choose(matches[Math.min(selected,matches.length-1)]);
          else setSelected(i=>(i+(e.key==="ArrowUp"?-1:1)+matches.length)%matches.length);
          return;
        }
        if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();submit();}
      }}/>
    {matches.length>0 && <div role="listbox" aria-label="Mention a person">{matches.map((name,i)=>
      <button key={name} type="button" role="option" aria-selected={selected===i}
        onMouseDown={e=>e.preventDefault()} onClick={()=>choose(name)}>{name}</button>)}</div>}
    <button disabled={!text.trim()}>{button}</button>
  </form>;
}
