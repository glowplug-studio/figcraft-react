import { textPathAt } from "./text-path-commands";
import { textKeyMotion } from "./text-key-motion";
import { textShortcut } from "./text-shortcuts";
import { inverse, transformPoint } from "./affine";
import { dropParent, lockedIn } from "./canvas-selection";
import { canvasAccent } from "./canvas-colours";
import type { EditorEngine } from "./editor";
import { worldTransform } from "./hierarchy";
import type { Point } from "./geometry";
import { hitRectangle } from "./selection";
import { textCaret, textHit, textSelectionRects } from "./text-caret";
import { textWordRange, type TextTarget } from "./text-edit";
import { prepareText, textNodeLayout } from "./text-node-layout";
import { scalarToUtf16, utf16ToScalar } from "./text-ranges";
import { wordSegmenterReady } from "./text-word-starts";
import { pageToScreen, screenToPage } from "./viewport";

type Session = ReturnType<EditorEngine["beginTextEdit"]>;
type Drag = {pointer: number; start: Point; end: Point; target: TextTarget; selecting: boolean};

/** Use a native text control for keyboard, clipboard and IME; canvas retains glyph and caret geometry. */
export class CanvasTextInput {
  #drag?: Drag;
  #session?: Session;
  #input?: HTMLTextAreaElement;
  #generation = 0;
  #selection?: [number,number];
  #composing = false;
  #composition?: {start:number; end:number; text:string; generation:number};
  get preeditDocument() { return this.#session?.active() ? this.#session.compositionPreview()?.document : undefined; }
  #pending?: Promise<void>;

  constructor(private canvas: HTMLCanvasElement, private engine: EditorEngine, private invalidate: () => void,
    private onError: (message: string) => void, signal: AbortSignal) {
    const options = {capture:true, signal};
    canvas.addEventListener("pointerdown",this.#down,options);
    canvas.addEventListener("pointermove",this.#move,options);
    canvas.addEventListener("pointerup",this.#up,options);
    canvas.addEventListener("pointercancel",this.#cancelDrag,options);
    canvas.addEventListener("lostpointercapture",this.#cancelDrag,options);
    canvas.addEventListener("dblclick",this.#double,options);
    canvas.addEventListener("click",e=>{
      if (e.detail!==3 || e.button!==0 || !this.active) return;
      const point=this.#point(e);
      if (this.#hit(point)!==this.#session!.node().id) return;
      e.preventDefault();e.stopImmediatePropagation();
      this.engine.execute("text.edit.selectLine",{index:utf16ToScalar(this.#input!.value,this.#index(point))});
    },options);
    const unsubscribe=engine.subscribeTextCommands(()=>{
      const session=engine.currentTextEdit();
      if (this.#session && this.#session!==session) this.#close(false);
      if (!session) return;
      if (this.#session!==session) this.#attach(session);
      const input=this.#input!, range=engine.getTextRange()!;
      this.#composition=undefined;this.#composing=false;this.#selection=undefined;
      input.value=session.node().text.characters;
      input.setSelectionRange(scalarToUtf16(input.value,range.start),scalarToUtf16(input.value,range.end),
        range.caret<range.anchor ? "backward" : "forward");
      this.invalidate();
    });
    signal.addEventListener("abort",unsubscribe,{once:true});
    signal.addEventListener("abort",() => { this.#generation++; this.#close(false); },{once:true});
  }
  get active() { return !!this.#session?.active(); }
  #updateRange = () => {
    const input = this.#input;
    if (input && !this.#composing) {
      const a=utf16ToScalar(input.value,input.selectionStart), b=utf16ToScalar(input.value,input.selectionEnd);
      const back=input.selectionDirection==="backward", range=this.engine.getTextRange();
      if (range?.anchor!==(back ? b : a) || range?.caret!==(back ? a : b))
        this.#session?.select(back ? b : a,back ? a : b);
    }
    this.invalidate();
  };
  format(props: Record<string,unknown>) {
    const input = this.#input, session = this.#session;
    if (!input || !session?.active()) return false;
    if (this.#composing || this.#pending) throw new Error("Finish entering the text before formatting it");
    session.format(props, utf16ToScalar(input.value,input.selectionStart), utf16ToScalar(input.value,input.selectionEnd));
    this.invalidate();
    return true;
  }
  #point(e: MouseEvent) {
    const rect = this.canvas.getBoundingClientRect();
    return screenToPage(this.engine.getView(),{x:e.clientX-rect.left,y:e.clientY-rect.top});
  }
  #hit(point: Point) {
    const doc = this.engine.getRenderDocument();
    const id = hitRectangle(doc,point,true,[],2/this.engine.getView().zoom);
    return id && doc.nodes[id]?.kind === "text" && !lockedIn(doc,id) ? id : undefined;
  }
  #index(point: Point) {
    const n = this.#session!.node(), {layout,dy} = textNodeLayout(n);
    const local = transformPoint(inverse(worldTransform(this.engine.getRenderDocument(),n.id)),point);
    return scalarToUtf16(n.text.characters,textHit(layout,local.x,local.y-dy));
  }
  #select(point: Point, extend: boolean) {
    const input = this.#input!;
    const end = this.#index(point), anchor = extend ? input.selectionDirection === "backward" ? input.selectionEnd : input.selectionStart : end;
    input.setSelectionRange(Math.min(anchor,end),Math.max(anchor,end),end<anchor?"backward":"forward");
    this.invalidate();
  }
  #down = (e: PointerEvent) => {
    if (e.button !== 0 || !this.engine.getSnapshot().editable) return;
    const start = this.#point(e), tool = this.engine.getSnapshot().tool;
    const id = this.active || tool === "text" ? this.#hit(start) : undefined;
    if (this.active && id === this.#session?.node().id && id) {
      e.preventDefault(); e.stopImmediatePropagation();
      this.#input?.focus({preventScroll:true});
      this.#select(start,e.shiftKey);
      this.#drag = {pointer:e.pointerId,start,end:start,target:{id},selecting:true};
      this.canvas.setPointerCapture(e.pointerId); return;
    }
    this.#generation++;
    if (this.active) this.finish();
    if (tool==="textOnPath") {
      e.preventDefault();e.stopImmediatePropagation();this.canvas.focus();
      const target=textPathAt(this.engine.getRenderDocument(),start,this.engine.getView().zoom);
      if (target) void this.#open(target,start);
      return;
    }
    if (this.engine.getSnapshot().tool !== "text") return;
    const doc = this.engine.getRenderDocument();
    const target: TextTarget = id ? {id} : {start,parent:dropParent(doc,start,[]) ?? doc.currentPage};
    e.preventDefault(); e.stopImmediatePropagation(); this.canvas.focus();
    this.#drag = {pointer:e.pointerId,start,end:start,target,selecting:false};
    this.canvas.setPointerCapture(e.pointerId);
  };
  #move = (e: PointerEvent) => {
    const drag=this.#drag;
    if (!drag && this.engine.getSnapshot().tool==="textOnPath") {
      const hit=textPathAt(this.engine.getRenderDocument(),this.#point(e),this.engine.getView().zoom);
      this.canvas.style.cursor=hit ? "text" : "default";
      e.stopImmediatePropagation();return;
    }
    if (!drag || drag.pointer !== e.pointerId) return;
    e.preventDefault(); e.stopImmediatePropagation();
    drag.end=this.#point(e);
    if (drag.selecting && this.active) this.#select(drag.end,true);
    this.invalidate();
  };
  #cancelDrag = (e: PointerEvent) => {
    if (this.#drag?.pointer !== e.pointerId) return;
    this.#drag=undefined; this.invalidate();
  };
  #up = (e: PointerEvent) => {
    const drag=this.#drag;
    if (!drag || drag.pointer !== e.pointerId) return;
    e.preventDefault(); e.stopImmediatePropagation();
    this.#drag=undefined;
    if (this.canvas.hasPointerCapture(e.pointerId)) this.canvas.releasePointerCapture(e.pointerId);
    const end=this.#point(e);
    if (drag.selecting) { if (this.active) this.#select(end,true); return; }
    const moved=Math.hypot(end.x-drag.start.x,end.y-drag.start.y)*this.engine.getView().zoom >= 3;
    const target = "id" in drag.target || !moved ? drag.target : {...drag.target,end};
    void this.#open(target,drag.start,false,moved && "id" in target ? end : undefined);
  };
  #double = (e: MouseEvent) => {
    if (this.active) {
      e.preventDefault(); e.stopImmediatePropagation();
      const input=this.#input!, value=input.value, index=utf16ToScalar(value,this.#index(this.#point(e)));
      const [a,b]=textWordRange(value,index);
      input.setSelectionRange(scalarToUtf16(value,a),scalarToUtf16(value,b)); this.invalidate(); return;
    }
    if (this.engine.getSnapshot().tool !== "move" || !this.engine.getSnapshot().editable) return;
    const point=this.#point(e), id=this.#hit(point);
    if (!id) return;
    e.preventDefault(); e.stopImmediatePropagation(); void this.#open({id},point,true);
  };
  async #open(target: Parameters<EditorEngine["beginTextEdit"]>[0], point: Point, selectAll=false, extend?: Point) {
    const version=++this.#generation, before=this.engine.getSnapshot();
    try {
      await prepareText();
      if (version !== this.#generation || this.engine.getSnapshot() !== before) return;
      if (before.tool === "text" || before.tool === "textOnPath") this.engine.execute("tool.move");
      const input=this.#attach(this.engine.beginTextEdit(target));
      if ("pathId" in target) input.setSelectionRange(0,0);
      else if (selectAll) { input.select(); this.invalidate(); }
      else { this.#select(point,false); if (extend) this.#select(extend,true); }
      this.#updateRange();
    } catch (e) { this.#close(false); this.onError(e instanceof Error ? e.message : "Could not edit text"); }
  }
  #attach(session:Session) {
    this.#session=session;
    const input=this.canvas.ownerDocument.createElement("textarea");
    this.#input=input;
    input.dataset.figcraftTextInput = "";
    input.setAttribute("aria-label","Edit text layer"); input.spellcheck=false;
    input.style.cssText="position:fixed;width:1px;height:1em;padding:0;border:0;opacity:0;pointer-events:none;resize:none;font-size:16px";
    input.value=this.#session.node().text.characters;
    this.canvas.after(input);
    input.addEventListener("beforeinput",()=>{ this.#selection=[input.selectionStart,input.selectionEnd]; });
    input.addEventListener("input",()=>{ if (!this.#composing) this.#sync(); });
    input.addEventListener("compositionstart",()=>{
      this.#updateRange();this.#composing=true;
      this.#composition={start:utf16ToScalar(input.value,input.selectionStart),end:utf16ToScalar(input.value,input.selectionEnd),text:"",generation:0};
    });
    input.addEventListener("compositionupdate",e=>{ void this.#showComposition(e.data); });
    input.addEventListener("compositionend",e=>this.#endComposition(e.data));
    input.addEventListener("select",this.#updateRange);
    input.addEventListener("keyup",this.#updateRange);
    input.addEventListener("keydown",this.#key);
    // Chromium restores focus after a modal, but can reset the textarea selection to zero.
    let inspectorRange: {start:number; end:number; direction:"forward"|"backward"|"none"; value:string} | undefined;
    input.addEventListener("focus", () => {
      const saved = inspectorRange;
      inspectorRange = undefined;
      const range=this.engine.getTextRange();
      if (saved && range && saved.value === input.value &&
        saved.start===scalarToUtf16(input.value,range.start) && saved.end===scalarToUtf16(input.value,range.end) &&
        (saved.direction==="backward")===(range.caret<range.anchor)) {
        input.setSelectionRange(saved.start,saved.end,saved.direction);
        this.#updateRange();
      }
    });
    input.addEventListener("blur", event => {
      const next = event.relatedTarget;
      if (next instanceof Element && next.closest("[data-figcraft-typography]") &&
        next.closest("[data-figcraft-editor]") === this.canvas.closest("[data-figcraft-editor]")) {
        inspectorRange = {start:input.selectionStart,end:input.selectionEnd,direction:input.selectionDirection,value:input.value};
        return;
      }
      if (this.#input === input) this.finish();
    });
    input.focus({preventScroll:true});
    return input;
  }
  async #showComposition(data: string) {
    const state=this.#composition, session=this.#session;
    if (!state || !session?.active()) return;
    const version=++state.generation;
    state.text=data;
    try {
      if (!wordSegmenterReady(data)) await prepareText(data);
      if (this.#composition!==state || state.generation!==version || !session.active()) return;
      session.compose(data);
      const range=this.engine.getTextRange();
      if (range && session.composition()) state.start=state.end=range.caret;
      this.invalidate();
    } catch (error) { if (this.#composition===state) this.onError(error instanceof Error ? error.message : "Could not display composition"); }
  }
  #endComposition(data: string) {
    const state=this.#composition, input=this.#input, session=this.#session;
    this.#composing=false;  this.#composition=undefined;
    if (!state || !input || !session?.active()) return;
    const before=session.node().text.characters, from=scalarToUtf16(before,state.start), to=scalarToUtf16(before,state.end);
    session.compose("");
    const insertion=data==="\r" || data==="\n" ? "" : data;
    input.value=before.slice(0,from)+insertion+before.slice(to);
    input.setSelectionRange(from+insertion.length,from+insertion.length);
    this.#selection=[from,to]; this.#sync(); this.invalidate();
  }
  #sync() {
    const session=this.#session, input=this.#input;
    if (!session?.active() || !input) return;
    const value=input.value, before=session.node().text.characters;
    if (value === before) return;
    if (!wordSegmenterReady(value)) {
      const pending=prepareText(value).then(()=>{ if (session===this.#session && session.active()) this.#sync(); })
        .catch(e=>{ if (session===this.#session) this.onError(e instanceof Error ? e.message : "Could not prepare text"); });
      this.#pending=pending;
      void pending.then(()=>{ if (this.#pending===pending) this.#pending=undefined; });
      return;
    }
    // Use the browser's selection first. Equal adjacent letters may belong to different styles.
    let [from,to]=this.#selection ?? [0,before.length];
    const suffix=before.length-to;
    let end=value.length-suffix;
    if (!this.#selection || from>end || !value.startsWith(before.slice(0,from)) || !value.endsWith(before.slice(to))) {
      from=0; to=before.length; end=value.length;
      while (from<to && from<end && before[from]===value[from]) from++;
      while (to>from && end>from && before[to-1]===value[end-1]) { to--;end--; }
      if (from && /[\uD800-\uDBFF]/.test(before[from-1])) from--;
      if (to<before.length && /[\uDC00-\uDFFF]/.test(before[to])) { to++;end++; }
    }
    const start = utf16ToScalar(before,from), stop = utf16ToScalar(before,to), insertion = value.slice(from,end);
    const caret = session.marker(start,stop,insertion);
    if (caret === undefined) session.replace(start,stop,insertion);
    else {
      input.value = session.node().text.characters;
      const offset = scalarToUtf16(input.value,caret);
      input.setSelectionRange(offset,offset);
    }
    this.#selection=undefined;
    if (input.value !== session.node().text.characters) input.value=session.node().text.characters;
    this.#updateRange();
  }
  #key = (e: KeyboardEvent) => {
    if (e.isComposing || this.#composing) return;
    if (e.key==="Enter" && e.altKey && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
      e.preventDefault(); e.stopPropagation(); this.#updateRange();
      try {
        const {url}=this.engine.execute("text.openLink");
        if (typeof url==="string") this.canvas.ownerDocument.defaultView?.open(url,"_blank","noopener,noreferrer");
      } catch (error) { this.onError(error instanceof Error ? error.message : "Could not open link"); }
      return;
    }
    if ((e.ctrlKey || e.metaKey) && !e.altKey && e.code==="KeyZ") {
      e.preventDefault();e.stopPropagation();
      const session=this.#session;
      const undo=()=>{
        if (!session?.active() || session!==this.#session) return;
        if (this.#pending) {void this.#pending.then(undo);return;}
        this.finish();
        this.engine.execute(e.shiftKey ? "edit.redo" : "edit.undo");
        this.canvas.focus();
      };
      undo();
      return;
    }
    const shortcut = textShortcut(e,true);
    if (shortcut) {
      e.preventDefault(); e.stopPropagation();
      if (this.#pending) return;
      this.#updateRange();
      try { this.engine.execute(shortcut); } catch (error) { this.onError(error instanceof Error ? error.message : "Formatting failed"); }
      return;
    }
    const input = this.#input!, session = this.#session!;
    if (!e.altKey && !e.ctrlKey && !e.metaKey && ["Tab","Backspace","Delete","Enter"].includes(e.key) && !this.#pending) {
      const start = utf16ToScalar(input.value,input.selectionStart), end = utf16ToScalar(input.value,input.selectionEnd);
      if (session.listKey(e.key,e.shiftKey,start,end)) { e.preventDefault(); e.stopPropagation(); this.invalidate(); return; }
      if (e.key === "Tab") {
        e.preventDefault(); e.stopPropagation();
        this.#selection = [input.selectionStart,input.selectionEnd];
        input.setRangeText("\t",input.selectionStart,input.selectionEnd,"end");
        this.#sync(); return;
      }
    }
    if (e.key === "Escape" || e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault(); e.stopPropagation(); this.finish(); this.canvas.focus(); return;
    }
    if (this.#pending) return;
    const key=(e.ctrlKey || e.metaKey) && e.code==="KeyA" ? "SelectAll" : e.key;
    if (!["ArrowLeft","ArrowRight","ArrowUp","ArrowDown","Home","End","Backspace","Delete","SelectAll"].includes(key)) return;
    const mac=/Mac|iPhone|iPad/.test(navigator.platform);
    const homeEnd=e.key==="Home" || e.key==="End";
    const word=mac ? e.altKey : !homeEnd && (e.ctrlKey || e.metaKey);
    const line=mac ? e.metaKey : homeEnd && (e.ctrlKey || e.metaKey);
    const a=utf16ToScalar(input.value,input.selectionStart), b=utf16ToScalar(input.value,input.selectionEnd);
    const range=input.selectionDirection==="backward" ? {anchor:b,caret:a} : {anchor:a,caret:b};
    const motion=textKeyMotion(session.node(),range,key,{word,line,shift:e.shiftKey});
    if (!motion) return;
    e.preventDefault();e.stopPropagation();
    if ("remove" in motion) {
      const start=scalarToUtf16(input.value,motion.remove[0]), end=scalarToUtf16(input.value,motion.remove[1]);
      this.#selection=[start,end];
      input.setRangeText("",start,end,"start");this.#sync();
    } else {
      const {anchor,caret}=motion.selection;
      input.setSelectionRange(scalarToUtf16(input.value,Math.min(anchor,caret)),scalarToUtf16(input.value,Math.max(anchor,caret)),
        caret<anchor ? "backward" : "forward");
    }
    this.#updateRange();
  };
  async flushForSave() {
    const session=this.#session;
    if (!session?.active() || this.#composing) return;
    if (this.#pending) await this.#pending;
    if (this.#session!==session || !session.active()) throw new Error("The active text edit changed");
    if (this.#input?.value!==session.node().text.characters) throw new Error("Text input is still pending");
  }
  finish() {
    if (!this.#input) return;
    if (this.#composition) this.#endComposition(this.#composition.text);
    else this.#sync();
    const session=this.#session, pending=this.#pending;
    if (pending) void pending.then(()=>{ if (session===this.#session) this.#close(true); });
    else this.#close(true);
  }
  #close(commit: boolean) {
    const session=this.#session, input=this.#input;
    this.#session=undefined; this.#input=undefined; this.#selection=undefined; this.#composing=false; this.#composition=undefined;  this.#pending=undefined;
    input?.remove();
    if (commit) session?.finish(); else session?.cancel();
    this.invalidate();
  }
  draw(context: CanvasRenderingContext2D) {
    const view=this.engine.getView(), drag=this.#drag;
    if (drag && !drag.selecting && !("id" in drag.target)) {
      const a=pageToScreen(view,drag.start), b=pageToScreen(view,drag.end);
      if (Math.hypot(b.x-a.x,b.y-a.y)>=3) { context.save(); context.strokeStyle=canvasAccent(this.engine.getRenderDocument()); context.strokeRect(a.x,a.y,b.x-a.x,b.y-a.y); context.restore(); }
    }
    const session=this.#session, input=this.#input;
    if (!session || !input) return;
    if (!session.active()) { this.#close(false); return; }
    const shown=this.#session?.compositionPreview(), node=shown?.node ?? session.node(), doc=shown?.document ?? this.engine.getRenderDocument(), {layout,dy}=textNodeLayout(node);
    const matrix=worldTransform(doc,node.id), origin=pageToScreen(view,{x:0,y:0});
    context.save(); context.translate(origin.x,origin.y); context.scale(view.zoom,view.zoom); context.transform(...matrix); context.translate(0,dy);
    const a=utf16ToScalar(node.text.characters,input.selectionStart), b=utf16ToScalar(node.text.characters,input.selectionEnd);
    context.fillStyle="rgba(42,125,230,.3)";
    if (shown) {
      context.fillStyle=canvasAccent(doc);
      for (const box of textSelectionRects(layout,shown.start,shown.end)) context.fillRect(box.x,box.y+box.height-1/view.zoom,box.width,1/view.zoom);
    } else for (const box of textSelectionRects(layout,a,b)) context.fillRect(box.x,box.y,box.width,box.height);
    const caret=textCaret(layout,shown?.cursor ?? (input.selectionDirection==="backward"?a:b)), line=layout.lines[caret.line];
    if (a===b || shown) {
      context.fillStyle=canvasAccent(doc); context.fillRect(caret.x,line?.top ?? 0,1/view.zoom,line?.height ?? node.height);
    }
    context.restore();
    const pos=pageToScreen(view,transformPoint(matrix,{x:caret.x,y:(line?.top ?? 0)+dy})), rect=this.canvas.getBoundingClientRect();
    input.style.left=rect.left+pos.x+"px"; input.style.top=rect.top+pos.y+"px";
  }
}
