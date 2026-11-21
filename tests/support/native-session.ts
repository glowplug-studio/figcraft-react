import { expect } from "vitest";
import { EditorEngine } from "../../src/engine/editor";
import { MoveInteraction, type MoveModifiers } from "../../src/engine/move-interaction";
import { TransformInteraction } from "../../src/engine/transform-interaction";
import { DrawInteraction } from "../../src/engine/draw-interaction";
import { VectorInteraction } from "../../src/engine/vector-interaction";
import { CornerInteraction, cornerHandles, cornerValue, type CornerHandle } from "../../src/engine/corner-handles";
import type { LayerNode } from "../../src/engine/document";

/** One step of a sequence recorded by the native `session` oracle: a command, or a pointer, key or query step. */
export type SessionStep = readonly [string, Record<string, unknown>];
export interface SessionCase { readonly name: string; readonly steps: readonly SessionStep[]; readonly receipts: readonly unknown[] }

/** Native names a shape handle `{kind: "radius", corner}`, `{kind: "ratio"}` or `{kind: "count"}`. */
const nativeHandle = (index: CornerHandle) => typeof index === "number" ? { kind: "radius", corner: index } : { kind: index };
const nine = (value: number) => Math.round(value * 1e9) / 1e9 + 0;
const shapeHandles = (engine: EditorEngine) => cornerHandles(engine.getRenderDocument(), engine.getRenderSelection(), engine.getView().zoom)
  .map(h => ({ handle: nativeHandle(h.index), at: [nine(h.point.x), nine(h.point.y)] }));
const rounded = (value: unknown): unknown => typeof value === "number" ? nine(value) : Array.isArray(value) ? value.map(rounded)
  : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, rounded(v)])) : value;
const modifiers = (p: Record<string, unknown>): MoveModifiers => ({ shiftKey: p.shift === true, altKey: p.alt === true, ctrlKey: p.ctrl === true, metaKey: p.cmd === true });

/** Replays a recorded native session against the port and compares what each step gave. Commands compare receipts
 * where `compare` names them (`nineDecimals`: numbers to nine decimals, for values a drag computes); `@selection`,
 * `@handle`, `@undoDepth`, `@tool`, `@shapeHandles` and `@dragHandle` compare the port's own state; `@escape` is the
 * Escape key through `EditorEngine.escape`. */
export function replaySession(c: SessionCase, compare: (command: string) => boolean = command => command === "node.get", nineDecimals = false): EditorEngine {
  const engine = new EditorEngine(), fail = (message: string) => { throw new Error(message); };
  const move = new MoveInteraction(engine, fail);
  let depth: { native: number; document: unknown } | undefined;
  c.steps.forEach(([name, params], i) => {
    const expected = c.receipts[i], why = `${name} ${JSON.stringify(params)} (step ${i})`;
    const point = { x: Number(params.x), y: Number(params.y) };
    if (name === "@click") { move.down(point, modifiers(params)); move.up(point, modifiers(params)); }
    else if (name === "@drag") {
      // The press goes to the first interaction that takes it, in the order the canvas offers it: vector points,
      // shape handles, transform handles, the draw tool, then move and marquee.
      const [x0, y0] = params.from as number[], [x1, y1] = params.to as number[], from = { x: x0, y: y0 }, to = { x: x1, y: y1 }, keys = modifiers(params);
      const vectors = new VectorInteraction(engine, fail), corner = new CornerInteraction(engine, fail), transform = new TransformInteraction(engine, fail), draw = new DrawInteraction(engine, fail);
      if (vectors.down(from, keys)) { vectors.move(to, keys); vectors.up(to); }
      else if (corner.down(from)) { corner.move(to, keys.altKey); corner.up(); }
      else if (transform.down(from)) { transform.move(to, keys); transform.up(); }
      else if (draw.down(from)) { draw.move(to, keys); draw.up(to); }
      else { move.down(from, keys); move.move(to, keys); move.up(to, keys); }
    } else if (name === "@selection") expect(engine.getSnapshot().selection.map(Number), why).toEqual(expected);
    else if (name === "@handle") expect(new TransformInteraction(engine, fail).hover(point) !== undefined, why).toBe(expected);
    else if (name === "@undoDepth") {
      // The port exposes no undo depth: an unchanged native depth must mean an unchanged document, and the reverse.
      const native = (expected as number[])[0], document = engine.getSnapshot().document;
      if (depth) expect(document === depth.document, `${why}: undo steps since the last reading`).toBe(native === depth.native);
      depth = { native, document };
    } else if (name === "@escape") engine.escape();
    else if (name === "@tool") expect(engine.getSnapshot().tool, why).toBe(expected);
    else if (name === "@shapeHandles") expect(shapeHandles(engine), why).toEqual(rounded(expected));
    else if (name === "@dragHandle") {
      // Press on the named shape handle where the port shows it, move, read what the readout would show, release.
      const want = JSON.stringify(params.corner === undefined ? { kind: params.kind } : { kind: params.kind, corner: params.corner });
      const held = shapeHandles(engine).find(h => JSON.stringify(h.handle) === want);
      if (!held) throw new Error(`${why}: the port shows no such shape handle`);
      const corner = new CornerInteraction(engine, fail), [x, y] = params.to as number[], id = engine.getSnapshot().selection[0];
      expect(corner.down({ x: held.at[0], y: held.at[1] }), `${why}: the press lands on the handle`).toBe(true);
      corner.move({ x, y }, params.alt === true);
      const node = engine.getRenderDocument().nodes[id] as LayerNode, index = params.kind === "radius" ? Number(params.corner) : params.kind as CornerHandle;
      const hint = { handle: JSON.parse(want), value: cornerValue(node, index), at: shapeHandles(engine).find(h => JSON.stringify(h.handle) === want)?.at };
      corner.up();
      expect({ from: held.at, hint }, why).toEqual(rounded(expected));
    } else if (name.startsWith("@")) throw new Error(`The port harness has no step ${name}`);
    else if (expected && typeof expected === "object" && "error" in expected) expect(() => engine.execute(name, params), why).toThrow();
    else {
      const actual = engine.execute(name, params);
      if (compare(name)) expect(nineDecimals ? rounded(actual) : actual, why).toEqual(nineDecimals ? rounded(expected) : expected);
    }
  });
  return engine;
}
