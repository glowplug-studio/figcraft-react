import type { NodeId } from "./document";
import { topFrames } from "./prototype-commands";
import type { PrototypeTrigger } from "./prototype-data";
import { acceptsDrag, firesOnKey, transitionDirection, type KeyMods } from "./prototype-model";
import type { PageRect, PrototypePlayer } from "./prototype-player";
import { hotspots } from "./prototype-runtime";
import { outsideTopOverlay, type Screen } from "./prototype-screen";
import { pageForNode, subtreeIds } from "./hierarchy";

/** Source: upstream ui-egui/src/present/input.rs: what the pointer and keys do to the player, in page units of the presented screen. */
export const flashSeconds = 0.5;
type Point = { readonly x: number; readonly y: number };
const inside = (r: PageRect, q: Point) => q.x >= r.x0 && q.x <= r.x1 && q.y >= r.y0 && q.y <= r.y1;
const directions = { left: [-1, 0], right: [1, 0], top: [0, -1], bottom: [0, 1] } as const;

export class PresenterInput {
  /** Where the primary button went down (page units), and whether it moved past the drag threshold. */
  press?: Point;
  dragged = false;
  /** Native `flash_until`: hotspot hints after a click where nothing reacts. */
  flashUntil = 0;
  /** Native `Anim::follow`: a transition a drag started follows the pointer (start, unit direction, the screen's length that way). */
  follow?: { readonly from: Point; readonly dir: readonly [number, number]; readonly len: number; readonly origin: Point; frac: number };

  constructor(readonly player: PrototypePlayer, readonly hints = () => true) {}

