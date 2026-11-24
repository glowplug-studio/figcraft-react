import type { Document } from "./document";
import type { PrototypeEasing, PrototypeTransition, PrototypeTrigger } from "./prototype-data";

/** Source: upstream doc/src/proto.rs: easing curves and springs, transitions, key and controller triggers. */
export const customBezier: PrototypeEasing = Object.freeze({ customBezier: Object.freeze({ x1: 0.42, y1: 0, x2: 0.58, y2: 1 }) });
export const customSpring: PrototypeEasing = Object.freeze({ customSpring: Object.freeze({ mass: 1, stiffness: 100, damping: 15 }) });

/** Native `Easing::spring`: a spring's mass, stiffness and damping (the presets are springs too). */
export function easingSpring(e: PrototypeEasing): readonly [number, number, number] | undefined {
  if (typeof e === "string") return e === "gentle" ? [1, 100, 15] : e === "quick" ? [1, 300, 20] : e === "bouncy" ? [1, 600, 15] : e === "slow" ? [1, 80, 20] : undefined;
  return "customSpring" in e ? [e.customSpring.mass, e.customSpring.stiffness, e.customSpring.damping] : undefined;
}

/** Native `Spring`: a unit mass-spring-damper released from 0 towards 1. */
class Spring {
  readonly w0: number; readonly zeta: number; readonly settle: number;
  constructor(mass: number, stiffness: number, damping: number) {
    const ok = (v: number, lo: number, d: number) => Number.isFinite(v) && v >= lo ? v : d;
    const m = Math.min(ok(mass, 0.01, 1), 1e4), k = Math.min(ok(stiffness, 0.01, 100), 1e6), c = Math.min(ok(damping, 0, 15), 1e6);
    this.w0 = Math.sqrt(k / m);
    this.zeta = c / (2 * Math.sqrt(k * m));
    const [rate, kSettle] = this.zeta < 1 ? [this.zeta * this.w0, 6.9] : [this.w0 / (this.zeta + Math.sqrt(this.zeta * this.zeta - 1)), 9.2];
    const settle = rate > 1e-6 ? Math.min(Math.max(kSettle / rate, 0.05), 10) : 10;
    this.settle = Number.isFinite(settle) ? settle : 10;
  }
  at(t: number): number {
    if (t >= 1) return 1;
    const { w0, zeta } = this, tau = t * this.settle;
    let x: number;
    if (zeta < 1) {
      const wd = w0 * Math.sqrt(1 - zeta * zeta);
      x = 1 - Math.exp(-zeta * w0 * tau) * (Math.cos(wd * tau) + zeta * w0 / wd * Math.sin(wd * tau));
    } else if (Math.abs(zeta - 1) < 1e-9) x = 1 - Math.exp(-w0 * tau) * (1 + w0 * tau);
    else {
      const s = Math.sqrt(zeta * zeta - 1), r1 = -w0 / (zeta + s), r2 = -w0 * (zeta + s);
      x = 1 - (r2 * Math.exp(r1 * tau) - r1 * Math.exp(r2 * tau)) / (r2 - r1);
    }
    return Number.isFinite(x) ? x : 1;
  }
}

/** Native `Easing::seconds`: a spring runs until it settles; a curve for the duration set. */
export function easingSeconds(e: PrototypeEasing, ms: number): number {
  const s = easingSpring(e);
  return s ? new Spring(...s).settle : ms / 1000;
}

