import type { Document } from "../document";
import { decodeFigcraft } from "../file-format";
import { diffLive, liveReplica, type LiveChange, type LiveReplica } from "./live-changes";
import { restoreLiveCheckpoint } from "./live-checkpoint";
import { captureLiveStep, loseLiveTravel, refreshLiveTravel, sendLiveTravel, settleLiveStep, taintStep, travelLiveStep, verifyLiveSteps, type LiveStep } from "./live-history";
import { applyLive } from "./live-replica";
import type { LiveIdentity, LiveTransport, LiveUpdate } from "./live-transport";

export interface LiveEditor {
  current(): Document;
  recordsEdit?(document: Document): boolean;
  welcome?(document:Document):void;
  mergeStranded?(document:Document,client:number):Document|undefined;
  receive(document: Document, restartedClient?:number): void;
  subscribe(listener: () => void): () => void;
  interacting(): boolean;
  normalise(before: Document, after: Document, touched: ReadonlySet<string>): Document;
  history(controller?: {confirmed?:()=>Document|undefined;pending?:()=>boolean;canUndo: boolean; canRedo: boolean; travel(undo: boolean): boolean}): void;
}
type Pending = {uncertain?:boolean; reason?:string; base: string; batch?: string; changes: LiveChange[]; step?: LiveStep; rebased?: boolean; direction: "edit"|"undo"|"redo"|"followUp"};

/** One ordered writer per physical editor. In-flight IDs survive a lost reply and a physical reconnect. */
export class LivePeer {
  private identity?: LiveIdentity;
  private confirmed?: LiveReplica;
  private local: LiveReplica;
  private seen: Document;
  private sequence: string | null = null;
  private next = 1n;
  private edits: Document[] = [];
  private pending: Pending[] = [];
  private undo: LiveStep[] = [];
  private redo: LiveStep[] = [];
  private travelRequest?: boolean;
  private timer?: ReturnType<typeof setTimeout>;
  private detach?: () => void;
  private running = false;
  private notified = false;
  private alive = false;
  private installing = false;
  private redraw = false;
  private welcomePending=false;

  constructor(private editor: LiveEditor, private transport: LiveTransport, private client: number, private notice: (message: string) => void) {
    this.identity = transport.identity;
    this.seen = editor.current();
    this.local = liveReplica(this.seen);
  }

  start() {
    this.alive = true;
    this.detach = this.editor.subscribe(() => {
      const current = this.editor.current();
      if (this.installing || this.seen === current) return;
      this.seen = current;
      this.edits.push(current);
      this.wake();
    });
    const stopListening = this.transport.listen?.(() => { this.notified = true; this.wake(); });
    this.history();
    this.wake();
    return () => { this.alive = false; stopListening?.(); clearTimeout(this.timer); this.detach?.(); this.editor.history(); };
  }