  /** Top-most first: the hotspots under `q`. */
  #hits(screen: Screen, q?: Point): [NodeId, PageRect][] {
    if (!q) return [];
    return hotspots(screen.doc, screen.root).reverse().filter(([, r]) => inside(r, q));
  }
  #pick(screen: Screen, hits: [NodeId, PageRect][], want: (t: PrototypeTrigger) => boolean): [NodeId, number, PageRect] | undefined {
    for (const [id, r] of hits) {
      const k = (screen.doc.nodes[id].interactions ?? []).findIndex(it => want(it.trigger));
      if (k >= 0) return [id, k, r];
    }
    return undefined;
  }
  #find(screen: Screen, id: NodeId, want: (t: PrototypeTrigger) => boolean) {
    return (screen.doc.nodes[id]?.interactions ?? []).findIndex(it => want(it.trigger));
  }

  /** Native `input` for a pointer at `q` (undefined: away from the screen): reverting states, enter and leave, while hovering. */
  move(screen: Screen, q: Point | undefined, down: boolean, now: number): boolean {
    const p = this.player;
    // A transition a drag started follows the pointer while it stays down.
    if (this.follow && p.anim) {
      if (q && down) {
        // In screen space, like native: the frame shown now may sit elsewhere on the page than the one the drag began on.
        const f = this.follow, fx = q.x - screen.frame.x + f.origin.x, fy = q.y - screen.frame.y + f.origin.y;
        const d = (fx - f.from.x) * f.dir[0] + (fy - f.from.y) * f.dir[1];
        f.frac = Math.min(Math.max(d / f.len, 0), 1);
        (p.anim as { start: number }).start = now - f.frac * p.anim.dur;
      } else this.follow = undefined;
    }
    // Native keeps the hover area in screen space: compare in the frame the state started on.
    const tmp = p.temp, o = this.#tempOrigin;
    const tq = q && o ? { x: q.x - screen.frame.x + o.x, y: q.y - screen.frame.y + o.y } : q;
    if (tmp && !tmp.press && (!tq || !inside(tmp.rect, tq))) { p.revert(now); return true; }
    const hits = this.#hits(screen, q), ids = hits.map(h => h[0]);
    const entered = hits.filter(([id]) => !p.hovered.includes(id)), left = p.hovered.filter(id => !ids.includes(id));
    p.hovered = ids;
    for (const id of left) {
      const k = this.#find(screen, id, t => t.type === "mouseLeave");
      if (k >= 0 && p.gesture(id, k, undefined, now, screen.root)) return true;
    }
    for (const [id, r] of entered) {
      const k = this.#find(screen, id, t => t.type === "mouseEnter");
      if (k >= 0 && p.gesture(id, k, r, now, screen.root)) return true;
    }
    if (!p.temp && entered.length) {
      const pick = this.#pick(screen, hits, t => t.type === "onHover");
      if (pick && entered.some(e => e[0] === pick[0]) && p.fire(pick[0], pick[1], pick[2], now)) { this.#tempOrigin = { x: screen.frame.x, y: screen.frame.y }; return true; }
    }
    // A press passing the drag threshold starts an on-drag transition its way.
    if (down && this.press && !this.dragged && q && Math.hypot(q.x - this.press.x, q.y - this.press.y) > 6 / this.scale) {
      this.dragged = true;
      const start = this.press, dx = q.x - start.x, dy = q.y - start.y;
      for (const [id, r] of this.#hits(screen, start)) {
        const k = (screen.doc.nodes[id].interactions ?? []).findIndex(it => it.trigger.type === "onDrag" && acceptsDrag(it.transition, dx, dy));
        if (k < 0) continue;
        if (p.fire(id, k, r, now)) {
          this.press = undefined;
          const a = p.anim;
          if (a && a.start === now) {
            const dir = transitionDirection(a.transition);
            const v = dir ? directions[dir] : Math.abs(dx) >= Math.abs(dy) ? [Math.sign(dx), 0] as const : [0, Math.sign(dy)] as const;
            this.follow = { from: start, dir: v, len: Math.max(v[0] !== 0 ? screen.frame.width : screen.frame.height, 1), origin: { x: screen.frame.x, y: screen.frame.y }, frac: 0 };
          }
          return true;
        }
        break;
      }
    }
    return false;
  }
  #tempOrigin?: Point;
  /** The presenter's scale (screen points per page unit), for the drag threshold in points. */
  scale = 1;

  /** Native's press: a click outside the top overlay closes it; mouse down, then while pressing. */
  down(screen: Screen, q: Point, now: number): boolean {
    const p = this.player;
    this.press = q; this.dragged = false;
    const outside = outsideTopOverlay(screen, q);
    if (outside) {
      if (outside.closeOnOutside) { p.closeOverlay(now); this.press = undefined; p.hovered = []; return true; }
      return false;
    }
    const hits = this.#hits(screen, q);
    const down = this.#pick(screen, hits, t => t.type === "mouseDown");
    if (down && p.gesture(down[0], down[1], down[2], now, screen.root)) return true;
    const press = this.#pick(screen, hits, t => t.type === "onPress");
    return !!press && p.fire(press[0], press[1], press[2], now);
  }
  /** Native's release: a while-pressing state reverts; mouse up; a click when it did not drag, else hotspot hints. */
  up(screen: Screen, q: Point | undefined, now: number): boolean {
    const p = this.player;
    // Let go, a transition the drag started plays on from where it got to.
    this.follow = undefined;
    if (p.temp?.press) { p.revert(now); this.press = undefined; return true; }
    if (!this.press) return false;
    const dragged = this.dragged;
    this.press = undefined; this.dragged = false;
    const hits = this.#hits(screen, q);
    const up = this.#pick(screen, hits, t => t.type === "mouseUp");
    if (up && p.gesture(up[0], up[1], up[2], now, screen.root)) return true;
    if (dragged) return false;
    const click = this.#pick(screen, hits, t => t.type === "onClick");
    if (click && p.fire(click[0], click[1], click[2], now)) return true;
    if (this.hints()) this.flashUntil = now + flashSeconds;
    return false;
  }
  /** Native's keys: a key trigger of what shows, else the player's own keys (R restarts) and the arrows, Space and N stepping frames.
   * `sizes` is Z (the full-window presenter's size options). True when the key was used. */
  key(screen: Screen, name: string, mods: KeyMods, now: number, sizes?: () => void): boolean {
    const p = this.player;
    for (const id of subtreeIds(screen.doc, screen.root)) {
      const k = (screen.doc.nodes[id].interactions ?? []).findIndex(it => firesOnKey(it.trigger, name, mods));
      if (k >= 0) { if (p.fire(id, k, undefined, now)) return true; break; }
    }
    const none = !mods.ctrl && !mods.alt && !mods.shift && !mods.cmd;
    if (none && name === "R") { p.restart(p.start, now); return true; }
    if (none && name === "Z" && sizes) { sizes(); return true; }
    const forward = name === "ArrowRight" || none && (name === "Space" || name === "N") ? true : name === "ArrowLeft" ? false : undefined;
    if (forward !== undefined && !p.overlays.length && p.doc) {
      const page = pageForNode(p.doc, p.current);
      const frames = page !== undefined ? topFrames(p.doc, page) : [], i = frames.indexOf(p.current);
      const next = i < 0 ? undefined : forward ? frames[i + 1] : frames[i - 1];
      if (next !== undefined) { p.go(next, { type: "instant" }, 0, "linear", now, true, false); return true; }
    }
    return false;
  }
  /** Native's timers: delayed mouse triggers due, then an after-delay interaction due (not while a transition plays). */
  tick(screen: Screen, now: number): boolean {
    const p = this.player;
    // Native `follow_drag`: held still, a transition the drag started waits where the pointer put it.
    if (this.follow && p.anim) { (p.anim as { start: number }).start = now - this.follow.frac * p.anim.dur; return true; }
    if (p.fireWaiting(screen.root, now)) return true;
    if (p.anim) return false;
    const next = p.nextDelay(screen.doc, screen.root, now);
    if (next && next[1] <= 0) { p.delaysFired.add(next[0][0] + "/" + next[0][1]); p.fire(next[0][0], next[0][1], undefined, now); return true; }
    return false;
  }
}
