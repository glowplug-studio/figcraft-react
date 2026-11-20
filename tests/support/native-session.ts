import { expect } from "vitest";
import { EditorEngine } from "../../src/engine/editor";
import { MoveInteraction, type MoveModifiers } from "../../src/engine/move-interaction";
import { TransformInteraction } from "../../src/engine/transform-interaction";

/** One step of a sequence recorded by the native `session` oracle: a command, or a pointer, key or query step. */
export type SessionStep = readonly [string, Record<string, unknown>];
export interface SessionCase { readonly name: string; readonly steps: readonly SessionStep[]; readonly receipts: readonly unknown[] }

const modifiers = (p: Record<string, unknown>): MoveModifiers => ({ shiftKey: p.shift === true, altKey: p.alt === true, ctrlKey: p.ctrl === true, metaKey: p.cmd === true });

/** Replays a recorded native session against the port and compares what each step gave. Commands compare receipts
 * where `compare` names them; `@selection`, `@handle` and `@undoDepth` compare the port's own state. */
export function replaySession(c: SessionCase, compare: (command: string) => boolean = command => command === "node.get"): EditorEngine {
  const engine = new EditorEngine(), fail = (message: string) => { throw new Error(message); };
  const move = new MoveInteraction(engine, fail);
  let depth: { native: number; document: unknown } | undefined;
  c.steps.forEach(([name, params], i) => {
    const expected = c.receipts[i], why = `${name} ${JSON.stringify(params)} (step ${i})`;
    const point = { x: Number(params.x), y: Number(params.y) };
    if (name === "@click") { move.down(point, modifiers(params)); move.up(point, modifiers(params)); }
    else if (name === "@drag") {
      const [x0, y0] = params.from as number[], [x1, y1] = params.to as number[];
      move.down({ x: x0, y: y0 }, modifiers(params)); move.move({ x: x1, y: y1 }, modifiers(params)); move.up({ x: x1, y: y1 }, modifiers(params));
    } else if (name === "@selection") expect(engine.getSnapshot().selection.map(Number), why).toEqual(expected);
    else if (name === "@handle") expect(new TransformInteraction(engine, fail).hover(point) !== undefined, why).toBe(expected);
    else if (name === "@undoDepth") {
      // The port exposes no undo depth: an unchanged native depth must mean an unchanged document, and the reverse.
      const native = (expected as number[])[0], document = engine.getSnapshot().document;
      if (depth) expect(document === depth.document, `${why}: undo steps since the last reading`).toBe(native === depth.native);
      depth = { native, document };
    } else if (name.startsWith("@")) throw new Error(`The port harness has no step ${name}`);
    else if (expected && typeof expected === "object" && "error" in expected) expect(() => engine.execute(name, params), why).toThrow();
    else {
      const actual = engine.execute(name, params);
      if (compare(name)) expect(actual, why).toEqual(expected);
    }
  });
  return engine;
}