  private wake(delay=0) {
    if (!this.alive || this.running) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => { void this.run(); },delay);
  }

  private history() {
    if (!this.alive) return;
    this.editor.history({confirmed:()=>this.confirmed?.document,pending:()=>!!(this.edits.length || this.pending.length || this.travelRequest!==undefined),canUndo:!!this.undo.length,canRedo:!!this.redo.length,travel:undo => {
      if (this.travelRequest !== undefined || !(undo ? this.undo : this.redo).length) return false;
      this.travelRequest = undo;
      this.wake();
      return true;
    }});
  }

  private async capture() {
    while (this.edits.length && this.alive) {
      const next = this.edits[0], before = this.local;
      const diff = await diffLive(before,next);
      if (diff.changes.length) {
        const step = this.editor.recordsEdit?.(next) === false ? undefined : await captureLiveStep(before,diff.replica,diff.changes);
        this.pending.push({base:this.sequence ?? "0",changes:diff.changes,step,direction:"edit"});
        if (step) {
          this.undo.push(step);
          if (this.undo.length > 1000) this.undo.shift();
          this.redo = [];
        }
      }
      this.local = diff.replica;
      this.edits.shift();
    }
    this.history();
  }

  private async initialState(update:LiveUpdate) {
    return update.checkpoint ? restoreLiveCheckpoint(update.checkpoint) : liveReplica((await decodeFigcraft(this.transport.archive)).document);
  }

  private async receive(update: LiveUpdate) {
    if (update.client !== this.client) throw new Error("The session's editing identity changed");
    let state = this.confirmed, seq = BigInt(this.sequence ?? "0");
    const processed=BigInt(update.lastBatch),refused=new Set(update.refused);
    for(const item of this.pending){
      if(item.uncertain && item.batch && BigInt(item.batch)>processed && item.step?.inFlight){
        loseLiveTravel(item.step);
        this.redraw=true;
      }
    }
    if (update.reset) {
      state = await this.initialState(update);
      if (this.confirmed && BigInt(update.checkpointSeq ?? "0") >= BigInt(this.sequence ?? "0")) {
        const suffix=new Set(update.batches.filter(batch=>batch.client===this.client).map(batch=>batch.batch));
        for(const item of this.pending){
          if(item.step && item.batch && BigInt(item.batch)<=processed && !refused.has(item.batch) && !suffix.has(item.batch) && item.direction!=="followUp")
            settleLiveStep(item.step,item.direction!=="undo");
          item.rebased=true;
        }
        await verifyLiveSteps([...this.undo,...this.redo],state);
      }
      seq = BigInt(update.checkpointSeq ?? "0");
      this.redraw = true;
    }
    if (!state) throw new Error("Missing initial live drawing");
    for (const b of update.batches) {
      if (BigInt(b.sequence) !== ++seq) throw new Error("Missing ordered edits");
      const before = state;
      const applied = await applyLive(state,b.changes);
      state = applied.replica;
      if (b.client === this.client) {
        const own = this.pending.find(p => p.batch === b.batch);
        if (own) {
          if (own.step && own.direction === "edit") {
            const fresh = await captureLiveStep(before,state,b.changes);
            own.step.backward = fresh.backward;
          }
          if(own.step && own.direction!=="followUp"){
            if(own.direction!=="edit")await refreshLiveTravel(own.step,own.direction==="redo",before,state,b.changes);
            settleLiveStep(own.step,own.direction!=="undo");
          }
          if (own.rebased) await this.repair(before,state,applied.touched,b.sequence,own);
        } else this.redraw = true;
      } else {
        this.redraw = true;
        for (const step of [...this.undo,...this.redo]) if (step.confirmed || step.inFlight) taintStep(step,b.changes);
        for (const item of this.pending) item.rebased = true;
      }
    }
    if (seq !== BigInt(update.sequence)) throw new Error("Incomplete ordered edits");
    this.confirmed = state;
    this.sequence = update.sequence;
    this.next = this.next > processed ? this.next : processed+1n;
    const droppedSteps=new Set<LiveStep>();
    this.pending = this.pending.filter(p => {
      if(!p.batch && p.step && droppedSteps.has(p.step))return false;
      if (!p.batch || BigInt(p.batch)>processed) return true;
      if (refused.has(p.batch)) {
        this.redraw = true;
        if(p.direction!=="followUp"){
          this.undo = this.undo.filter(s => s !== p.step);
          this.redo = this.redo.filter(s => s !== p.step);
          if(p.step)droppedSteps.add(p.step);
          const prefix=p.direction==="undo"?"Couldn't undo":p.direction==="redo"?"Couldn't redo":"Your change couldn't be applied";
          this.notice(prefix+": "+(p.reason??"it no longer applied when the connection came back"));
        }
      }
      return false;
    });
  }

  private async repair(before: LiveReplica, after: LiveReplica, touched: ReadonlySet<string>, base: string, owner: Pending) {
    const fixed = this.editor.normalise(before.document,after.document,touched);
    const diff = await diffLive(after,fixed);
    const later = new Set(this.pending.slice(this.pending.indexOf(owner)+1).flatMap(p =>
      p.changes.filter(c => c.type === "set").map(c => c.id+"/"+c.prop)));
    const changes = diff.changes.filter(c => c.type !== "set" || !later.has(c.id+"/"+c.prop));
    if (changes.length) {
      this.pending.push({base,changes,direction:"followUp"});
      this.redraw = true;
    }
  }

  private async reconcile() {
    if (!this.confirmed) return;
    do {
      await this.capture();
      if (!this.alive || this.editor.interacting()) return;
      let view = this.confirmed;
      if (this.redraw) for (const p of this.pending) view = (await applyLive(view,p.changes,"lenient")).replica;
      else view = this.local;
      if (this.edits.length) continue;
      const travel = this.travelRequest;
      if (travel !== undefined) {
        this.travelRequest = undefined;
        const from = travel ? this.undo : this.redo, to = travel ? this.redo : this.undo;
        while (from.length) {
          const step = from.pop()!;
          const wanted = travelLiveStep(step,travel,view.document);
          const result = await applyLive(view,wanted,"lenient");
          const changes = (await diffLive(view,result.replica.document)).changes;
          if (!changes.length) continue;
          const base = this.sequence!;
          this.pending.push({base,changes,step,direction:travel?"undo":"redo"});
          const normalised = this.editor.normalise(view.document,result.replica.document,result.touched);
          const follow = await diffLive(result.replica,normalised);
          if (follow.changes.length) this.pending.push({base,changes:follow.changes,step,direction:"followUp"});
          view = follow.replica;
          this.redraw = true;
          to.push(step);
          break;
        }
      }
      if (this.edits.length) { this.redraw = true; continue; }
      if (this.redraw && this.alive && !this.editor.interacting()) {
        const different = (await diffLive(this.local,view.document)).changes.length > 0;
        if (this.edits.length) continue;
        if (!this.alive || this.editor.interacting()) return;
        this.installing = true;
        try { if (different) this.editor.receive(view.document); this.seen = this.editor.current(); }
        finally { this.installing = false; }
        this.local = {...view,document:this.seen};
        this.redraw = false;
      }
      this.history();
      return;
    } while (this.alive);
  }

  /** A queued or lost travel uses the latest confirmed ownership before it goes on the wire. */
  private async prepareTravel(item:Pending) {
    const state=this.confirmed,step=item.step;
    if(!state || !step || (item.direction!=="undo" && item.direction!=="redo") || step.inFlight)return;
    // Native remakes only the most recent travel of this step. Earlier queued travel keeps its preview.
    if(this.pending.slice(1).some(p=>p.step===step && (p.direction==="undo" || p.direction==="redo")))return;
    const wanted=travelLiveStep(step,item.direction==="undo",state.document);
    const result=await applyLive(state,wanted,"lenient");
    const changes=(await diffLive(state,result.replica.document)).changes;
    const follow=this.pending[1];
    if(follow?.direction==="followUp" && follow.step===step)this.pending.splice(1,1);
    if(!changes.length){
      this.undo=this.undo.filter(s=>s!==step);
      this.redo=this.redo.filter(s=>s!==step);
      this.pending=this.pending.filter(p=>p.step!==step);
    }else{
      item.base=this.sequence!;
      item.changes=changes;
      sendLiveTravel(step,changes);
      const fixed=this.editor.normalise(state.document,result.replica.document,result.touched);
      const diff=await diffLive(result.replica,fixed);
      if(diff.changes.length)this.pending.splice(1,0,{base:item.base,changes:diff.changes,step,direction:"followUp"});
    }
    this.redraw=true;
  }

  private sameIdentity(left?:LiveIdentity,right?:LiveIdentity) {
    return left?.room===right?.room && left?.client===right?.client;
  }

  private async restart(identity:LiveIdentity,update:LiveUpdate) {
    if(update.client!==identity.client || !update.reset)throw new Error("Invalid replacement welcome");
    // Decode the complete welcome before retiring any local changes or history.
    let state=await this.initialState(update),sequence=BigInt(update.checkpointSeq??"0");
    for(const batch of update.batches){
      if(BigInt(batch.sequence)!==++sequence)throw new Error("Missing ordered edits");
      state=(await applyLive(state,batch.changes)).replica;
    }
    if(sequence!==BigInt(update.sequence))throw new Error("Incomplete replacement welcome");
    const next=BigInt(update.lastBatch)+1n;
    await this.capture();
    if(!this.alive || !this.sameIdentity(identity,this.transport.identity))return;
    const lost=this.pending.filter(p=>p.direction!=="followUp").length;
    this.installing=true;
    try {
      this.editor.receive(state.document,identity.client);
      this.seen=this.editor.current();
    } finally {this.installing=false;}
    this.identity=identity;
    this.client=identity.client;
    this.undo=[];this.redo=[];this.pending=[];
    this.travelRequest=undefined;
    this.sequence=update.sequence;this.confirmed=state;this.next=next;
    this.local={...state,document:this.seen};
    this.redraw=false;
    this.history();
    if(lost)this.notice("The live session restarted: "+lost+" unsent change"+(lost===1?"":"s")+" couldn't be kept");
  }

  private async run() {
    if (!this.alive || this.running) return;
    this.running = true;
    this.notified = false;
    let nextPoll = this.transport.listen ? 10_000 : 1200, failed = false;
    try {
      await this.capture();
      if (this.travelRequest !== undefined && this.confirmed) await this.reconcile();
      const welcome=this.transport.identity;
      const replace=welcome && !this.sameIdentity(welcome,this.identity);
      const update = await this.transport.read(replace ? null : this.sequence);
      if (!this.alive || !this.sameIdentity(welcome,this.transport.identity))return;
      const firstWelcome=!this.confirmed || replace;
      if(replace)await this.restart(welcome,update);
      else await this.receive(update);
      if(firstWelcome)this.welcomePending=true;
      if(this.welcomePending && this.confirmed && this.alive && this.sameIdentity(welcome,this.transport.identity)){
        if(this.editor.interacting()){nextPoll=100;return;}
        const snapshot=this.confirmed.document;
        this.editor.welcome?.(snapshot);
        const merged=this.editor.mergeStranded?.(snapshot,this.client);
        if(merged){
          // The three-way result includes all work in the stranded tab before and during rejoin.
          this.edits=[];this.pending=[];this.undo=[];this.redo=[];this.travelRequest=undefined;
          this.installing=true;
          try{this.editor.receive(merged);this.seen=this.editor.current();}finally{this.installing=false;}
          this.local=this.confirmed;
          this.edits.push(this.seen);
          this.redraw=true;
        }
        this.welcomePending=false;
      }
      await this.reconcile();
      const head = this.pending[0];
      if (head && this.alive && this.sameIdentity(welcome,this.transport.identity)) {
        await this.prepareTravel(head);
        if(!this.alive || !this.sameIdentity(welcome,this.transport.identity))return;
        if(this.pending[0]!==head){nextPoll=0;await this.reconcile();return;}
        head.batch ??= String(this.next++);
        head.uncertain=true;
        const result=await this.transport.submit(head.batch,head.base,head.changes);
        head.uncertain=false;
        if(result.refused)head.reason=result.reason;
        nextPoll = 0;
      }
    } catch { failed = true; nextPoll = 1800; }
    finally { this.running = false; this.wake(!failed && (this.notified || (this.edits.length || this.travelRequest !== undefined) && !this.editor.interacting()) ? 0 : nextPoll); }
  }
}