/** Native `cubic_bezier`: CSS cubic-bezier at time `t`, x clamped to 0..1. */
function cubicBezier(t: number, x1: number, y1: number, x2: number, y2: number) {
  const fin = (v: number, d: number) => Number.isFinite(v) ? v : d;
  const cx1 = Math.min(Math.max(fin(x1, 0.42), 0), 1), cx2 = Math.min(Math.max(fin(x2, 0.58), 0), 1);
  const cy1 = Math.min(Math.max(fin(y1, 0), -10), 10), cy2 = Math.min(Math.max(fin(y2, 1), -10), 10);
  const b = (p1: number, p2: number, s: number) => { const u = 1 - s; return 3 * u * u * s * p1 + 3 * u * s * s * p2 + s * s * s; };
  let lo = 0, hi = 1;
  for (let i = 0; i < 48; i++) { const mid = (lo + hi) / 2; if (b(cx1, cx2, mid) < t) lo = mid; else hi = mid; }
  return b(cy1, cy2, (lo + hi) / 2);
}

/** Native `Easing::eval`: the curve at `t` (0..1). */
export function evalEasing(e: PrototypeEasing, raw: number): number {
  const t = Number.isFinite(raw) ? Math.min(Math.max(raw, 0), 1) : 1, back = 1.70158;
  if (typeof e !== "string" && "customBezier" in e) return cubicBezier(t, e.customBezier.x1, e.customBezier.y1, e.customBezier.x2, e.customBezier.y2);
  const spring = easingSpring(e);
  if (spring) return new Spring(...spring).at(t);
  switch (e) {
    case "linear": return t;
    case "easeIn": return t * t * t;
    case "easeOut": return 1 - (1 - t) ** 3;
    case "easeInOut": return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
    case "easeInBack": return (back + 1) * t * t * t - back * t * t;
    case "easeOutBack": return 1 + (back + 1) * (t - 1) ** 3 + back * (t - 1) ** 2;
    case "easeInOutBack": {
      const c2 = back * 1.525;
      return t < 0.5 ? ((2 * t) ** 2 * ((c2 + 1) * 2 * t - c2)) / 2 : ((2 * t - 2) ** 2 * ((c2 + 1) * (t * 2 - 2) + c2) + 2) / 2;
    }
    default: return t;
  }
}

/** Rust `to_ascii_lowercase`: only ASCII letters change case. */
const ascii = (s: string) => s.replace(/[A-Z]/g, c => c.toLowerCase());
type Direction = "left" | "right" | "top" | "bottom";
/** Native `Transition::direction`. */
export const transitionDirection = (t: PrototypeTransition): Direction | undefined => "direction" in t ? t.direction : undefined;
/** Native `accepts_drag`: a directional transition starts only for a drag mostly its way. */
export function acceptsDrag(t: PrototypeTransition, dx: number, dy: number): boolean {
  switch (transitionDirection(t)) {
    case undefined: return true;
    case "left": return dx < 0 && Math.abs(dx) >= Math.abs(dy);
    case "right": return dx > 0 && Math.abs(dx) >= Math.abs(dy);
    case "top": return dy < 0 && Math.abs(dy) >= Math.abs(dx);
    case "bottom": return dy > 0 && Math.abs(dy) >= Math.abs(dx);
  }
}
const opposite: Record<Direction, Direction> = { left: "right", right: "left", top: "bottom", bottom: "top" };
/** Native `Transition::reversed`: the opposite motion (Back, a hover or press state reverting). */
export function reversedTransition(t: PrototypeTransition): PrototypeTransition {
  if (!("direction" in t)) return t;
  const direction = opposite[t.direction];
  switch (t.type) {
    case "moveIn": return { type: "moveOut", direction };
    case "moveOut": return { type: "moveIn", direction };
    case "slideIn": return { type: "slideOut", direction };
    case "slideOut": return { type: "slideIn", direction };
    default: return { type: t.type, direction };
  }
}

