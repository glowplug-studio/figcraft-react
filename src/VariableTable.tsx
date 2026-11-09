import {useEffect,useRef,useState} from "react";
import type {Collection,Mode,Variable,Variables} from "./engine/variables";
import {VariableValueCell,type VariableRun} from "./VariableValueCell";

const rowHeight=68,columnWidth=180;
type Slot={index:number;skip?:number};

// Keep the focused editor mounted if the user scrolls past it. Spacers represent all
// remaining rows or columns, so the scrollbar covers the entire collection.
function slots(count:number,start:number,length:number,focus?:number) {
  const result:Slot[]=[];
  const from=Math.max(0,Math.min(count-length,start)),to=Math.min(count,from+length);
  function gap(a:number,b:number) {
    if (b>a) result.push({index:a,skip:b-a});
  }
  if (focus!==undefined && focus>=0 && focus<from) {gap(0,focus);result.push({index:focus});gap(focus+1,from);}
  else gap(0,from);
  for (let index=from;index<to;index++) result.push({index});
  if (focus!==undefined && focus>=to && focus<count) {gap(to,focus);result.push({index:focus});gap(focus+1,count);}
  else gap(to,count);
  return result;
}

interface Props {
  readOnly?:boolean;collection:Collection; rows:readonly Variable[]; data:Variables; run:VariableRun;
  edit:(id:string)=>void;rename:(mode:Mode)=>void;duplicate:(id:string)=>void;
}
export function VariableTable({collection,rows,data,run,edit,rename,duplicate,readOnly}:Props) {
  const ref=useRef<HTMLDivElement>(null);
  const [viewport,setViewport]=useState({x:0,y:0,width:760,height:520});
  const [focus,setFocus]=useState<{row?:number;column?:number}>({});
  const manyRows=rows.length>100,manyColumns=collection.modes.length>16;
  const windowed=manyRows || manyColumns;
  useEffect(()=>{
    if (!windowed || !ref.current) return;
    const el=ref.current;
    const measure=()=>setViewport({x:el.scrollLeft,y:el.scrollTop,width:el.clientWidth,height:el.clientHeight});
    measure();el.addEventListener("scroll",measure,{passive:true});
    const observer=new ResizeObserver(measure);observer.observe(el);
    return ()=>{observer.disconnect();el.removeEventListener("scroll",measure);};
  },[windowed]);
  const columns=slots(collection.modes.length,Math.floor(viewport.x/columnWidth)-2,
    manyColumns ? Math.ceil(viewport.width/columnWidth)+4 : collection.modes.length,focus.column);
  const shown=slots(rows.length,Math.floor(viewport.y/rowHeight)-3,
    manyRows ? Math.ceil(viewport.height/rowHeight)+6 : rows.length,focus.row);
  const span=columns.length+1;
  return <div ref={ref} className="figcraft-variable-table" data-windowed={windowed || undefined}
    onFocusCapture={e=>{
      if (!windowed) return;
      const tr=e.target.closest("tr"),cell=e.target.closest("th,td");
      setFocus({row:tr?.dataset.row===undefined ? undefined : Number(tr.dataset.row),
        column:cell?.ariaColIndex ? Number(cell.ariaColIndex)-2 : undefined});
    }} onBlurCapture={e=>{if (windowed && !e.currentTarget.contains(e.relatedTarget)) setFocus({});}}>
    <table aria-label={collection.name+" variables"} aria-rowcount={rows.length+1} aria-colcount={collection.modes.length+1}
      style={manyColumns ? {width:(collection.modes.length+1)*columnWidth,tableLayout:"fixed"} : undefined}>
      {manyColumns && <colgroup><col style={{width:columnWidth}}/>{columns.map(c=><col key={c.index} style={{width:(c.skip ?? 1)*columnWidth}}/>)}</colgroup>}
      <thead><tr><th>Name</th>{columns.map(({index,skip})=>{
        if (skip) return <th key={index} aria-hidden="true"/>;
        const m=collection.modes[index];
        return <th key={m.id} scope="col" aria-colindex={index+2}>{m.name}
            {!readOnly && collection.extends===undefined && <details><summary aria-label={"Options for "+m.name}>⋯</summary>
              <button type="button" onClick={()=>rename(m)}>Rename mode</button>
              <button type="button" onClick={()=>duplicate(m.id)}>Duplicate mode</button>
              {([-1,1] as const).map(dir=><button type="button" key={dir} disabled={index+dir<0 || index+dir>=collection.modes.length}
                onClick={()=>run("variable.moveMode",{collection:collection.id,mode:m.id,to:index+dir})}>{dir<0 ? "Move left" : "Move right"}</button>)}
              <button type="button" disabled={collection.modes.length===1} onClick={()=>run("variable.removeMode",{collection:collection.id,mode:m.id})}>Remove mode</button>
            </details>}

        </th>;
      })}</tr></thead><tbody>{shown.map(({index,skip})=>{
        if (skip) return <tr key={"gap/"+index} aria-hidden="true"><td colSpan={span} style={{height:skip*rowHeight,padding:0,border:0}}/></tr>;
        const v=rows[index];
        return <tr key={v.id} data-row={index} aria-rowindex={index+2} style={manyRows ? {height:rowHeight} : undefined}>
          <th scope="row" title={v.description}>
            {readOnly ? v.name : <><button type="button" aria-label={"Edit variable "+v.name} onClick={()=>edit(v.id)}>{v.name}</button>
            <details><summary aria-label={"Options for variable "+v.name}>⋯</summary>
              <button type="button" onClick={()=>run("variable.duplicate",{variable:v.id})}>Duplicate variable</button>
              <button type="button" disabled={v.extends!==undefined} onClick={()=>run("variable.delete",{variable:v.id})}>Delete variable</button>
            </details></>}</th>
          {columns.map(c=>c.skip ? <td key={c.index} aria-hidden="true"/> :
            <VariableValueCell readOnly={readOnly} key={collection.modes[c.index].id} v={v} mode={collection.modes[c.index]} colIndex={c.index+2} data={data} run={run}/>)}
        </tr>;
      })}</tbody></table>
  </div>;
}
