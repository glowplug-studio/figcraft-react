import type { Rectangle } from "../../src/engine/geometry";

interface CaretApi<L> {
  textCaret(layout:L,index:number):{x:number;line:number};
  textHit(layout:L,x:number,y:number):number;
  textVisualStep(layout:L,index:number,right:boolean):number | undefined;
  textSelectionRects(layout:L,start:number,end:number):Rectangle[];
}

export function caretProbes<L>(api:CaretApi<L>,layout:L,n:number) {
  const carets=[], steps=[];
  for (let i=0;i<=n+1;i++) {
    const p=api.textCaret(layout,i);
    carets.push([p.x,p.line]);
    steps.push([api.textVisualStep(layout,i,false) ?? null,api.textVisualStep(layout,i,true) ?? null]);
  }
  const hits=[[-22,0],[0,7],[16.25,9],[40,20],[63,50],[111,17],[34,150]].map(([x,y])=>api.textHit(layout,x,y));
  const selections=[[0,0],[0,n],[1,2],[Math.floor(n/3),Math.floor(2*n/3)],[n,0],[n,n+1]]
    .map(([a,b])=>api.textSelectionRects(layout,a,b).map(r=>[r.x,r.y,r.width,r.height]));
  return {carets,steps,hits,selections};
}