export interface KeyMods { readonly ctrl: boolean; readonly alt: boolean; readonly shift: boolean; readonly cmd: boolean }
export const noMods: KeyMods = Object.freeze({ ctrl: false, alt: false, shift: false, cmd: false });
/** Native `KeyMods::combo`: `Ctrl+Alt+Shift+Cmd+K`. */
export function keyCombo(m: KeyMods, key: string) {
  return ([[m.ctrl, "Ctrl"], [m.alt, "Alt"], [m.shift, "Shift"], [m.cmd, "Cmd"]] as const).filter(([on]) => on).map(([, n]) => n + "+").join("") + key;
}
/** Native `KeyMods::split`: a combination's modifiers and key (other spellings of the modifiers too). */
export function splitKey(combo: string): [KeyMods, string] {
  const mods = { ...noMods };
  let rest = combo.trim();
  for (;;) {
    const at = rest.indexOf("+");
    if (at < 0 || at === rest.length - 1) break;
    const m = ascii(rest.slice(0, at).trim());
    if (["ctrl", "control", "⌃"].includes(m)) mods.ctrl = true;
    else if (["alt", "option", "opt", "⌥"].includes(m)) mods.alt = true;
    else if (["shift", "⇧"].includes(m)) mods.shift = true;
    else if (["cmd", "command", "meta", "super", "win", "⌘"].includes(m)) mods.cmd = true;
    else break;
    rest = rest.slice(at + 1).trim();
  }
  return [mods, rest];
}
/** Native `GAMEPAD_BUTTONS`: the standard gamepad layout's buttons by index. */
export const gamepadButtons = Object.freeze(["Gamepad A", "Gamepad B", "Gamepad X", "Gamepad Y", "Gamepad LB", "Gamepad RB", "Gamepad LT", "Gamepad RT",
  "Gamepad View", "Gamepad Menu", "Gamepad LS", "Gamepad RS", "Gamepad Up", "Gamepad Down", "Gamepad Left", "Gamepad Right", "Gamepad Home"]);
export const gamepadButton = (index: number): string | undefined => gamepadButtons[index];
export const isGamepadButton = (key: string) => gamepadButtons.some(b => ascii(b) === ascii(key.trim()));
/** Native `uses_gamepad`: the player polls controllers only for prototypes with a controller trigger. */
export const usesGamepad = (doc: Document) => Object.values(doc.nodes).some(n => n.interactions?.some(it => it.trigger.type === "keyPress" && isGamepadButton(it.trigger.key)));
/** Native `key_alias`: other spellings people type for keys. */
export function keyAlias(k: string): string | undefined {
  switch (ascii(k)) {
    case "space": case " ": return "Space";
    case "return": case "enter": return "Enter";
    case "esc": case "escape": return "Escape";
    case "left": case "arrowleft": case "←": return "ArrowLeft";
    case "right": case "arrowright": case "→": return "ArrowRight";
    case "up": case "arrowup": case "↑": return "ArrowUp";
    case "down": case "arrowdown": case "↓": return "ArrowDown";
    case "tab": return "Tab";
    case "backspace": return "Backspace";
    case "delete": return "Delete";
    default: return undefined;
  }
}
const sameMods = (a: KeyMods, b: KeyMods) => a.ctrl === b.ctrl && a.alt === b.alt && a.shift === b.shift && a.cmd === b.cmd;
/** Native `fires_on_key`: a key trigger fires for its key pressed with exactly its modifiers. */
export function firesOnKey(t: PrototypeTrigger, key: string, mods: KeyMods): boolean {
  if (t.type !== "keyPress") return false;
  const [m, k] = splitKey(t.key);
  return sameMods(m, mods) && (ascii(k) === ascii(key) || keyAlias(k) === key);
}
/** Native `Trigger::label`. */
export function triggerLabel(t: PrototypeTrigger): string {
  switch (t.type) {
    case "onClick": return "On click";
    case "onHover": return "While hovering";
    case "onPress": return "While pressing";
    case "onDrag": return "On drag";
    case "mouseEnter": return "Mouse enter";
    case "mouseLeave": return "Mouse leave";
    case "mouseDown": return "Mouse down";
    case "mouseUp": return "Mouse up";
    case "afterDelay": return `After delay ${t.ms}ms`;
    case "keyPress": return isGamepadButton(t.key) ? t.key : `Key/Gamepad ${t.key}`;
  }
}
